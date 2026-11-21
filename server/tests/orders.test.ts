import { describe, expect, it } from 'vitest';
import { app, customer, makeAddress, makeProduct, prisma, readyToCheckout, request } from './helpers.js';

const uniq = () => Math.random().toString(36).slice(2, 8).toUpperCase();

describe('cart', () => {
  it('cannot add more than stock, zero/negative/fractional quantities, or inactive products', async () => {
    const c = await customer();
    const p = await makeProduct({ stock: 3 });
    expect((await c.agent.post('/api/cart').send({ productId: p.id, quantity: 4 })).status).toBe(409);
    for (const q of [0, -1, 1.5, '2', 999]) {
      expect((await c.agent.post('/api/cart').send({ productId: p.id, quantity: q })).status).toBe(400);
    }
    const dead = await makeProduct({ isActive: false });
    expect((await c.agent.post('/api/cart').send({ productId: dead.id, quantity: 1 })).status).toBe(404);
  });

  it('merges repeated adds and still respects stock', async () => {
    const c = await customer();
    const p = await makeProduct({ stock: 3 });
    await c.agent.post('/api/cart').send({ productId: p.id, quantity: 2 }).expect(201);
    expect((await c.agent.post('/api/cart').send({ productId: p.id, quantity: 2 })).status).toBe(409);
    const cart = (await c.agent.post('/api/cart').send({ productId: p.id, quantity: 1 })).body;
    expect(cart.items[0].quantity).toBe(3);
  });
});

describe('checkout pricing integrity', () => {
  it('computes totals from DB prices and ignores any client-sent price/total', async () => {
    const c = await customer();
    const p = await makeProduct({ price: 50000 });
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 2 }]);
    const res = await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD', total: 1, price: 1, subtotal: 1, discount: 999999, shipping: 0 });
    expect(res.status).toBe(201);
    expect(res.body.order.subtotal).toBe(100000);
    expect(res.body.order.discount).toBe(0);
    expect(res.body.order.total).toBe(100000); // free shipping at >= ₹999
  });

  it('adds shipping under the free-shipping threshold', async () => {
    const c = await customer();
    const p = await makeProduct({ price: 20000 });
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 1 }]);
    const o = (await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD' })).body.order;
    expect(o.shipping).toBe(4900);
    expect(o.total).toBe(24900);
  });

  it('snapshots price so later price edits do not alter past orders', async () => {
    const c = await customer();
    const p = await makeProduct({ price: 30000 });
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 1 }]);
    const o = (await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD' })).body.order;
    await prisma.product.update({ where: { id: p.id }, data: { price: 99900 } });
    const again = (await c.agent.get(`/api/orders/${o.id}`)).body.order;
    expect(again.items[0].price).toBe(30000);
  });

  it('rejects empty carts and unknown payment methods', async () => {
    const c = await customer();
    const addr = await makeAddress(c.user.id);
    expect((await c.agent.post('/api/orders').send({ addressId: addr.id, paymentMethod: 'COD' })).status).toBe(400);
    const p = await makeProduct();
    await c.agent.post('/api/cart').send({ productId: p.id, quantity: 1 });
    expect((await c.agent.post('/api/orders').send({ addressId: addr.id, paymentMethod: 'BITCOIN' })).status).toBe(400);
  });

  it('empties the cart after ordering', async () => {
    const c = await customer();
    const p = await makeProduct();
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 1 }]);
    await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD' }).expect(201);
    expect((await c.agent.get('/api/cart')).body.items).toHaveLength(0);
  });
});

describe('order value ceiling', () => {
  it('rejects orders over ₹5,00,000 and leaves stock untouched', async () => {
    const c = await customer();
    const p = await makeProduct({ price: 30_000_000, mrp: 30_000_000, stock: 5 });
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 2 }]);
    const res = await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD' });
    expect(res.status).toBe(400);
    expect((await prisma.product.findUnique({ where: { id: p.id } }))!.stock).toBe(5);
    expect(await prisma.order.count({ where: { userId: c.user.id } })).toBe(0);
  });

  it('admin cannot create a product priced above the ceiling', async () => {
    const { admin, category } = await import('./helpers.js');
    const a = await admin();
    const res = await a.agent.post('/api/admin/products').send({ name: 'Too Dear', description: 'desc here', price: 60_000_000, mrp: 60_000_000, stock: 1, categoryId: await category() });
    expect(res.status).toBe(400);
  });
});

describe('stock integrity', () => {
  it('decrements stock on order and restores it on cancel', async () => {
    const c = await customer();
    const p = await makeProduct({ stock: 5 });
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 3 }]);
    const o = (await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD' })).body.order;
    expect((await prisma.product.findUnique({ where: { id: p.id } }))!.stock).toBe(2);
    await c.agent.post(`/api/orders/${o.id}/cancel`).expect(200);
    expect((await prisma.product.findUnique({ where: { id: p.id } }))!.stock).toBe(5);
  });

  it('cannot cancel twice (no double restock)', async () => {
    const c = await customer();
    const p = await makeProduct({ stock: 5 });
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 2 }]);
    const o = (await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD' })).body.order;
    await c.agent.post(`/api/orders/${o.id}/cancel`).expect(200);
    expect((await c.agent.post(`/api/orders/${o.id}/cancel`)).status).toBe(409);
    expect((await prisma.product.findUnique({ where: { id: p.id } }))!.stock).toBe(5);
  });

  it('never oversells when many buyers race for the last units', async () => {
    const p = await makeProduct({ stock: 2 });
    const buyers = await Promise.all(Array.from({ length: 5 }, () => customer()));
    const addrs = await Promise.all(
      buyers.map(async (b) => {
        const a = await makeAddress(b.user.id);
        await prisma.cartItem.create({ data: { userId: b.user.id, productId: p.id, quantity: 1 } });
        return a.id;
      }),
    );
    const results = await Promise.all(buyers.map((b, i) => b.agent.post('/api/orders').send({ addressId: addrs[i], paymentMethod: 'COD' })));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(2);
    expect(results.filter((r) => r.status === 409).length).toBe(3);
    expect((await prisma.product.findUnique({ where: { id: p.id } }))!.stock).toBe(0);
  });

  it('a failed multi-item checkout rolls back stock for every item', async () => {
    const c = await customer();
    const a = await makeProduct({ stock: 5 });
    const b = await makeProduct({ stock: 5 });
    const addr = await readyToCheckout(c, [{ id: a.id, qty: 2 }, { id: b.id, qty: 2 }]);
    await prisma.product.update({ where: { id: b.id }, data: { stock: 1 } }); // someone else bought it
    expect((await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD' })).status).toBe(409);
    expect((await prisma.product.findUnique({ where: { id: a.id } }))!.stock).toBe(5);
    expect(await prisma.order.count({ where: { userId: c.user.id } })).toBe(0);
  });

  it('shipped orders cannot be cancelled by the customer', async () => {
    const c = await customer();
    const p = await makeProduct();
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 1 }]);
    const o = (await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD' })).body.order;
    await prisma.order.update({ where: { id: o.id }, data: { status: 'SHIPPED' } });
    expect((await c.agent.post(`/api/orders/${o.id}/cancel`)).status).toBe(403);
  });
});

describe('coupons', () => {
  const mk = (over: Record<string, unknown> = {}) =>
    prisma.coupon.create({ data: { code: `T${uniq()}`, type: 'PERCENT', value: 10, ...over } as any });

  it('applies percent discount with cap', async () => {
    const c = await customer();
    const coupon = await mk({ value: 50, maxDiscount: 10000 });
    const p = await makeProduct({ price: 100000 });
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 1 }]);
    const o = (await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD', couponCode: coupon.code.toLowerCase() })).body.order;
    expect(o.discount).toBe(10000);
    expect(o.shipping).toBe(4900); // 90000 is below the ₹999 free-shipping threshold
    expect(o.total).toBe(94900);
  });

  it('rejects expired, inactive, unknown and below-minimum coupons', async () => {
    const c = await customer();
    const p = await makeProduct({ price: 50000 });
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 1 }]);
    const cases = [
      await mk({ expiresAt: new Date(Date.now() - 1000) }),
      await mk({ isActive: false }),
      await mk({ minOrder: 10_000_000 }),
    ];
    for (const cp of cases) {
      expect((await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD', couponCode: cp.code })).status).toBe(400);
    }
    expect((await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD', couponCode: 'NOPE123' })).status).toBe(400);
    // failed attempts must not have consumed stock
    expect(await prisma.order.count({ where: { userId: c.user.id } })).toBe(0);
    expect((await prisma.product.findUnique({ where: { id: p.id } }))!.stock).toBe(10);
  });

  it('enforces usage limit atomically', async () => {
    const coupon = await mk({ usageLimit: 1 });
    const buyers = await Promise.all([customer(), customer(), customer()]);
    const p = await makeProduct({ stock: 50 });
    const addrs = await Promise.all(
      buyers.map(async (b) => {
        await prisma.cartItem.create({ data: { userId: b.user.id, productId: p.id, quantity: 1 } });
        return (await makeAddress(b.user.id)).id;
      }),
    );
    const rs = await Promise.all(buyers.map((b, i) => b.agent.post('/api/orders').send({ addressId: addrs[i], paymentMethod: 'COD', couponCode: coupon.code })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await prisma.coupon.findUnique({ where: { id: coupon.id } }))!.usedCount).toBe(1);
  });

  it('releases the coupon when the order is cancelled', async () => {
    const c = await customer();
    const coupon = await mk({ usageLimit: 5 });
    const p = await makeProduct({ price: 100000 });
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 1 }]);
    const o = (await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD', couponCode: coupon.code })).body.order;
    expect((await prisma.coupon.findUnique({ where: { id: coupon.id } }))!.usedCount).toBe(1);
    await c.agent.post(`/api/orders/${o.id}/cancel`).expect(200);
    expect((await prisma.coupon.findUnique({ where: { id: coupon.id } }))!.usedCount).toBe(0);
  });

  it('validate endpoint previews the discount', async () => {
    const c = await customer();
    const coupon = await mk({ value: 10 });
    const p = await makeProduct({ price: 100000 });
    await readyToCheckout(c, [{ id: p.id, qty: 1 }]);
    const r = await c.agent.post('/api/coupons/validate').send({ code: coupon.code });
    expect(r.status).toBe(200);
    expect(r.body.discount).toBe(10000);
  });
});

describe('abandoned payment cleanup', () => {
  it('expires stale unpaid online orders and frees stock', async () => {
    const { expireStaleOrders } = await import('../src/services/orders.js');
    const c = await customer();
    const p = await makeProduct({ stock: 4 });
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 2 }]);
    const o = (await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'RAZORPAY' })).body.order;
    expect((await prisma.product.findUnique({ where: { id: p.id } }))!.stock).toBe(2);
    await prisma.order.update({ where: { id: o.id }, data: { createdAt: new Date(Date.now() - 3600_000) } });
    await expireStaleOrders(30);
    expect((await prisma.order.findUnique({ where: { id: o.id } }))!.status).toBe('CANCELLED');
    expect((await prisma.product.findUnique({ where: { id: p.id } }))!.stock).toBe(4);
  });
});

void request; void app;
