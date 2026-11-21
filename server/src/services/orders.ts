import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError, conflict } from '../lib/errors.js';
import { refundPayment } from './razorpay.js';
import { parseImages } from '../lib/validate.js';
import { TX_OPTS } from '../config.js';

export const serializeOrder = (o: any) => ({
  ...o,
  shippingAddress: safeJson(o.shippingAddress),
  items: o.items?.map((i: any) => ({ ...i, image: i.image ?? null })),
});

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export const ORDER_TRANSITIONS: Record<string, string[]> = {
  PENDING_PAYMENT: ['CANCELLED'],
  PAID: ['PROCESSING', 'SHIPPED', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
};

/** Restock items and release the coupon within a transaction. */
async function release(tx: Prisma.TransactionClient, order: { id: string; couponCode: string | null; items: { productId: string; quantity: number }[] }) {
  for (const it of order.items) {
    await tx.product.update({ where: { id: it.productId }, data: { stock: { increment: it.quantity } } });
  }
  if (order.couponCode) {
    await tx.coupon.updateMany({ where: { code: order.couponCode, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
  }
}

/**
 * Cancels an order (restocks, releases coupon, refunds if already paid online).
 * Atomic against double-cancel: status is changed with a conditional update.
 */
export async function cancelOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw new AppError(404, 'Order not found');
  if (!ORDER_TRANSITIONS[order.status]?.includes('CANCELLED')) throw conflict(`Order cannot be cancelled when ${order.status}`);

  const needsRefund = order.paymentMethod === 'RAZORPAY' && order.paymentStatus === 'PAID' && !!order.razorpayPaymentId;
  const nextStatus = needsRefund ? 'REFUNDED' : 'CANCELLED';

  await prisma.$transaction(async (tx) => {
    const r = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: nextStatus, paymentStatus: needsRefund ? 'REFUNDED' : order.paymentStatus === 'PENDING' ? 'FAILED' : order.paymentStatus },
    });
    if (r.count !== 1) throw conflict('Order was modified, please retry');
    await release(tx, order);
  }, TX_OPTS);

  if (needsRefund) {
    try {
      await refundPayment(order.razorpayPaymentId!, order.total);
    } catch (e) {
      // Gateway failure: flag for manual follow-up rather than losing track of the money.
      await prisma.order.update({ where: { id: orderId }, data: { paymentStatus: 'PAID', status: 'CANCELLED' } });
      throw new AppError(502, 'Order cancelled but refund failed at gateway; needs manual refund');
    }
  }
  return prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
}

/** Marks an order paid exactly once (idempotent). Returns true if this call performed the transition. */
export async function markPaid(razorpayOrderId: string, paymentId: string) {
  const r = await prisma.order.updateMany({
    where: { razorpayOrderId, status: 'PENDING_PAYMENT' },
    data: { status: 'PAID', paymentStatus: 'PAID', razorpayPaymentId: paymentId },
  });
  if (r.count === 1) {
    const o = await prisma.order.findUnique({ where: { razorpayOrderId }, include: { items: true } });
    if (o) {
      for (const it of o.items) {
        await prisma.product.update({ where: { id: it.productId }, data: { soldCount: { increment: it.quantity } } });
      }
    }
    return true;
  }
  return false;
}

/**
 * A genuine, signature-verified payment arrived for an order that was already cancelled/expired (the customer paid
 * after the 30-minute window). The goods can't be shipped, so return the money automatically.
 * Idempotent: the "claim" is a conditional update, so concurrent verify + webhook calls refund exactly once.
 * Returns true if this call issued the refund. If the gateway refund fails the order is flagged
 * (CANCELLED + paymentStatus PAID) so an admin can refund manually.
 */
export async function refundLatePayment(order: { id: string; total: number; status: string }, paymentId: string): Promise<boolean> {
  if (order.status !== 'CANCELLED') return false;
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, status: 'CANCELLED', razorpayPaymentId: null, paymentStatus: { not: 'REFUNDED' } },
    data: { razorpayPaymentId: paymentId, paymentStatus: 'REFUNDED' },
  });
  if (claimed.count !== 1) return false;
  try {
    await refundPayment(paymentId, order.total);
    return true;
  } catch (e) {
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
    console.error(`[payments] late payment ${paymentId} for order ${order.id} could not be auto-refunded: needs manual refund`, (e as Error).message);
    return false;
  }
}

let lastExpiryRun = 0;
/** Runs the stale-order cleanup at most once per interval per instance. Used on serverless hosts that have no timers. */
export async function expireStaleOrdersThrottled(ttlMinutes: number, everyMs = 5 * 60_000) {
  if (Date.now() - lastExpiryRun < everyMs) return 0;
  lastExpiryRun = Date.now();
  try {
    return await expireStaleOrders(ttlMinutes);
  } catch (e) {
    console.error('[orders] stale order cleanup failed', (e as Error).message);
    return 0;
  }
}

/** Cancel unpaid online orders older than TTL and free their stock. */
export async function expireStaleOrders(ttlMinutes: number) {
  const cutoff = new Date(Date.now() - ttlMinutes * 60_000);
  const stale = await prisma.order.findMany({ where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } }, select: { id: true } });
  for (const s of stale) {
    try {
      await cancelOrder(s.id);
    } catch {
      /* already handled elsewhere */
    }
  }
  return stale.length;
}

export const productView = (p: any) => ({ ...p, images: parseImages(p.images) });
