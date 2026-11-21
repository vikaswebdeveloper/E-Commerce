import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { couponLimiter } from '../middleware/security.js';
import { conflict, notFound } from '../lib/errors.js';
import { id, parse, parseImages, text } from '../lib/validate.js';
import { computeDiscount, computeShipping } from '../services/pricing.js';

export const accountRouter = Router();

/* ------------------------------- Cart ------------------------------- */
const cartRouter = Router();
cartRouter.use(authenticate);

async function loadCart(userId: string) {
  const rows = await prisma.cartItem.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { id: 'asc' },
  });
  const items = rows
    .filter((r) => r.product.isActive)
    .map((r) => ({
      id: r.id,
      productId: r.productId,
      quantity: r.quantity,
      available: r.product.stock >= r.quantity,
      product: { id: r.product.id, name: r.product.name, slug: r.product.slug, price: r.product.price, mrp: r.product.mrp, stock: r.product.stock, images: parseImages(r.product.images) },
    }));
  const subtotal = items.reduce((s, i) => s + i.product.price * i.quantity, 0);
  return { items, subtotal, count: items.reduce((s, i) => s + i.quantity, 0) };
}

cartRouter.get('/', async (req, res) => res.json(await loadCart(req.user!.id)));

cartRouter.post('/', async (req, res) => {
  const b = parse(z.object({ productId: id, quantity: z.number().int().min(1).max(20).default(1) }), req.body);
  const p = await prisma.product.findFirst({ where: { id: b.productId, isActive: true } });
  if (!p) throw notFound('Product not found');
  const existing = await prisma.cartItem.findUnique({ where: { userId_productId: { userId: req.user!.id, productId: p.id } } });
  const qty = Math.min((existing?.quantity ?? 0) + b.quantity, 20);
  if (qty > p.stock) throw conflict(p.stock === 0 ? 'Out of stock' : `Only ${p.stock} left in stock`);
  await prisma.cartItem.upsert({
    where: { userId_productId: { userId: req.user!.id, productId: p.id } },
    create: { userId: req.user!.id, productId: p.id, quantity: qty },
    update: { quantity: qty },
  });
  res.status(201).json(await loadCart(req.user!.id));
});

cartRouter.put('/:productId', async (req, res) => {
  const productId = parse(id, req.params.productId);
  const b = parse(z.object({ quantity: z.number().int().min(1).max(20) }), req.body);
  const p = await prisma.product.findFirst({ where: { id: productId, isActive: true } });
  if (!p) throw notFound('Product not found');
  if (b.quantity > p.stock) throw conflict(`Only ${p.stock} left in stock`);
  const r = await prisma.cartItem.updateMany({ where: { userId: req.user!.id, productId }, data: { quantity: b.quantity } });
  if (r.count === 0) throw notFound('Item not in cart');
  res.json(await loadCart(req.user!.id));
});

cartRouter.delete('/:productId', async (req, res) => {
  await prisma.cartItem.deleteMany({ where: { userId: req.user!.id, productId: String(req.params.productId) } });
  res.json(await loadCart(req.user!.id));
});

accountRouter.use('/cart', cartRouter);

/* ----------------------------- Wishlist ----------------------------- */
const wishRouter = Router();
wishRouter.use(authenticate);

wishRouter.get('/', async (req, res) => {
  const rows = await prisma.wishlistItem.findMany({
    where: { userId: req.user!.id, product: { isActive: true } },
    include: { product: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ items: rows.map((r) => ({ id: r.id, product: { ...r.product, images: parseImages(r.product.images) } })) });
});

wishRouter.post('/:productId', async (req, res) => {
  const productId = parse(id, req.params.productId);
  if (!(await prisma.product.findFirst({ where: { id: productId, isActive: true } }))) throw notFound('Product not found');
  await prisma.wishlistItem.upsert({
    where: { userId_productId: { userId: req.user!.id, productId } },
    create: { userId: req.user!.id, productId },
    update: {},
  });
  res.status(201).json({ ok: true });
});

wishRouter.delete('/:productId', async (req, res) => {
  await prisma.wishlistItem.deleteMany({ where: { userId: req.user!.id, productId: String(req.params.productId) } });
  res.json({ ok: true });
});

accountRouter.use('/wishlist', wishRouter);

/* ----------------------------- Addresses ---------------------------- */
const addrRouter = Router();
addrRouter.use(authenticate);

const addressSchema = z.object({
  fullName: text(80, 2),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  line1: text(150, 3),
  line2: text(150).optional(),
  city: text(60, 2),
  state: text(60, 2),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit pincode'),
  isDefault: z.boolean().optional(),
});

addrRouter.get('/', async (req, res) => {
  res.json({ addresses: await prisma.address.findMany({ where: { userId: req.user!.id }, orderBy: [{ isDefault: 'desc' }, { id: 'desc' }] }) });
});

addrRouter.post('/', async (req, res) => {
  const b = parse(addressSchema, req.body);
  const count = await prisma.address.count({ where: { userId: req.user!.id } });
  if (count >= 10) throw conflict('You can save up to 10 addresses');
  const makeDefault = b.isDefault || count === 0;
  const a = await prisma.$transaction(async (tx) => {
    if (makeDefault) await tx.address.updateMany({ where: { userId: req.user!.id }, data: { isDefault: false } });
    return tx.address.create({ data: { ...b, userId: req.user!.id, isDefault: makeDefault } });
  });
  res.status(201).json({ address: a });
});

addrRouter.put('/:id', async (req, res) => {
  const b = parse(addressSchema, req.body);
  const aid = String(req.params.id);
  // Ownership enforced in the WHERE clause (prevents IDOR).
  const existing = await prisma.address.findFirst({ where: { id: aid, userId: req.user!.id } });
  if (!existing) throw notFound('Address not found');
  const a = await prisma.$transaction(async (tx) => {
    if (b.isDefault) await tx.address.updateMany({ where: { userId: req.user!.id }, data: { isDefault: false } });
    return tx.address.update({ where: { id: aid }, data: { ...b, line2: b.line2 ?? null, isDefault: b.isDefault ?? existing.isDefault } });
  });
  res.json({ address: a });
});

addrRouter.delete('/:id', async (req, res) => {
  const r = await prisma.address.deleteMany({ where: { id: String(req.params.id), userId: req.user!.id } });
  if (r.count === 0) throw notFound('Address not found');
  res.json({ ok: true });
});

accountRouter.use('/addresses', addrRouter);

/* ------------------------------ Reviews ----------------------------- */
const reviewRouter = Router();

async function recomputeRating(productId: string) {
  const agg = await prisma.review.aggregate({ where: { productId }, _avg: { rating: true }, _count: true });
  await prisma.product.update({
    where: { id: productId },
    data: { ratingAvg: Math.round((agg._avg.rating ?? 0) * 10) / 10, ratingCount: agg._count },
  });
}
export { recomputeRating };

reviewRouter.get('/product/:productId', optionalAuth, async (req, res) => {
  const productId = String(req.params.productId);
  const reviews = await prisma.review.findMany({
    where: { productId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: { id: true, name: true } } },
  });
  const buyers = await prisma.orderItem.findMany({
    where: { productId, order: { status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] }, userId: { in: reviews.map((r) => r.userId) } } },
    select: { order: { select: { userId: true } } },
  });
  const verified = new Set(buyers.map((b) => b.order.userId));
  const dist = await prisma.review.groupBy({ by: ['rating'], where: { productId }, _count: true });
  res.json({
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      comment: r.comment,
      createdAt: r.createdAt,
      userName: r.user.name,
      mine: r.userId === req.user?.id,
      verifiedPurchase: verified.has(r.userId),
    })),
    distribution: [1, 2, 3, 4, 5].map((s) => ({ stars: s, count: dist.find((d) => d.rating === s)?._count ?? 0 })),
  });
});

reviewRouter.put('/product/:productId', authenticate, async (req, res) => {
  const productId = parse(id, req.params.productId);
  const b = parse(z.object({ rating: z.number().int().min(1).max(5), title: text(100).optional(), comment: text(2000, 3) }), req.body);
  if (!(await prisma.product.findFirst({ where: { id: productId, isActive: true } }))) throw notFound('Product not found');
  const review = await prisma.review.upsert({
    where: { userId_productId: { userId: req.user!.id, productId } },
    create: { ...b, userId: req.user!.id, productId },
    update: { ...b, title: b.title ?? null },
  });
  await recomputeRating(productId);
  res.json({ review });
});

reviewRouter.delete('/product/:productId', authenticate, async (req, res) => {
  const productId = String(req.params.productId);
  const r = await prisma.review.deleteMany({ where: { userId: req.user!.id, productId } });
  if (r.count === 0) throw notFound('Review not found');
  await recomputeRating(productId);
  res.json({ ok: true });
});

accountRouter.use('/reviews', reviewRouter);

/* ------------------------------ Coupons ----------------------------- */
accountRouter.post('/coupons/validate', authenticate, couponLimiter(), async (req, res) => {
  const b = parse(z.object({ code: z.string().trim().toUpperCase().min(1).max(30) }), req.body);
  const cart = await loadCart(req.user!.id);
  const coupon = await prisma.coupon.findUnique({ where: { code: b.code } });
  const discount = computeDiscount(coupon, cart.subtotal);
  res.json({ code: b.code, discount, shipping: computeShipping(cart.subtotal - discount), total: cart.subtotal - discount + computeShipping(cart.subtotal - discount) });
});

export { loadCart };
