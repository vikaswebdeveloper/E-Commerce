import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { admin, app, customer, makeProduct, prisma, readyToCheckout, request, signPayment } from './helpers.js';
import { mockSignWebhook } from '../src/services/razorpay.js';

async function onlineOrder(c: Awaited<ReturnType<typeof customer>>, price = 50000, qty = 1) {
  const p = await makeProduct({ price });
  const addr = await readyToCheckout(c, [{ id: p.id, qty }]);
  const res = await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'RAZORPAY' }).expect(201);
  return { order: res.body.order, payment: res.body.payment, product: p };
}

describe('razorpay checkout', () => {
  it('creates a pending order with a gateway order for the exact server-computed amount', async () => {
    const c = await customer();
    const { order, payment } = await onlineOrder(c, 50000, 2);
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(payment.amount).toBe(order.total);
    expect(payment.razorpayOrderId).toMatch(/^order_/);
  });

  it('marks the order paid with a valid signature', async () => {
    const c = await customer();
    const { order, payment } = await onlineOrder(c);
    const res = await c.agent.post('/api/payments/verify').send(signPayment(payment.razorpayOrderId));
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('PAID');
    expect(res.body.order.paymentStatus).toBe('PAID');
    expect(res.body.order.id).toBe(order.id);
  });

  it('REJECTS a tampered signature and leaves the order unpaid', async () => {
    const c = await customer();
    const { order, payment } = await onlineOrder(c);
    const sig = signPayment(payment.razorpayOrderId);
    const bad = [
      { ...sig, razorpay_signature: 'a'.repeat(64) },
      { ...sig, razorpay_signature: '' },
      { ...sig, razorpay_signature: 'short' },
      { ...sig, razorpay_payment_id: 'pay_other' }, // signature belongs to a different payment id
    ];
    for (const b of bad) expect((await c.agent.post('/api/payments/verify').send(b)).status).toBe(400);
    expect((await prisma.order.findUnique({ where: { id: order.id } }))!.status).toBe('PENDING_PAYMENT');
  });

  it('cannot reuse a signature from order A to pay order B', async () => {
    const c = await customer();
    const a = await onlineOrder(c);
    const b = await onlineOrder(c);
    const sigA = signPayment(a.payment.razorpayOrderId);
    const forged = { ...sigA, razorpay_order_id: b.payment.razorpayOrderId };
    expect((await c.agent.post('/api/payments/verify').send(forged)).status).toBe(400);
    expect((await prisma.order.findUnique({ where: { id: b.order.id } }))!.status).toBe('PENDING_PAYMENT');
  });

  it("another user cannot verify (mark paid) someone else's order", async () => {
    const alice = await customer();
    const mallory = await customer();
    const { payment, order } = await onlineOrder(alice);
    const res = await mallory.agent.post('/api/payments/verify').send(signPayment(payment.razorpayOrderId));
    expect(res.status).toBe(404);
    expect((await prisma.order.findUnique({ where: { id: order.id } }))!.status).toBe('PENDING_PAYMENT');
  });

  it('is idempotent: verifying twice does not double-count', async () => {
    const c = await customer();
    const { payment, product } = await onlineOrder(c, 50000, 2);
    const sig = signPayment(payment.razorpayOrderId);
    await c.agent.post('/api/payments/verify').send(sig).expect(200);
    await c.agent.post('/api/payments/verify').send(sig).expect(200);
    expect((await prisma.product.findUnique({ where: { id: product.id } }))!.soldCount).toBe(2);
  });

  it('does not accept payment for a cancelled order', async () => {
    const c = await customer();
    const { order, payment } = await onlineOrder(c);
    await c.agent.post(`/api/orders/${order.id}/cancel`).expect(200);
    const res = await c.agent.post('/api/payments/verify').send(signPayment(payment.razorpayOrderId));
    expect(res.status).toBe(409);
    expect((await prisma.order.findUnique({ where: { id: order.id } }))!.status).toBe('CANCELLED');
  });

  it('refunds a paid online order on cancel and restocks', async () => {
    const c = await customer();
    const { order, payment, product } = await onlineOrder(c);
    await c.agent.post('/api/payments/verify').send(signPayment(payment.razorpayOrderId)).expect(200);
    const res = await c.agent.post(`/api/orders/${order.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('REFUNDED');
    expect(res.body.order.paymentStatus).toBe('REFUNDED');
    expect((await prisma.product.findUnique({ where: { id: product.id } }))!.stock).toBe(10);
  });
});

describe('razorpay webhook', () => {
  const send = (raw: string, sig?: string) =>
    request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', sig ?? mockSignWebhook(raw)).send(raw);

  const event = (orderId: string, amount: number) =>
    JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_${crypto.randomBytes(4).toString('hex')}`, order_id: orderId, amount } } } });

  it('rejects missing or invalid signatures', async () => {
    const c = await customer();
    const { payment, order } = await onlineOrder(c);
    const raw = event(payment.razorpayOrderId, order.total);
    expect((await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').send(raw)).status).toBe(400);
    expect((await send(raw, 'f'.repeat(64))).status).toBe(400);
    expect((await prisma.order.findUnique({ where: { id: order.id } }))!.status).toBe('PENDING_PAYMENT');
  });

  it('marks the order paid for a correctly signed capture event', async () => {
    const c = await customer();
    const { payment, order } = await onlineOrder(c);
    expect((await send(event(payment.razorpayOrderId, order.total))).status).toBe(200);
    expect((await prisma.order.findUnique({ where: { id: order.id } }))!.status).toBe('PAID');
  });

  it('ignores a signed event whose amount does not match the order total', async () => {
    const c = await customer();
    const { payment, order } = await onlineOrder(c, 100000);
    expect((await send(event(payment.razorpayOrderId, 100))).status).toBe(200);
    expect((await prisma.order.findUnique({ where: { id: order.id } }))!.status).toBe('PENDING_PAYMENT');
  });

  it('rejects a body modified after signing', async () => {
    const c = await customer();
    const { payment, order } = await onlineOrder(c);
    const good = event(payment.razorpayOrderId, order.total);
    const sig = mockSignWebhook(good);
    const tampered = good.replace(String(order.total), '1');
    expect((await send(tampered, sig)).status).toBe(400);
  });
});

describe('admin order management', () => {
  it('follows the allowed status state machine', async () => {
    const c = await customer();
    const a = await admin();
    const p = await makeProduct();
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 1 }]);
    const o = (await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD' })).body.order;
    const set = (status: string) => a.agent.patch(`/api/admin/orders/${o.id}/status`).send({ status });
    expect((await set('DELIVERED')).status).toBe(409); // cannot skip SHIPPED
    expect((await set('SHIPPED')).status).toBe(200);
    expect((await set('PROCESSING')).status).toBe(409); // cannot go backwards
    const done = await set('DELIVERED');
    expect(done.status).toBe(200);
    expect(done.body.order.paymentStatus).toBe('PAID'); // COD collected on delivery
    expect((await set('CANCELLED')).status).toBe(409);
    expect((await set('NONSENSE')).status).toBe(400);
  });

  it('admin cancel restocks', async () => {
    const c = await customer();
    const a = await admin();
    const p = await makeProduct({ stock: 4 });
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 3 }]);
    const o = (await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'COD' })).body.order;
    await a.agent.patch(`/api/admin/orders/${o.id}/status`).send({ status: 'CANCELLED' }).expect(200);
    expect((await prisma.product.findUnique({ where: { id: p.id } }))!.stock).toBe(4);
  });
});
