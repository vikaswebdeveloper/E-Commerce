import type { Coupon } from '@prisma/client';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';

/** Validates a coupon against a subtotal and returns the discount in paise. Throws AppError if unusable. */
export function computeDiscount(coupon: Coupon | null, subtotal: number): number {
  if (!coupon || !coupon.isActive) throw new AppError(400, 'Invalid coupon code');
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) throw new AppError(400, 'Coupon has expired');
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) throw new AppError(400, 'Coupon usage limit reached');
  if (subtotal < coupon.minOrder) throw new AppError(400, `Minimum order of ₹${(coupon.minOrder / 100).toFixed(0)} required`);
  let d = coupon.type === 'PERCENT' ? Math.floor((subtotal * coupon.value) / 100) : coupon.value;
  if (coupon.maxDiscount !== null) d = Math.min(d, coupon.maxDiscount);
  return Math.max(0, Math.min(d, subtotal));
}

export function computeShipping(subtotalAfterDiscount: number) {
  return subtotalAfterDiscount >= config.freeShippingThreshold || subtotalAfterDiscount === 0 ? 0 : config.shippingFee;
}
