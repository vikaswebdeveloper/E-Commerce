import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { sweepOrphanImages } from '../services/imageCleanup.js';
import { expireStaleOrders } from '../services/orders.js';

export const cronRouter = Router();

const digest = (s: string) => crypto.createHash('sha256').update(s).digest();

/**
 * Housekeeping for hosts without background timers (Vercel): frees stock held by unpaid orders and deletes
 * orphaned images. Vercel Cron calls it with "Authorization: Bearer $CRON_SECRET". Disabled (always 401) unless
 * CRON_SECRET is set, and compared in constant time.
 */
cronRouter.get('/maintenance', async (req, res) => {
  const given = digest(String(req.headers.authorization ?? ''));
  const expected = digest(`Bearer ${config.cronSecret}`);
  if (!config.cronSecret || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const expired = await expireStaleOrders(config.pendingOrderTtlMinutes);
  const images = await sweepOrphanImages();
  res.json({ ok: true, expiredOrders: expired, images });
});
