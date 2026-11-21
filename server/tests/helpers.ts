import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { mockSign } from '../src/services/razorpay.js';

export const app = createApp();
export const PASSWORD = 'Passw0rd!x';
const uid = () => crypto.randomBytes(5).toString('hex');

export async function makeUser(role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER', extra: Record<string, unknown> = {}) {
  const email = `${role.toLowerCase()}-${uid()}@test.dev`;
  const user = await prisma.user.create({
    data: { name: 'Test User', email, passwordHash: await bcrypt.hash(PASSWORD, 4), role, ...extra },
  });
  return { user, email, password: PASSWORD };
}

export async function loginAs(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export async function customer() {
  const u = await makeUser('CUSTOMER');
  return { ...u, agent: await loginAs(u.email) };
}
export async function admin() {
  const u = await makeUser('ADMIN');
  return { ...u, agent: await loginAs(u.email) };
}

let catId: string | null = null;
export async function category() {
  if (!catId) {
    const c = await prisma.category.create({ data: { name: `Cat ${uid()}`, slug: `cat-${uid()}` } });
    catId = c.id;
  }
  return catId;
}

export async function makeProduct(over: Record<string, unknown> = {}) {
  const n = `Product ${uid()}`;
  return prisma.product.create({
    data: {
      name: n, slug: n.toLowerCase().replace(/ /g, '-'), description: 'A test product', price: 50000, mrp: 60000,
      stock: 10, images: '[]', brand: 'TestBrand', categoryId: await category(), ...over,
    } as any,
  });
}

export async function makeAddress(userId: string) {
  return prisma.address.create({
    data: { userId, fullName: 'Test User', phone: '9876543210', line1: '12 Test Street', city: 'Pune', state: 'MH', pincode: '411001', isDefault: true },
  });
}

/** Puts product(s) in the cart and returns an address id, ready for checkout. */
export async function readyToCheckout(c: { user: { id: string }; agent: request.Agent }, items: { id: string; qty: number }[]) {
  const addr = await makeAddress(c.user.id);
  for (const i of items) await c.agent.post('/api/cart').send({ productId: i.id, quantity: i.qty }).expect(201);
  return addr.id;
}

export function signPayment(razorpayOrderId: string, paymentId = `pay_${uid()}`) {
  return { razorpay_order_id: razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: mockSign(razorpayOrderId, paymentId) };
}

export { request, prisma };
