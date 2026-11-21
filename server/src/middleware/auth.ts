import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export const COOKIE = 'token';

export function signToken(userId: string, tokenVersion: number) {
  return jwt.sign({ sub: userId, tv: tokenVersion }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '7d' });
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/',
  });
}

async function resolveUser(req: Request) {
  const token = req.cookies?.[COOKIE];
  if (!token || typeof token !== 'string') return null;
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (typeof p.sub !== 'string') return null;
    const user = await prisma.user.findUnique({ where: { id: p.sub } });
    if (!user || user.isBlocked || user.tokenVersion !== p.tv) return null;
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  } catch {
    return null;
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const u = await resolveUser(req);
  if (!u) throw unauthorized();
  req.user = u;
  next();
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const u = await resolveUser(req);
  if (u) req.user = u;
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  if (req.user.role !== 'ADMIN') throw forbidden('Admin access required');
  next();
}
