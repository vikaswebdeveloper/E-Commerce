import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { productView } from '../services/orders.js';

export const catalogRouter = Router();

catalogRouter.get('/categories', async (_req, res) => {
  const cats = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: { where: { isActive: true } } } } },
  });
  res.json({ categories: cats.map((c) => ({ id: c.id, name: c.name, slug: c.slug, productCount: c._count.products })) });
});

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().max(80).optional(),
  brand: z.string().max(80).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  inStock: z.enum(['true', 'false']).optional(),
  featured: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'rating', 'popular']).default('newest'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});

const ORDER: Record<string, Prisma.ProductOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }],
  price_asc: [{ price: 'asc' }],
  price_desc: [{ price: 'desc' }],
  rating: [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }],
  popular: [{ soldCount: 'desc' }, { ratingCount: 'desc' }],
};

catalogRouter.get('/products', async (req, res) => {
  const q = parse(listQuery, req.query);
  const where: Prisma.ProductWhereInput = { isActive: true };
  if (q.q) {
    where.OR = [
      { name: { contains: q.q, mode: 'insensitive' } },
      { description: { contains: q.q, mode: 'insensitive' } },
      { brand: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  if (q.category) where.category = { slug: q.category };
  if (q.brand) where.brand = q.brand;
  if (q.minPrice !== undefined || q.maxPrice !== undefined) where.price = { gte: q.minPrice, lte: q.maxPrice };
  if (q.rating) where.ratingAvg = { gte: q.rating };
  if (q.inStock === 'true') where.stock = { gt: 0 };
  if (q.featured === 'true') where.isFeatured = true;

  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: ORDER[q.sort],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: { category: { select: { name: true, slug: true } } },
    }),
  ]);
  res.json({ items: items.map(productView), total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)) });
});

catalogRouter.get('/products/meta', async (_req, res) => {
  const [brands, agg] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true, brand: { not: null } }, select: { brand: true }, distinct: ['brand'], orderBy: { brand: 'asc' } }),
    prisma.product.aggregate({ where: { isActive: true }, _min: { price: true }, _max: { price: true } }),
  ]);
  res.json({ brands: brands.map((b) => b.brand), minPrice: agg._min.price ?? 0, maxPrice: agg._max.price ?? 0 });
});

catalogRouter.get('/products/suggest', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(60) }), req.query);
  const items = await prisma.product.findMany({
    where: { isActive: true, name: { contains: q, mode: 'insensitive' } },
    select: { id: true, name: true, slug: true, price: true, images: true },
    take: 6,
  });
  res.json({ items: items.map(productView) });
});

catalogRouter.get('/products/:slug', async (req, res) => {
  const slug = String(req.params.slug);
  const p = await prisma.product.findFirst({
    where: { isActive: true, OR: [{ slug }, { id: slug }] },
    include: { category: { select: { name: true, slug: true } } },
  });
  if (!p) throw notFound('Product not found');
  const related = await prisma.product.findMany({
    where: { isActive: true, categoryId: p.categoryId, id: { not: p.id } },
    take: 4,
    orderBy: { ratingAvg: 'desc' },
  });
  res.json({ product: productView(p), related: related.map(productView) });
});
