import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { admin, customer, makeAddress, makeProduct, prisma, request, app } from './helpers.js';
import { saveImage, UPLOAD_DIR } from '../src/services/storage.js';
import { sweepOrphanImages } from '../src/services/imageCleanup.js';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const onDisk = (url: string) => fs.existsSync(path.join(UPLOAD_DIR, path.basename(url)));
const upload = async (a: Awaited<ReturnType<typeof admin>>) =>
  (await a.agent.post('/api/admin/upload').attach('image', png, { filename: 'p.png', contentType: 'image/png' }).expect(201)).body.url as string;
const body = (cat: string, images: string[]) => ({ name: `Img Prod ${crypto.randomBytes(3).toString('hex')}`, description: 'desc here', price: 1000, mrp: 1500, stock: 3, categoryId: cat, images });

async function newProduct(a: Awaited<ReturnType<typeof admin>>, images: string[]) {
  const { category } = await import('./helpers.js');
  const res = await a.agent.post('/api/admin/products').send(body(await category(), images)).expect(201);
  return res.body.product as { id: string; images: string[]; name: string };
}

describe('image lifecycle: removed images are deleted from storage', () => {
  it('deletes an image when it is removed from a product, keeps the ones still used', async () => {
    const a = await admin();
    const [keep, drop] = [await upload(a), await upload(a)];
    const p = await newProduct(a, [keep, drop]);
    expect([onDisk(keep), onDisk(drop)]).toEqual([true, true]);

    const { category } = await import('./helpers.js');
    await a.agent.put(`/api/admin/products/${p.id}`).send({ ...body(await category(), [keep]), name: p.name }).expect(200);
    expect(onDisk(drop)).toBe(false);
    expect(onDisk(keep)).toBe(true);
  });

  it('deletes the OLD image when it is replaced by a new one', async () => {
    const a = await admin();
    const old = await upload(a);
    const p = await newProduct(a, [old]);
    const fresh = await upload(a);
    const { category } = await import('./helpers.js');
    await a.agent.put(`/api/admin/products/${p.id}`).send({ ...body(await category(), [fresh]), name: p.name }).expect(200);
    expect(onDisk(old)).toBe(false);
    expect(onDisk(fresh)).toBe(true);
  });

  it('deletes all images when a product is deleted', async () => {
    const a = await admin();
    const imgs = [await upload(a), await upload(a)];
    const p = await newProduct(a, imgs);
    await a.agent.delete(`/api/admin/products/${p.id}`).expect(200);
    expect(imgs.map(onDisk)).toEqual([false, false]);
  });

  it('keeps images of an ARCHIVED product (it still exists and has order history)', async () => {
    const a = await admin();
    const c = await customer();
    const img = await upload(a);
    const p = await newProduct(a, [img]);
    await c.agent.post('/api/cart').send({ productId: p.id, quantity: 1 });
    const addr = await makeAddress(c.user.id);
    await c.agent.post('/api/orders').send({ addressId: addr.id, paymentMethod: 'COD' }).expect(201);
    expect((await a.agent.delete(`/api/admin/products/${p.id}`)).body.archived).toBe(true);
    expect(onDisk(img)).toBe(true);
  });

  it('never deletes an image another product still uses', async () => {
    const a = await admin();
    const shared = await upload(a);
    const p1 = await newProduct(a, [shared]);
    const p2 = await newProduct(a, [shared]);
    await a.agent.delete(`/api/admin/products/${p1.id}`).expect(200);
    expect(onDisk(shared)).toBe(true);
    await a.agent.delete(`/api/admin/products/${p2.id}`).expect(200);
    expect(onDisk(shared)).toBe(false);
  });

  it('clears deleted images from old order snapshots so no order shows a dead link', async () => {
    const a = await admin();
    const c = await customer();
    const img = await upload(a);
    const other = await upload(a);
    const p = await newProduct(a, [img, other]);
    await c.agent.post('/api/cart').send({ productId: p.id, quantity: 1 });
    const addr = await makeAddress(c.user.id);
    const order = (await c.agent.post('/api/orders').send({ addressId: addr.id, paymentMethod: 'COD' }).expect(201)).body.order;
    expect(order.items[0].image).toBe(img); // first image is snapshotted

    const { category } = await import('./helpers.js');
    await a.agent.put(`/api/admin/products/${p.id}`).send({ ...body(await category(), [other]), name: p.name }).expect(200);
    expect(onDisk(img)).toBe(false);
    const after = (await c.agent.get(`/api/orders/${order.id}`)).body.order;
    expect(after.items[0].image).toBeNull();
  });

  it('never touches external image URLs (e.g. seed images)', async () => {
    const a = await admin();
    const ext = 'https://picsum.photos/seed/demo/800/800';
    const p = await newProduct(a, [ext]);
    const { category } = await import('./helpers.js');
    await a.agent.put(`/api/admin/products/${p.id}`).send({ ...body(await category(), []), name: p.name }).expect(200);
    await a.agent.delete(`/api/admin/products/${p.id}`).expect(200); // no crash, nothing to delete
  });
});

describe('abandoned uploads', () => {
  it('discard endpoint deletes an upload that was never saved to a product', async () => {
    const a = await admin();
    const url = await upload(a);
    const res = await a.agent.post('/api/admin/upload/discard').send({ url }).expect(200);
    expect(res.body.removed).toBe(true);
    expect(onDisk(url)).toBe(false);
  });

  it('discard endpoint REFUSES to delete an image a product is using', async () => {
    const a = await admin();
    const url = await upload(a);
    await newProduct(a, [url]);
    const res = await a.agent.post('/api/admin/upload/discard').send({ url }).expect(200);
    expect(res.body.removed).toBe(false);
    expect(onDisk(url)).toBe(true);
  });

  it('discard endpoint is admin-only and rejects non-image URLs', async () => {
    const c = await customer();
    expect((await c.agent.post('/api/admin/upload/discard').send({ url: '/uploads/x.png' })).status).toBe(403);
    expect((await request(app).post('/api/admin/upload/discard').send({ url: '/uploads/x.png' })).status).toBe(401);
    const a = await admin();
    expect((await a.agent.post('/api/admin/upload/discard').send({ url: 'javascript:alert(1)' })).status).toBe(400);
  });

  it('sweep removes old unreferenced files, keeps referenced and recent ones', async () => {
    const a = await admin();
    const used = await saveImage(png, 'png');
    await makeProduct({ images: JSON.stringify([used]) });
    const orphanOld = await saveImage(png, 'png');
    const orphanNew = await saveImage(png, 'png');
    const past = new Date(Date.now() - 3 * 3600_000);
    for (const u of [used, orphanOld]) fs.utimesSync(path.join(UPLOAD_DIR, path.basename(u)), past, past);

    const r = await sweepOrphanImages({ minAgeMs: 3600_000 });
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    expect(onDisk(orphanOld)).toBe(false); // old + unreferenced -> removed
    expect(onDisk(used)).toBe(true); // referenced -> kept even though old
    expect(onDisk(orphanNew)).toBe(true); // too recent (might be mid-upload) -> kept
    fs.rmSync(path.join(UPLOAD_DIR, path.basename(orphanNew)), { force: true });
    void a;
  });

  it('sweep never runs against an empty product table (mis-pointed database guard)', async () => {
    const orphan = await saveImage(png, 'png');
    const past = new Date(Date.now() - 3 * 3600_000);
    fs.utimesSync(path.join(UPLOAD_DIR, path.basename(orphan)), past, past);

    // Simulate "the app is pointed at an empty database": nothing references any image.
    const spy = vi.spyOn(prisma.product, 'count').mockResolvedValue(0 as never);
    try {
      const r = await sweepOrphanImages({ minAgeMs: 0 });
      expect(r.skipped).toBe('no products in database');
      expect(r.deleted).toBe(0);
      expect(onDisk(orphan)).toBe(true); // the file was NOT wiped
    } finally {
      spy.mockRestore();
      fs.rmSync(path.join(UPLOAD_DIR, path.basename(orphan)), { force: true });
    }
  });
});
