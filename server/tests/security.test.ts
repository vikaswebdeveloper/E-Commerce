import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { admin, app, category, customer, makeProduct, request } from './helpers.js';
import { UPLOAD_DIR } from '../src/services/storage.js';

describe('HTTP hardening', () => {
  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('blocks cross-origin state-changing requests (CSRF defence)', async () => {
    const c = await customer();
    const res = await c.agent.post('/api/cart').set('Origin', 'https://evil.example').send({ productId: 'x', quantity: 1 });
    expect(res.status).toBe(403);
    const ok = await c.agent.post('/api/auth/logout').set('Origin', 'http://localhost:5173');
    expect(ok.status).toBe(200);
  });

  it('does not reflect CORS headers for unknown origins', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns JSON 400 for malformed JSON and 413 for oversized bodies', async () => {
    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(bad.status).toBe(400);
    const big = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(200_000) });
    expect(big.status).toBe(413);
  });

  it('never leaks stack traces or internals in errors', async () => {
    const res = await request(app).get('/api/products/%00%00');
    expect(JSON.stringify(res.body)).not.toMatch(/node_modules|at \w+ \(|prisma/i);
    const nf = await request(app).get('/api/does-not-exist');
    expect(nf.status).toBe(404);
  });
});

describe('injection resistance', () => {
  it.each(["' OR '1'='1", "'; DROP TABLE Product; --", '" OR ""="', '%\' --', '${7*7}', '{"$ne":null}'])(
    'search treats %s as plain text',
    async (q) => {
      await makeProduct();
      const res = await request(app).get('/api/products').query({ q });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      const all = await request(app).get('/api/products');
      expect(all.body.total).toBeGreaterThan(0); // table still exists
    },
  );

  it('rejects array / object query-param pollution', async () => {
    expect((await request(app).get('/api/products?q=a&q=b')).status).toBe(400);
    // Express's simple query parser never builds nested objects: "sort[$ne]" is just an unknown, ignored key.
    const nested = await request(app).get('/api/products?sort[$ne]=x');
    expect(nested.status).toBe(200);
    expect((await request(app).get('/api/products?sort=;DROP')).status).toBe(400);
    expect((await request(app).get('/api/products?page=-1')).status).toBe(400);
    expect((await request(app).get('/api/products?limit=100000')).status).toBe(400);
  });

  it('strips HTML/script from stored user text (stored XSS)', async () => {
    const c = await customer();
    const p = await makeProduct();
    const payload = '<img src=x onerror=alert(1)><script>steal()</script>Nice';
    await c.agent.put(`/api/reviews/product/${p.id}`).send({ rating: 5, title: '<b onmouseover=1>T</b>', comment: payload }).expect(200);
    const list = (await request(app).get(`/api/reviews/product/${p.id}`)).body.reviews;
    expect(list[0].comment).not.toMatch(/[<>]/);
    expect(list[0].title).not.toMatch(/[<>]/);
    const addr = await c.agent.post('/api/addresses').send({ fullName: '<script>x</script>Amy', phone: '9876543210', line1: '<i>1 Road</i>', city: 'Pune', state: 'MH', pincode: '411001' });
    expect(addr.body.address.fullName).not.toMatch(/[<>]/);
  });

  it('rejects dangerous image URLs on products', async () => {
    const a = await admin();
    const base = { name: 'Img Test', description: 'desc here', price: 100, mrp: 200, stock: 1, categoryId: await category() };
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', '//evil.com/x.png', '/etc/passwd', '/uploads/../../secret']) {
      expect((await a.agent.post('/api/admin/products').send({ ...base, images: [bad] })).status).toBe(400);
    }
    expect((await a.agent.post('/api/admin/products').send({ ...base, images: ['https://cdn.example.com/x.png', '/uploads/abc-1.png'] })).status).toBe(201);
  });
});

describe('input validation', () => {
  it('rejects invalid quantities, prices and stock in admin product writes', async () => {
    const a = await admin();
    const base = { name: 'Valid Name', description: 'desc here', price: 100, mrp: 200, stock: 1, categoryId: await category() };
    for (const over of [{ price: -1 }, { price: 0 }, { price: 1.5 }, { price: '100' }, { stock: -5 }, { mrp: 50 }, { name: '' }, { categoryId: 'nope' }]) {
      const res = await a.agent.post('/api/admin/products').send({ ...base, ...over });
      expect(res.status, JSON.stringify(over)).toBe(400);
    }
  });

  it('validates addresses (phone, pincode)', async () => {
    const c = await customer();
    const base = { fullName: 'Asha', phone: '9876543210', line1: '1 Road', city: 'Pune', state: 'MH', pincode: '411001' };
    expect((await c.agent.post('/api/addresses').send({ ...base, phone: '12345' })).status).toBe(400);
    expect((await c.agent.post('/api/addresses').send({ ...base, pincode: '0123' })).status).toBe(400);
    expect((await c.agent.post('/api/addresses').send(base)).status).toBe(201);
  });

  it('reviews: rating bounds, one per user (update, not duplicate)', async () => {
    const c = await customer();
    const p = await makeProduct();
    for (const r of [0, 6, -1, 2.5, '5']) {
      expect((await c.agent.put(`/api/reviews/product/${p.id}`).send({ rating: r, comment: 'valid comment' })).status).toBe(400);
    }
    await c.agent.put(`/api/reviews/product/${p.id}`).send({ rating: 4, comment: 'first take' }).expect(200);
    await c.agent.put(`/api/reviews/product/${p.id}`).send({ rating: 2, comment: 'second take' }).expect(200);
    const list = (await request(app).get(`/api/reviews/product/${p.id}`)).body;
    expect(list.reviews).toHaveLength(1);
    const detail = (await request(app).get(`/api/products/${p.slug}`)).body.product;
    expect(detail.ratingAvg).toBe(2);
    expect(detail.ratingCount).toBe(1);
  });
});

describe('file upload', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

  it('accepts a real image and serves it with nosniff', async () => {
    const a = await admin();
    const res = await a.agent.post('/api/admin/upload').attach('image', png, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);
    const served = await request(app).get(res.body.url);
    expect(served.status).toBe(200);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    fs.rmSync(path.join(UPLOAD_DIR, path.basename(res.body.url)), { force: true });
  });

  it('rejects HTML/script disguised as an image (extension and mimetype spoofing)', async () => {
    const a = await admin();
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await a.agent.post('/api/admin/upload').attach('image', html, { filename: 'evil.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect((await a.agent.post('/api/admin/upload').attach('image', svg, { filename: 'a.svg', contentType: 'image/svg+xml' })).status).toBe(400);
  });

  it('rejects files over 2MB and path-traversal filenames cannot escape the folder', async () => {
    const a = await admin();
    const big = Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)]);
    expect((await a.agent.post('/api/admin/upload').attach('image', big, { filename: 'big.png', contentType: 'image/png' })).status).toBe(400);
    const t = await a.agent.post('/api/admin/upload').attach('image', png, { filename: '../../evil.png', contentType: 'image/png' });
    expect(t.status).toBe(201);
    expect(t.body.url).not.toContain('..');
    fs.rmSync(path.join(UPLOAD_DIR, path.basename(t.body.url)), { force: true });
  });

  it('does not allow directory traversal when serving uploads', async () => {
    const res = await request(app).get('/uploads/..%2F..%2F.env');
    expect([400, 403, 404]).toContain(res.status);
  });
});

describe('mock payment endpoint', () => {
  it('requires authentication and only returns signatures for the caller’s own order', async () => {
    expect((await request(app).post('/api/payments/mock-pay').send({ razorpayOrderId: 'x' })).status).toBe(401);
    const c = await customer();
    expect((await c.agent.post('/api/payments/mock-pay').send({ razorpayOrderId: 'order_nope' })).status).toBe(404);
  });
});
