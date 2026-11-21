import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { isAllowedOrigin } from '../lib/origin.js';

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
export const globalLimiter = () => rateLimit({ ...opts, windowMs: 15 * 60 * 1000, limit: config.rateLimit.global });
export const couponLimiter = () => rateLimit({ ...opts, windowMs: 15 * 60 * 1000, limit: config.rateLimit.coupon });
export const authLimiter = () => rateLimit({ ...opts, windowMs: 15 * 60 * 1000, limit: config.rateLimit.auth });
