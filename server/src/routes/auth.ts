import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { authenticate, COOKIE, setAuthCookie, signToken } from '../middleware/auth.js';
import { authLimiter } from '../middleware/security.js';
import { AppError, conflict, unauthorized } from '../lib/errors.js';
import { email, parse, password, text } from '../lib/validate.js';
import { sendMail } from '../lib/mailer.js';

export const authRouter = Router();
// Brute-force limiter for credential endpoints only. It must NOT cover /me or /logout: the SPA calls
// /me on every page load, and counting those would lock real users out after ~30 page views.
const credentialLimiter = authLimiter();

const publicUser = (u: { id: string; name: string; email: string; role: string; createdAt: Date }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  createdAt: u.createdAt,
});

// A real hash to compare against when the email does not exist (equalises timing).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', config.bcryptRounds);
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

authRouter.post('/signup', credentialLimiter, async (req, res) => {
  // Strict schema: `role` etc. are ignored, so privilege escalation via mass assignment is impossible.
  const body = parse(z.object({ name: text(80, 2), email, password }), req.body);
  if (await prisma.user.findUnique({ where: { email: body.email } })) throw conflict('An account with this email already exists');
  const user = await prisma.user.create({
    data: { name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, config.bcryptRounds), role: 'CUSTOMER' },
  });
  setAuthCookie(res, signToken(user.id, user.tokenVersion));
  void sendMail(user.email, 'Welcome to Shop', `Hi ${user.name}, your account is ready.`);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', credentialLimiter, async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const generic = new AppError(401, 'Invalid email or password');

  if (!user) {
    await bcrypt.compare(body.password, DUMMY_HASH);
    throw generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new AppError(429, 'Account temporarily locked. Try again later.');

  const ok = await bcrypt.compare(body.password, user.passwordHash);
  if (!ok) {
    const fails = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: fails >= MAX_FAILS
        ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
        : { failedLogins: fails },
    });
    throw generic;
  }
  if (user.isBlocked) throw new AppError(403, 'This account has been suspended');

  if (user.failedLogins || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  }
  setAuthCookie(res, signToken(user.id, user.tokenVersion));
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  res.json({ user: publicUser(u) });
});

authRouter.patch('/me', authenticate, async (req, res) => {
  const body = parse(z.object({ name: text(80, 2) }), req.body);
  const u = await prisma.user.update({ where: { id: req.user!.id }, data: { name: body.name } });
  res.json({ user: publicUser(u) });
});

authRouter.post('/change-password', credentialLimiter, authenticate, async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }), req.body);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(body.currentPassword, u.passwordHash))) throw new AppError(400, 'Current password is incorrect');
  const updated = await prisma.user.update({
    where: { id: u.id },
    data: { passwordHash: await bcrypt.hash(body.newPassword, config.bcryptRounds), tokenVersion: { increment: 1 } },
  });
  // Invalidate all other sessions, keep this one signed in.
  setAuthCookie(res, signToken(updated.id, updated.tokenVersion));
  res.json({ ok: true });
});

const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

authRouter.post('/forgot-password', credentialLimiter, async (req, res) => {
  const body = parse(z.object({ email }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (user && !user.isBlocked) {
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: { resetTokenHash: hashToken(token), resetExpires: new Date(Date.now() + 60 * 60_000) },
    });
    void sendMail(user.email, 'Reset your password', `${config.clientOrigins[0]}/reset-password?token=${token}`);
  }
  // Same response whether or not the account exists (no user enumeration).
  res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
});

authRouter.post('/reset-password', credentialLimiter, async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
  const user = await prisma.user.findFirst({
    where: { resetTokenHash: hashToken(body.token), resetExpires: { gt: new Date() } },
  });
  if (!user) throw new AppError(400, 'Reset link is invalid or has expired');
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(body.password, config.bcryptRounds),
      resetTokenHash: null,
      resetExpires: null,
      failedLogins: 0,
      lockedUntil: null,
      tokenVersion: { increment: 1 },
    },
  });
  res.json({ ok: true });
});

export { unauthorized };
