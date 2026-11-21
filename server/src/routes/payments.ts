import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { mockPayments } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { markPaid, refundLatePayment, serializeOrder } from '../services/orders.js';
import { mockSign, verifyPaymentSignature, verifyWebhookSignature } from '../services/razorpay.js';
import { sendMail } from '../lib/mailer.js';

export const paymentsRouter = Router();

/**
 * Razorpay webhook. Mounted with express.raw() so the signature is verified over the exact bytes.
 * Must stay BEFORE authentication: Razorpay calls it, not a user.
 */
paymentsRouter.post('/webhook', async (req, res) => {
  const raw = req.body as Buffer;
  const sig = req.headers['x-razorpay-signature'];
  if (!Buffer.isBuffer(raw) || typeof sig !== 'string' || !verifyWebhookSignature(raw, sig)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }
  let event: any;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  if (event?.event === 'payment.captured' || event?.event === 'order.paid') {
    const p = event.payload?.payment?.entity;
    if (p?.order_id && p?.id) {
      const order = await prisma.order.findUnique({ where: { razorpayOrderId: String(p.order_id) } });
      // Never trust amounts blindly: the captured amount must match what we charged.
      if (order && Number(p.amount) === order.total) {
        await markPaid(order.razorpayOrderId!, String(p.id));
        // Paid after the order expired/was cancelled -> give the money back automatically.
        const now = await prisma.order.findUnique({ where: { id: order.id } });
        if (now?.status === 'CANCELLED') await refundLatePayment(now, String(p.id)).catch((e) => console.error('[payments] late refund failed', e));
      }
    }
  }
  res.json({ ok: true });
});

/** Called by the browser after checkout succeeds. Verifies the HMAC signature server-side. */
paymentsRouter.post('/verify', authenticate, async (req, res) => {
  const b = parse(
    z.object({ razorpay_order_id: z.string().max(60), razorpay_payment_id: z.string().max(60), razorpay_signature: z.string().max(200) }),
    req.body,
  );
  const order = await prisma.order.findUnique({ where: { razorpayOrderId: b.razorpay_order_id }, include: { items: true } });
  if (!order || order.userId !== req.user!.id) throw notFound('Order not found');
  if (!verifyPaymentSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) {
    throw new AppError(400, 'Payment verification failed');
  }
  const changed = await markPaid(b.razorpay_order_id, b.razorpay_payment_id);
  if (changed) {
    await sendMail(
      req.user!.email,
      `Payment received for order #${order.id.slice(-8).toUpperCase()}`,
      `Thanks! We received your payment of ₹${order.total / 100} for order #${order.id.slice(-8).toUpperCase()}.\n\nWe'll let you know when it ships.\n\n— Shop`,
    );
  }
  const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  if (fresh.status === 'CANCELLED') {
    // The customer paid after the order expired: refund automatically so they are never charged for nothing.
    await refundLatePayment(fresh, b.razorpay_payment_id).catch((e) => console.error('[payments] late refund failed', e));
    throw new AppError(409, 'This order had expired or was cancelled, so your payment is being refunded automatically.');
  }
  if (fresh.status === 'REFUNDED') throw new AppError(409, 'Order was cancelled');
  res.json({ order: serializeOrder(fresh) });
});

/* Mock gateway: only exists when no Razorpay keys are configured AND not in production. */
if (mockPayments) {
  paymentsRouter.post('/mock-pay', authenticate, async (req, res) => {
    const b = parse(z.object({ razorpayOrderId: z.string().max(60) }), req.body);
    const order = await prisma.order.findUnique({ where: { razorpayOrderId: b.razorpayOrderId } });
    if (!order || order.userId !== req.user!.id) throw notFound('Order not found');
    const paymentId = `pay_mock_${crypto.randomBytes(6).toString('hex')}`;
    res.json({
      razorpay_order_id: b.razorpayOrderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: mockSign(b.razorpayOrderId, paymentId),
    });
  });
}
