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
