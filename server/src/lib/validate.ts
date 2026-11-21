import { z } from 'zod';
import { AppError } from './errors.js';

/** Strip HTML tags, angle brackets and control characters so user text can never carry markup. */
export const clean = (s: string) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();

export const text = (max: number, min = 1) => z.string().transform(clean).pipe(z.string().min(min).max(max));

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[0-9]/, 'Password needs a number');

export const email = z.string().trim().toLowerCase().max(254).email('Invalid email');
export const id = z.string().min(1).max(40);

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message).join('; ');
    throw new AppError(400, msg, 'VALIDATION');
  }
  return r.data;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';

export const parseImages = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/** Image URLs must be http(s) or our own /uploads path. Blocks javascript:, data: etc. */
export const imageUrl = z
  .string()
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u) || /^\/uploads\/[A-Za-z0-9._-]+$/.test(u), 'Invalid image URL');
