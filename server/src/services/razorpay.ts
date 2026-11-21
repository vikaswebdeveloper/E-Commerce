import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { config, mockPayments } from '../config.js';

const MOCK_SECRET = 'mock_secret_dev_only';

const client = !mockPayments ? new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret }) : null;
const secret = () => (mockPayments ? MOCK_SECRET : config.razorpay.keySecret);

const hmac = (key: string, data: string | Buffer) => crypto.createHmac('sha256', key).update(data).digest('hex');

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const publicKeyId = () => (mockPayments ? 'rzp_mock_key' : config.razorpay.keyId);

export async function createGatewayOrder(amountPaise: number, receipt: string): Promise<{ id: string }> {
  if (mockPayments) return { id: `order_mock_${crypto.randomBytes(8).toString('hex')}` };
  const o = await client!.orders.create({ amount: amountPaise, currency: 'INR', receipt: receipt.slice(0, 40) });
  return { id: o.id };
}

/** Checkout signature = HMAC_SHA256(order_id|payment_id, key_secret) */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return safeEqual(hmac(secret(), `${orderId}|${paymentId}`), signature.toLowerCase());
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string) {
  const key = mockPayments ? MOCK_SECRET : config.razorpay.webhookSecret;
  if (!key || typeof signature !== 'string') return false;
  return safeEqual(hmac(key, rawBody), signature);
}

/** Dev-only helper used by the mock checkout. Never reachable in production (see payments route). */
export function mockSign(orderId: string, paymentId: string) {
  return hmac(MOCK_SECRET, `${orderId}|${paymentId}`);
}
export function mockSignWebhook(raw: string) {
  return hmac(MOCK_SECRET, raw);
}

export async function refundPayment(paymentId: string, amountPaise: number) {
  if (mockPayments) return { id: `rfnd_mock_${crypto.randomBytes(6).toString('hex')}` };
  const r = await client!.payments.refund(paymentId, { amount: amountPaise });
  return { id: r.id };
}
