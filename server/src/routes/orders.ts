import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { id, parse, parseImages } from '../lib/validate.js';
import { computeDiscount, computeShipping } from '../services/pricing.js';
import { cancelOrder, serializeOrder } from '../services/orders.js';
import { createGatewayOrder, publicKeyId } from '../services/razorpay.js';
import { sendMail } from '../lib/mailer.js';
import { MAX_ORDER_VALUE, TX_OPTS } from '../config.js';

export const ordersRouter = Router();
ordersRouter.use(authenticate);

const checkoutSchema = z.object({
  addressId: id,
  paymentMethod: z.enum(['RAZORPAY', 'COD']),
  couponCode: z.string().trim().toUpperCase().max(30).optional(),
});

/**
 * Checkout. All money values are computed server-side from the DB; the client only
 * supplies *which* address / payment method / coupon. Stock is reserved atomically.
 */
ordersRouter.post('/', async (req, res) => {
  const b = parse(checkoutSchema, req.body);
  const userId = req.user!.id;

  const address = await prisma.address.findFirst({ where: { id: b.addressId, userId } });
  if (!address) throw new AppError(400, 'Select a valid delivery address');

  const cart = await prisma.cartItem.findMany({ where: { userId }, include: { product: true } });
  if (cart.length === 0) throw new AppError(400, 'Your cart is empty');

  const order = await prisma.$transaction(async (tx) => {
    let subtotal = 0;
    for (const c of cart) {
      if (!c.product.isActive) throw conflict(`"${c.product.name}" is no longer available`);
      // Conditional decrement => cannot oversell even under concurrent checkouts.
      const r = await tx.product.updateMany({
        where: { id: c.productId, isActive: true, stock: { gte: c.quantity } },
        data: { stock: { decrement: c.quantity } },
      });
      if (r.count !== 1) throw conflict(`Not enough stock for "${c.product.name}"`);
      subtotal += c.product.price * c.quantity;
      // Keeps every money column well inside Postgres INT4 and under Razorpay's per-order ceiling.
      if (subtotal > MAX_ORDER_VALUE) throw new AppError(400, 'Order value exceeds ₹5,00,000. Please split it into smaller orders.');
    }

    let discount = 0;
    let couponCode: string | null = null;
    if (b.couponCode) {
      const coupon = await tx.coupon.findUnique({ where: { code: b.couponCode } });
      discount = computeDiscount(coupon, subtotal);
      // Atomic usage-limit enforcement.
      const used = await tx.coupon.updateMany({
        where: coupon!.usageLimit === null ? { id: coupon!.id } : { id: coupon!.id, usedCount: { lt: coupon!.usageLimit } },
        data: { usedCount: { increment: 1 } },
      });
      if (used.count !== 1) throw new AppError(400, 'Coupon usage limit reached');
      couponCode = coupon!.code;
    }
    const shipping = computeShipping(subtotal - discount);
    const total = subtotal - discount + shipping;
    const cod = b.paymentMethod === 'COD';

    const created = await tx.order.create({
      data: {
        userId,
        status: cod ? 'PROCESSING' : 'PENDING_PAYMENT',
        paymentMethod: b.paymentMethod,
        paymentStatus: 'PENDING',
        subtotal,
        discount,
        shipping,
        total,
        couponCode,
        shippingAddress: JSON.stringify({
          fullName: address.fullName, phone: address.phone, line1: address.line1, line2: address.line2,
          city: address.city, state: address.state, pincode: address.pincode,
        }),
        items: {
          create: cart.map((c) => ({
            productId: c.productId,
            name: c.product.name,
            image: parseImages(c.product.images)[0] ?? null,
            price: c.product.price,
            quantity: c.quantity,
          })),
        },
      },
      include: { items: true },
    });
    if (cod) {
      for (const c of cart) await tx.product.update({ where: { id: c.productId }, data: { soldCount: { increment: c.quantity } } });
    }
    await tx.cartItem.deleteMany({ where: { userId } });
    return created;
  }, TX_OPTS);

  let payment: { keyId: string; razorpayOrderId: string; amount: number; currency: string } | null = null;
  if (order.paymentMethod === 'RAZORPAY') {
    try {
      const g = await createGatewayOrder(order.total, order.id);
      await prisma.order.update({ where: { id: order.id }, data: { razorpayOrderId: g.id } });
      payment = { keyId: publicKeyId(), razorpayOrderId: g.id, amount: order.total, currency: 'INR' };
    } catch {
      await cancelOrder(order.id).catch(() => undefined);
      throw new AppError(502, 'Payment gateway unavailable, please try again');
    }
  } else {
    void sendMail(req.user!.email, `Order ${order.id} confirmed`, `Thanks for your order. Total ₹${order.total / 100}`);
  }
  res.status(201).json({ order: serializeOrder(order), payment });
});

ordersRouter.get('/', async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: { items: true },
    take: 100,
  });
  res.json({ orders: orders.map(serializeOrder) });
});

ordersRouter.get('/:id', async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: String(req.params.id) }, include: { items: true } });
  // Same 404 for "doesn't exist" and "not yours" so IDs can't be probed.
  if (!o || (o.userId !== req.user!.id && req.user!.role !== 'ADMIN')) throw notFound('Order not found');
  res.json({ order: serializeOrder(o) });
});

/** Re-initiate payment for an unpaid order (e.g. user closed the Razorpay modal). */
ordersRouter.post('/:id/pay', async (req, res) => {
  const o = await prisma.order.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
  if (!o) throw notFound('Order not found');
  if (o.paymentMethod !== 'RAZORPAY' || o.status !== 'PENDING_PAYMENT' || !o.razorpayOrderId) throw conflict('Order is not awaiting payment');
  res.json({ payment: { keyId: publicKeyId(), razorpayOrderId: o.razorpayOrderId, amount: o.total, currency: 'INR' } });
});

ordersRouter.post('/:id/cancel', async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: String(req.params.id) } });
  if (!o || o.userId !== req.user!.id) throw notFound('Order not found');
  if (o.status === 'SHIPPED' || o.status === 'DELIVERED') throw forbidden('Shipped orders cannot be cancelled');
  const updated = await cancelOrder(o.id);
  res.json({ order: serializeOrder(updated) });
});
