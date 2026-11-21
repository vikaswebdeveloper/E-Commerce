import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { app, customer, makeProduct, prisma, readyToCheckout, request, signPayment } from './helpers.js';
import { mockSignWebhook } from '../src/services/razorpay.js';

async function expiredOrder(c: Awaited<ReturnType<typeof customer>>, price = 50000) {
  const p = await makeProduct({ price });
  const addr = await readyToCheckout(c, [{ id: p.id, qty: 1 }]);
  const res = await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'RAZORPAY' }).expect(201);
  const { order, payment } = res.body;
  await c.agent.post(`/api/orders/${order.id}/cancel`).expect(200); // stands in for the 30-minute expiry
  return { order, payment, product: p };
}

describe('payment arriving after the order expired -> automatic refund', () => {
  it('refunds when the browser reports a valid payment for a cancelled order', async () => {
    const c = await customer();
    const { order, payment } = await expiredOrder(c);
    const sig = signPayment(payment.razorpayOrderId);

    const res = await c.agent.post('/api/payments/verify').send(sig);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/refunded automatically/i);

    const o = (await prisma.order.findUnique({ where: { id: order.id } }))!;
    expect(o.status).toBe('CANCELLED');
    expect(o.paymentStatus).toBe('REFUNDED');
    expect(o.razorpayPaymentId).toBe(sig.razorpay_payment_id);
  });

  it('refunds exactly once even if verify is replayed', async () => {
    const c = await customer();
    const { order, payment } = await expiredOrder(c);
    const first = signPayment(payment.razorpayOrderId);
    await c.agent.post('/api/payments/verify').send(first).expect(409);
    // a replay (or a second, different payment id) must not trigger another refund
    await c.agent.post('/api/payments/verify').send(first).expect(409);
    await c.agent.post('/api/payments/verify').send(signPayment(payment.razorpayOrderId, 'pay_second')).expect(409);
    const o = (await prisma.order.findUnique({ where: { id: order.id } }))!;
    expect(o.razorpayPaymentId).toBe(first.razorpay_payment_id); // still the first payment only
    expect(o.paymentStatus).toBe('REFUNDED');
  });

  it('refunds when the webhook reports the late payment', async () => {
    const c = await customer();
    const { order, payment } = await expiredOrder(c);
    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_${crypto.randomBytes(4).toString('hex')}`, order_id: payment.razorpayOrderId, amount: order.total } } } });
    const res = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', mockSignWebhook(raw)).send(raw);
    expect(res.status).toBe(200);
    expect((await prisma.order.findUnique({ where: { id: order.id } }))!.paymentStatus).toBe('REFUNDED');
  });

  it('does NOT refund a normal on-time payment (and a duplicate webhook is harmless)', async () => {
    const c = await customer();
    const p = await makeProduct();
    const addr = await readyToCheckout(c, [{ id: p.id, qty: 1 }]);
    const { order, payment } = (await c.agent.post('/api/orders').send({ addressId: addr, paymentMethod: 'RAZORPAY' }).expect(201)).body;
    const sig = signPayment(payment.razorpayOrderId);
    await c.agent.post('/api/payments/verify').send(sig).expect(200);

    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: sig.razorpay_payment_id, order_id: payment.razorpayOrderId, amount: order.total } } } });
    await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', mockSignWebhook(raw)).send(raw).expect(200);

    const o = (await prisma.order.findUnique({ where: { id: order.id } }))!;
    expect(o.status).toBe('PAID');
    expect(o.paymentStatus).toBe('PAID');
  });

  it('ignores a forged signature: nobody can trigger refunds by posting fake payments', async () => {
    const c = await customer();
    const { order, payment } = await expiredOrder(c);
    const forged = { ...signPayment(payment.razorpayOrderId), razorpay_signature: 'a'.repeat(64) };
    expect((await c.agent.post('/api/payments/verify').send(forged)).status).toBe(400);
    const o = (await prisma.order.findUnique({ where: { id: order.id } }))!;
    expect(o.razorpayPaymentId).toBeNull();
    expect(o.paymentStatus).not.toBe('REFUNDED');
  });
});
