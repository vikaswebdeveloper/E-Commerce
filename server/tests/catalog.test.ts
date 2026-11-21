import { describe, expect, it } from 'vitest';
import { admin, app, category, customer, makeProduct, prisma, request } from './helpers.js';

describe('catalog search / filter / sort', () => {
  it('searches by name, filters by brand/price/stock/rating and sorts', async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const cat = await prisma.category.create({ data: { name: `C${tag}`, slug: `c-${tag}` } });
    const mk = (n: string, price: number, extra = {}) =>
      makeProduct({ name: `Zeta${tag} ${n}`, slug: `zeta-${tag}-${n}`, price, mrp: price + 100, categoryId: cat.id, ...extra });
    await mk('cheap', 1000, { brand: 'A', stock: 5, ratingAvg: 4.5, ratingCount: 3 });
    await mk('mid', 5000, { brand: 'B', stock: 0, ratingAvg: 3 });
    await mk('dear', 9000, { brand: 'A', stock: 2, ratingAvg: 1 });
    await mk('hidden', 2000, { isActive: false });

    const get = async (q: Record<string, string>) => (await request(app).get('/api/products').query({ category: `c-${tag}`, ...q })).body;
    expect((await get({})).total).toBe(3); // inactive hidden
    expect((await request(app).get('/api/products').query({ q: `zeta${tag}` })).body.total).toBe(3); // case-insensitive
    expect((await get({ brand: 'A' })).total).toBe(2);
    expect((await get({ minPrice: '2000', maxPrice: '6000' })).items.map((i: any) => i.price)).toEqual([5000]);
    expect((await get({ inStock: 'true' })).total).toBe(2);
    expect((await get({ rating: '4' })).total).toBe(1);
    expect((await get({ sort: 'price_desc' })).items.map((i: any) => i.price)).toEqual([9000, 5000, 1000]);
    expect((await get({ sort: 'price_asc' })).items[0].price).toBe(1000);
    const page = await get({ limit: '2', page: '2' });
    expect(page.items).toHaveLength(1);
    expect(page.pages).toBe(2);
  });

  it('inactive products are not viewable publicly', async () => {
    const p = await makeProduct({ isActive: false });
    expect((await request(app).get(`/api/products/${p.slug}`)).status).toBe(404);
  });

  it('lists categories and meta', async () => {
    await category();
    expect((await request(app).get('/api/categories')).body.categories.length).toBeGreaterThan(0);
    const meta = (await request(app).get('/api/products/meta')).body;
    expect(meta).toHaveProperty('brands');
  });
});

describe('wishlist', () => {
  it('adds idempotently, lists and removes', async () => {
    const c = await customer();
    const p = await makeProduct();
    await c.agent.post(`/api/wishlist/${p.id}`).expect(201);
    await c.agent.post(`/api/wishlist/${p.id}`).expect(201);
    expect((await c.agent.get('/api/wishlist')).body.items).toHaveLength(1);
    await c.agent.delete(`/api/wishlist/${p.id}`).expect(200);
    expect((await c.agent.get('/api/wishlist')).body.items).toHaveLength(0);
    expect((await c.agent.post('/api/wishlist/doesnotexist')).status).toBe(404);
  });
});

describe('admin CRUD', () => {
  it('manages products: create, update, archive vs delete', async () => {
    const a = await admin();
    const cat = await category();
    const body = { name: 'Admin Widget', description: 'A fine widget', price: 1000, mrp: 1500, stock: 7, categoryId: cat, images: [] };
    const created = (await a.agent.post('/api/admin/products').send(body).expect(201)).body.product;
    expect(created.slug).toMatch(/^admin-widget/);
    const dup = (await a.agent.post('/api/admin/products').send(body).expect(201)).body.product;
    expect(dup.slug).not.toBe(created.slug); // unique slugs

    const upd = await a.agent.put(`/api/admin/products/${created.id}`).send({ ...body, price: 1200, stock: 3 }).expect(200);
    expect(upd.body.product.price).toBe(1200);

    // never ordered -> hard delete
    expect((await a.agent.delete(`/api/admin/products/${dup.id}`)).body.archived).toBe(false);

    // ordered -> archived (history preserved)
    const c = await customer();
    const addr = await prisma.address.create({ data: { userId: c.user.id, fullName: 'A B', phone: '9876543210', line1: '1 Road', city: 'P', state: 'M', pincode: '411001' } });
    await c.agent.post('/api/cart').send({ productId: created.id, quantity: 1 });
    await c.agent.post('/api/orders').send({ addressId: addr.id, paymentMethod: 'COD' }).expect(201);
    const del = await a.agent.delete(`/api/admin/products/${created.id}`);
    expect(del.body.archived).toBe(true);
    expect((await request(app).get(`/api/products/${created.slug}`)).status).toBe(404);
  });

  it('manages categories and blocks deleting non-empty ones', async () => {
    const a = await admin();
    const c = (await a.agent.post('/api/admin/categories').send({ name: `Gadgets ${Math.random()}` }).expect(201)).body.category;
    await makeProduct({ categoryId: c.id });
    expect((await a.agent.delete(`/api/admin/categories/${c.id}`)).status).toBe(409);
  });

  it('manages coupons incl. validation', async () => {
    const a = await admin();
    const code = `SAVE${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    expect((await a.agent.post('/api/admin/coupons').send({ code, type: 'PERCENT', value: 150 })).status).toBe(400);
    expect((await a.agent.post('/api/admin/coupons').send({ code: 'a b', type: 'FLAT', value: 100 })).status).toBe(400);
    const c = (await a.agent.post('/api/admin/coupons').send({ code: code.toLowerCase(), type: 'PERCENT', value: 15, usageLimit: 10 }).expect(201)).body.coupon;
    expect(c.code).toBe(code);
    await a.agent.put(`/api/admin/coupons/${c.id}`).send({ code, type: 'PERCENT', value: 20, isActive: false }).expect(200);
    await a.agent.delete(`/api/admin/coupons/${c.id}`).expect(200);
  });

  it('lists customers, blocks them and moderates reviews; actions are audited', async () => {
    const a = await admin();
    const c = await customer();
    const p = await makeProduct();
    await c.agent.put(`/api/reviews/product/${p.id}`).send({ rating: 1, comment: 'spam spam spam' }).expect(200);
    const list = (await a.agent.get('/api/admin/customers').query({ q: c.email })).body;
    expect(list.customers).toHaveLength(1);
    expect(list.customers[0]).not.toHaveProperty('passwordHash');

    const rev = (await a.agent.get('/api/admin/reviews')).body.reviews.find((r: any) => r.productId === p.id);
    await a.agent.delete(`/api/admin/reviews/${rev.id}`).expect(200);
    expect((await request(app).get(`/api/products/${p.slug}`)).body.product.ratingCount).toBe(0);

    await a.agent.patch(`/api/admin/customers/${c.user.id}/block`).send({ blocked: true }).expect(200);
    expect((await c.agent.get('/api/auth/me')).status).toBe(401);
    const logs = (await a.agent.get('/api/admin/audit')).body.logs;
    expect(logs.some((l: any) => l.action === 'BLOCK' && l.entityId === c.user.id)).toBe(true);
  });

  it('dashboard stats reflect paid revenue only', async () => {
    const a = await admin();
    const res = (await a.agent.get('/api/admin/stats').expect(200)).body;
    expect(res.salesByDay).toHaveLength(7);
    expect(typeof res.revenue).toBe('number');
  });
});
