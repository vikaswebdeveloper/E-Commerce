import { describe, expect, it } from 'vitest';
import { admin, app, customer, makeAddress, makeProduct, readyToCheckout, request } from './helpers.js';

const adminRoutes: [string, string][] = [
  ['get', '/api/admin/stats'],
  ['get', '/api/admin/products'],
  ['post', '/api/admin/products'],
  ['put', '/api/admin/products/x'],
  ['delete', '/api/admin/products/x'],
  ['post', '/api/admin/categories'],
  ['put', '/api/admin/categories/x'],
  ['delete', '/api/admin/categories/x'],
  ['get', '/api/admin/orders'],
  ['get', '/api/admin/orders/x'],
  ['patch', '/api/admin/orders/x/status'],
  ['get', '/api/admin/customers'],
  ['patch', '/api/admin/customers/x/block'],
  ['get', '/api/admin/coupons'],
  ['post', '/api/admin/coupons'],
  ['put', '/api/admin/coupons/x'],
  ['delete', '/api/admin/coupons/x'],
  ['get', '/api/admin/reviews'],
  ['delete', '/api/admin/reviews/x'],
  ['get', '/api/admin/audit'],
  ['post', '/api/admin/upload'],
];

describe('admin routes are protected', () => {
  it.each(adminRoutes)('anonymous %s %s -> 401', async (m, url) => {
    const res = await (request(app) as any)[m](url).send({});
    expect(res.status).toBe(401);
  });

  it.each(adminRoutes)('customer %s %s -> 403', async (m, url) => {
    const c = await customer();
    const res = await (c.agent as any)[m](url).send({});
    expect(res.status).toBe(403);
  });

  it('admin can reach the dashboard', async () => {
    const a = await admin();
    const res = await a.agent.get('/api/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('revenue');
  });
});

describe('customer-only routes need login', () => {
  it.each([
    ['get', '/api/cart'], ['get', '/api/wishlist'], ['get', '/api/addresses'], ['get', '/api/orders'], ['post', '/api/orders'],
    ['post', '/api/payments/verify'], ['put', '/api/reviews/product/x'],
  ])('anonymous %s %s -> 401', async (m, url) => {
    expect((await (request(app) as any)[m](url).send({})).status).toBe(401);
  });
});

describe('IDOR / horizontal access', () => {
  it("a user cannot read another user's order (404, not 403, to avoid probing)", async () => {
    const alice = await customer();
    const bob = await customer();
    const p = await makeProduct();
    const addr = await readyToCheckout(alice, [{ id: p.id, qty: 1 }]);
    const order = (await alice.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD' }).expect(201)).body.order;
    expect((await bob.agent.get(`/api/orders/${order.id}`)).status).toBe(404);
    expect((await alice.agent.get(`/api/orders/${order.id}`)).status).toBe(200);
  });

  it("a user cannot cancel or pay for another user's order", async () => {
    const alice = await customer();
    const bob = await customer();
    const p = await makeProduct();
    const addr = await readyToCheckout(alice, [{ id: p.id, qty: 1 }]);
    const order = (await alice.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'RAZORPAY' }).expect(201)).body.order;
    expect((await bob.agent.post(`/api/orders/${order.id}/cancel`)).status).toBe(404);
    expect((await bob.agent.post(`/api/orders/${order.id}/pay`)).status).toBe(404);
  });

  it("a user cannot use, edit or delete another user's address", async () => {
    const alice = await customer();
    const bob = await customer();
    const addr = await makeAddress(alice.user.id);
    const body = { fullName: 'Mallory', phone: '9876543210', line1: '1 Evil Road', city: 'Xx', state: 'Yy', pincode: '110001' };
    expect((await bob.agent.put(`/api/addresses/${addr.id}`).send(body)).status).toBe(404);
    expect((await bob.agent.delete(`/api/addresses/${addr.id}`)).status).toBe(404);
    const p = await makeProduct();
    await bob.agent.post('/api/cart').send({ productId: p.id, quantity: 1 });
    expect((await bob.agent.post('/api/orders').send({ addressId: addr.id, paymentMethod: 'COD' })).status).toBe(400);
  });

  it("cart and wishlist are per-user", async () => {
    const alice = await customer();
    const bob = await customer();
    const p = await makeProduct();
    await alice.agent.post('/api/cart').send({ productId: p.id, quantity: 2 });
    await alice.agent.post(`/api/wishlist/${p.id}`);
    expect((await bob.agent.get('/api/cart')).body.items).toHaveLength(0);
    expect((await bob.agent.get('/api/wishlist')).body.items).toHaveLength(0);
  });

  it('a customer cannot delete another customer’s review', async () => {
    const alice = await customer();
    const bob = await customer();
    const p = await makeProduct();
    await alice.agent.put(`/api/reviews/product/${p.id}`).send({ rating: 5, comment: 'Great stuff' }).expect(200);
    expect((await bob.agent.delete(`/api/reviews/product/${p.id}`)).status).toBe(404);
  });

  it('admins cannot be blocked', async () => {
    const a = await admin();
    const b = await admin();
    expect((await a.agent.patch(`/api/admin/customers/${b.user.id}/block`).send({ blocked: true })).status).toBe(403);
  });
});
