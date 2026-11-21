import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db.js';
import { MAX_ORDER_VALUE } from '../config.js';
import { saveImage } from '../services/storage.js';
import { releaseImages } from '../services/imageCleanup.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { id, imageUrl, parse, parseImages, slugify, text } from '../lib/validate.js';
import { cancelOrder, ORDER_TRANSITIONS, productView, serializeOrder } from '../services/orders.js';
import { recomputeRating } from './account.js';

export const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin);

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

/* ------------------------------ Dashboard ------------------------------ */
adminRouter.get('/stats', async (_req, res) => {
  const paidStatuses = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
  const since = new Date(Date.now() - 6 * 86400_000);
  since.setHours(0, 0, 0, 0);
  const [revenue, orders, customers, products, lowStock, recent, recentOrders, statusCounts] = await Promise.all([
    prisma.order.aggregate({ where: { status: { in: paidStatuses } }, _sum: { total: true } }),
    prisma.order.count(),
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.product.findMany({ where: { isActive: true, stock: { lte: 5 } }, orderBy: { stock: 'asc' }, take: 8, select: { id: true, name: true, stock: true } }),
    prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 6, include: { user: { select: { name: true, email: true } } } }),
    prisma.order.findMany({ where: { status: { in: paidStatuses }, createdAt: { gte: since } }, select: { total: true, createdAt: true } }),
    prisma.order.groupBy({ by: ['status'], _count: true }),
  ]);
  const days: { date: string; revenue: number; orders: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(since.getTime() + i * 86400_000);
    days.push({ date: d.toISOString().slice(0, 10), revenue: 0, orders: 0 });
  }
  for (const o of recentOrders) {
    const key = o.createdAt.toISOString().slice(0, 10);
    const day = days.find((d) => d.date === key);
    if (day) {
      day.revenue += o.total;
      day.orders += 1;
    }
  }
  res.json({
    revenue: revenue._sum.total ?? 0,
    orders, customers, products, lowStock,
    recentOrders: recent.map((o) => ({ id: o.id, total: o.total, status: o.status, createdAt: o.createdAt, customer: o.user.name })),
    salesByDay: days,
    statusCounts: statusCounts.map((s) => ({ status: s.status, count: s._count })),
  });
});

/* ------------------------------- Products ------------------------------ */
const productSchema = z
  .object({
    name: text(150, 2),
    description: text(5000, 3),
    price: z.number().int().min(1).max(MAX_ORDER_VALUE),
    mrp: z.number().int().min(1).max(MAX_ORDER_VALUE),
    stock: z.number().int().min(0).max(1_000_000),
    images: z.array(imageUrl).max(8).default([]),
    brand: text(60).optional(),
    categoryId: id,
    isActive: z.boolean().default(true),
    isFeatured: z.boolean().default(false),
  })
  .refine((p) => p.mrp >= p.price, { message: 'MRP must be greater than or equal to price', path: ['mrp'] });

async function uniqueSlug(name: string, excludeId?: string) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await prisma.product.findFirst({ where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) } }); i++) slug = `${base}-${i}`;
  return slug;
}

adminRouter.get('/products', async (req, res) => {
  const q = parse(pageQuery.extend({ status: z.enum(['active', 'inactive', 'low']).optional() }), req.query);
  const where: Prisma.ProductWhereInput = {};
  if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { brand: { contains: q.q, mode: 'insensitive' } }];
  if (q.status === 'active') where.isActive = true;
  if (q.status === 'inactive') where.isActive = false;
  if (q.status === 'low') where.stock = { lte: 5 };
  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit, include: { category: { select: { name: true } } } }),
  ]);
  res.json({ items: items.map(productView), total, pages: Math.max(1, Math.ceil(total / q.limit)) });
});

adminRouter.post('/products', async (req, res) => {
  const b = parse(productSchema, req.body);
  if (!(await prisma.category.findUnique({ where: { id: b.categoryId } }))) throw new AppError(400, 'Unknown category');
  const p = await prisma.product.create({ data: { ...b, images: JSON.stringify(b.images), slug: await uniqueSlug(b.name) } });
  await audit(req.user!.id, 'CREATE', 'Product', p.id, { name: p.name });
  res.status(201).json({ product: productView(p) });
});

adminRouter.put('/products/:id', async (req, res) => {
  const pid = String(req.params.id);
  const b = parse(productSchema, req.body);
  const existing = await prisma.product.findUnique({ where: { id: pid } });
  if (!existing) throw notFound('Product not found');
  if (!(await prisma.category.findUnique({ where: { id: b.categoryId } }))) throw new AppError(400, 'Unknown category');
  const p = await prisma.product.update({
    where: { id: pid },
    data: { ...b, images: JSON.stringify(b.images), brand: b.brand ?? null, slug: existing.name === b.name ? existing.slug : await uniqueSlug(b.name, pid) },
  });
  await audit(req.user!.id, 'UPDATE', 'Product', pid, { name: p.name });
  // Images dropped from the product are deleted from storage right away.
  const kept = new Set(b.images);
  await releaseImages(parseImages(existing.images).filter((u) => !kept.has(u)));
  res.json({ product: productView(p) });
});

adminRouter.delete('/products/:id', async (req, res) => {
  const pid = String(req.params.id);
  const p = await prisma.product.findUnique({ where: { id: pid }, include: { _count: { select: { orderItems: true } } } });
  if (!p) throw notFound('Product not found');
  // Products referenced by past orders are archived instead of deleted, to preserve order history.
  if (p._count.orderItems > 0) {
    await prisma.product.update({ where: { id: pid }, data: { isActive: false } });
    await audit(req.user!.id, 'ARCHIVE', 'Product', pid);
    return res.json({ ok: true, archived: true });
  }
  await prisma.product.delete({ where: { id: pid } });
  await audit(req.user!.id, 'DELETE', 'Product', pid, { name: p.name });
  await releaseImages(parseImages(p.images));
  res.json({ ok: true, archived: false });
});

/* ------------------------------ Categories ----------------------------- */
const categorySchema = z.object({ name: text(60, 2) });

adminRouter.post('/categories', async (req, res) => {
  const b = parse(categorySchema, req.body);
  const c = await prisma.category.create({ data: { name: b.name, slug: slugify(b.name) } });
  await audit(req.user!.id, 'CREATE', 'Category', c.id, { name: c.name });
  res.status(201).json({ category: c });
});

adminRouter.put('/categories/:id', async (req, res) => {
  const b = parse(categorySchema, req.body);
  const c = await prisma.category.update({ where: { id: String(req.params.id) }, data: { name: b.name, slug: slugify(b.name) } });
  await audit(req.user!.id, 'UPDATE', 'Category', c.id);
  res.json({ category: c });
});

adminRouter.delete('/categories/:id', async (req, res) => {
  const cid = String(req.params.id);
  if ((await prisma.product.count({ where: { categoryId: cid } })) > 0) throw conflict('Category still has products');
  await prisma.category.delete({ where: { id: cid } });
  await audit(req.user!.id, 'DELETE', 'Category', cid);
  res.json({ ok: true });
});

/* -------------------------------- Orders ------------------------------- */
adminRouter.get('/orders', async (req, res) => {
  const q = parse(pageQuery.extend({ status: z.string().max(30).optional() }), req.query);
  const where: Prisma.OrderWhereInput = {};
  if (q.status) where.status = q.status;
  if (q.q) {
    where.OR = [
      { id: { contains: q.q, mode: 'insensitive' } },
      { user: { email: { contains: q.q, mode: 'insensitive' } } },
      { user: { name: { contains: q.q, mode: 'insensitive' } } },
    ];
  }
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit, include: { items: true, user: { select: { name: true, email: true } } } }),
  ]);
  res.json({ orders: orders.map(serializeOrder), total, pages: Math.max(1, Math.ceil(total / q.limit)) });
});

adminRouter.get('/orders/:id', async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: String(req.params.id) }, include: { items: true, user: { select: { name: true, email: true } } } });
  if (!o) throw notFound('Order not found');
  res.json({ order: serializeOrder(o) });
});

adminRouter.patch('/orders/:id/status', async (req, res) => {
  const b = parse(z.object({ status: z.enum(['PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']) }), req.body);
  const oid = String(req.params.id);
  const o = await prisma.order.findUnique({ where: { id: oid } });
  if (!o) throw notFound('Order not found');
  if (!ORDER_TRANSITIONS[o.status]?.includes(b.status)) throw conflict(`Cannot move order from ${o.status} to ${b.status}`);
  let result;
  if (b.status === 'CANCELLED') {
    result = await cancelOrder(oid);
  } else {
    result = await prisma.order.update({
      where: { id: oid },
      data: { status: b.status, ...(b.status === 'DELIVERED' && o.paymentMethod === 'COD' ? { paymentStatus: 'PAID' } : {}) },
      include: { items: true },
    });
  }
  await audit(req.user!.id, 'STATUS', 'Order', oid, { from: o.status, to: b.status });
  res.json({ order: serializeOrder(result) });
});

/* ------------------------------- Customers ----------------------------- */
adminRouter.get('/customers', async (req, res) => {
  const q = parse(pageQuery, req.query);
  const where: Prisma.UserWhereInput = { role: 'CUSTOMER' };
  if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }];
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
      select: { id: true, name: true, email: true, isBlocked: true, createdAt: true, _count: { select: { orders: true } }, orders: { where: { status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } }, select: { total: true } } },
    }),
  ]);
  res.json({
    total,
    pages: Math.max(1, Math.ceil(total / q.limit)),
    customers: users.map((u) => ({ id: u.id, name: u.name, email: u.email, isBlocked: u.isBlocked, createdAt: u.createdAt, orderCount: u._count.orders, totalSpent: u.orders.reduce((s, o) => s + o.total, 0) })),
  });
});

adminRouter.patch('/customers/:id/block', async (req, res) => {
  const b = parse(z.object({ blocked: z.boolean() }), req.body);
  const u = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!u) throw notFound('Customer not found');
  if (u.role === 'ADMIN') throw forbidden('Admins cannot be blocked');
  await prisma.user.update({ where: { id: u.id }, data: { isBlocked: b.blocked, tokenVersion: { increment: 1 } } });
  await audit(req.user!.id, b.blocked ? 'BLOCK' : 'UNBLOCK', 'User', u.id);
  res.json({ ok: true });
});

/* -------------------------------- Coupons ------------------------------ */
const couponSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Code must be 3-30 letters/numbers'),
    type: z.enum(['PERCENT', 'FLAT']),
    value: z.number().int().min(1).max(MAX_ORDER_VALUE),
    minOrder: z.number().int().min(0).default(0),
    maxDiscount: z.number().int().min(1).nullable().optional(),
    usageLimit: z.number().int().min(1).nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((c) => c.type !== 'PERCENT' || c.value <= 100, { message: 'Percent must be ≤ 100', path: ['value'] });

const couponData = (b: z.infer<typeof couponSchema>) => ({
  ...b, maxDiscount: b.maxDiscount ?? null, usageLimit: b.usageLimit ?? null, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
});

adminRouter.get('/coupons', async (_req, res) => {
  res.json({ coupons: await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } }) });
});
adminRouter.post('/coupons', async (req, res) => {
  const c = await prisma.coupon.create({ data: couponData(parse(couponSchema, req.body)) });
  await audit(req.user!.id, 'CREATE', 'Coupon', c.id, { code: c.code });
  res.status(201).json({ coupon: c });
});
adminRouter.put('/coupons/:id', async (req, res) => {
  const c = await prisma.coupon.update({ where: { id: String(req.params.id) }, data: couponData(parse(couponSchema, req.body)) });
  await audit(req.user!.id, 'UPDATE', 'Coupon', c.id);
  res.json({ coupon: c });
});
adminRouter.delete('/coupons/:id', async (req, res) => {
  await prisma.coupon.delete({ where: { id: String(req.params.id) } });
  await audit(req.user!.id, 'DELETE', 'Coupon', String(req.params.id));
  res.json({ ok: true });
});

/* -------------------------------- Reviews ------------------------------ */
adminRouter.get('/reviews', async (req, res) => {
  const q = parse(pageQuery, req.query);
  const [total, reviews] = await Promise.all([
    prisma.review.count(),
    prisma.review.findMany({ orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit, include: { user: { select: { name: true } }, product: { select: { name: true } } } }),
  ]);
  res.json({ total, pages: Math.max(1, Math.ceil(total / q.limit)), reviews });
});
adminRouter.delete('/reviews/:id', async (req, res) => {
  const r = await prisma.review.findUnique({ where: { id: String(req.params.id) } });
  if (!r) throw notFound('Review not found');
  await prisma.review.delete({ where: { id: r.id } });
  await recomputeRating(r.productId);
  await audit(req.user!.id, 'DELETE', 'Review', r.id);
  res.json({ ok: true });
});

/* ------------------------------- Audit log ----------------------------- */
adminRouter.get('/audit', async (req, res) => {
  const q = parse(pageQuery, req.query);
  res.json({ logs: await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }) });
});

/* -------------------------------- Uploads ------------------------------ */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

/** Identify the real image type from magic bytes; never trust the client-supplied name or mimetype. */
function sniff(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

adminRouter.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) throw new AppError(400, 'No file uploaded');
  const ext = sniff(req.file.buffer);
  if (!ext) throw new AppError(400, 'Only JPG, PNG or WEBP images are allowed');
  const url = await saveImage(req.file.buffer, ext);
  await audit(req.user!.id, 'UPLOAD', 'Image', undefined, { url });
  res.status(201).json({ url });
});

/** Deletes an uploaded image that was never saved to a product (form cancelled / image removed before saving). */
adminRouter.post('/upload/discard', async (req, res) => {
  const { url } = parse(z.object({ url: imageUrl }), req.body);
  // releaseImages refuses to touch an image that any product still uses.
  const removed = await releaseImages([url]);
  res.json({ ok: true, removed: removed > 0 });
});
