import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { isAllowedOrigin } from '../lib/origin.js';
import { UpstashStore } from '../lib/upstashStore.js';

/** CSRF defence in depth: cookies are SameSite=Lax; additionally reject cross-origin state-changing requests. */
export function originGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin, config.clientOrigins, config.allowLanOrigins)) {
    return res.status(403).json({ error: 'Cross-origin request blocked' });
  }
  next();
}

const opts = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
};

/** Shared (Redis) counters when Upstash is configured; otherwise in-memory (fine for a single long-running server). */
const sharedStore = (name: string) => (config.upstash.url && config.upstash.token ? new UpstashStore(name) : undefined);

const limiter = (name: string, limit: number, windowMs = 15 * 60 * 1000) =>
  rateLimit({ ...opts, windowMs, limit, store: sharedStore(name) });

export const globalLimiter = () => limiter('global', config.rateLimit.global);
export const couponLimiter = () => limiter('coupon', config.rateLimit.coupon);
export const authLimiter = () => limiter('auth', config.rateLimit.auth);
/** Public contact form: it sends email, so keep it tight. */
export const contactLimiter = () => limiter('contact', config.rateLimit.contact);
