import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';

const env = process.env.NODE_ENV ?? 'development';
const isProd = env === 'production';
const isTest = env === 'test';

function required(name: string, devDefault: string, minLen = 0): string {
  const v = process.env[name];
  if (!v) {
    if (isProd) throw new Error(`Missing required env var ${name}`);
    return devDefault;
  }
  if (isProd && v.length < minLen) throw new Error(`${name} must be at least ${minLen} chars`);
  return v;
}

const num = (name: string, def: number) => {
  const raw = process.env[name];
  const n = Number(raw);
  return raw && Number.isFinite(n) ? n : def;
};

/** Remote Postgres (Neon) adds latency and cold starts: give interactive transactions more room than Prisma's 5s default. */
export const TX_OPTS = { maxWait: 15_000, timeout: 30_000 };
/** Max order subtotal in paise (₹5,00,000). */
export const MAX_ORDER_VALUE = 50_000_000;

export const config = {
  env,
  isProd,
  isTest,
  port: num('PORT', 4000),
  // Local-disk fallback folder for uploads (development only; production uses B2).
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), 'uploads'),
  // 0.0.0.0 = reachable from other devices on the network (not just localhost).
  host: process.env.HOST ?? '0.0.0.0',
  // Accept browser origins from private LAN addresses (e.g. http://192.168.1.20:5173). Never enabled by default in production.
  allowLanOrigins: process.env.ALLOW_LAN_ORIGINS ? process.env.ALLOW_LAN_ORIGINS === '1' : env === 'development',
  // Never fall back to a constant: a known secret would let anyone forge an admin session.
  // Without JWT_SECRET in development a random per-process secret is used (sessions reset on restart).
  jwtSecret: required('JWT_SECRET', crypto.randomBytes(48).toString('hex'), 32),
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  bcryptRounds: num('BCRYPT_ROUNDS', isTest ? 4 : 12),
  trustProxy: process.env.TRUST_PROXY === '1',
  rateLimit: {
    // ~100 requests/minute per IP. A single page view makes ~10 API calls, and a home/office network shares one IP.
    global: num('GLOBAL_RATE_LIMIT', isTest ? 100000 : 1500),
    auth: num('AUTH_RATE_LIMIT', isTest ? 100000 : 30),
    // Stops guessing of coupon codes (the validate endpoint reveals whether a code exists).
    coupon: num('COUPON_RATE_LIMIT', isTest ? 100000 : 60),
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
  freeShippingThreshold: 99900, // paise
  shippingFee: 4900, // paise
  pendingOrderTtlMinutes: 30,
};

const b2Region = process.env.B2_REGION ?? '';
const b2Bucket = process.env.B2_BUCKET ?? '';
export const b2 = {
  keyId: process.env.B2_KEY_ID ?? '',
  appKey: process.env.B2_APPLICATION_KEY ?? '',
  bucket: b2Bucket,
  region: b2Region,
  endpoint: process.env.B2_ENDPOINT || (b2Region ? `https://s3.${b2Region}.backblazeb2.com` : ''),
  // Where browsers load images from. Use your CDN / custom domain here if you have one.
  publicBaseUrl: (process.env.B2_PUBLIC_URL || (b2Bucket && b2Region ? `https://${b2Bucket}.s3.${b2Region}.backblazeb2.com` : '')).replace(/\/+$/, ''),
};
/** When false, uploads fall back to local disk (development/tests only). */
export const b2Enabled = !!(b2.keyId && b2.appKey && b2.bucket && b2.endpoint && b2.publicBaseUrl);
if (isProd && !b2Enabled) {
  throw new Error('Backblaze B2 is required in production (set B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, B2_REGION)');
}

// Mock payments are allowed only outside production and only when no keys are set.
export const mockPayments = !config.razorpay.keyId && !isProd;
if (isProd && (!config.razorpay.keyId || !config.razorpay.keySecret)) {
  throw new Error('Razorpay keys are required in production');
}
