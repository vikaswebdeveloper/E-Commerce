import { describe, expect, it } from 'vitest';

describe('rate limiting', () => {
  it('throttles repeated auth attempts (brute-force protection)', async () => {
    process.env.AUTH_RATE_LIMIT = '4';
    process.env.COUPON_RATE_LIMIT = '3';
    const { createApp } = await import('../src/app.js');
    const request = (await import('supertest')).default;
    const app = createApp();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      codes.push((await request(app).post('/api/auth/login').send({ email: `nobody${i}@x.co`, password: 'Whatever1' })).status);
    }
    expect(codes.slice(0, 4).every((c) => c === 401)).toBe(true);
    expect(codes.slice(4).every((c) => c === 429)).toBe(true);
  });

  it('throttles coupon-code guessing', async () => {
    const { createApp } = await import('../src/app.js');
    const { prisma } = await import('../src/db.js');
    const { signToken } = await import('../src/middleware/auth.js');
    const request = (await import('supertest')).default;
    const user = await prisma.user.create({ data: { name: 'Coupon Guesser', email: `cg-${Date.now()}@test.dev`, passwordHash: 'x', role: 'CUSTOMER' } });
    const cookie = `token=${signToken(user.id, 0)}`;
    const app = createApp();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await request(app).post('/api/coupons/validate').set('Cookie', cookie).send({ code: `GUESS${i}` })).status);
    }
    expect(codes.slice(0, 3).every((c) => c === 400)).toBe(true); // unknown code -> 400, still allowed
    expect(codes.slice(3).every((c) => c === 429)).toBe(true); // then throttled
  });

  it('does NOT throttle /me or /logout, which the SPA calls on every page load', async () => {
    process.env.AUTH_RATE_LIMIT = '3';
    const { createApp } = await import('../src/app.js');
    const request = (await import('supertest')).default;
    const app = createApp();
    for (let i = 0; i < 15; i++) {
      expect((await request(app).get('/api/auth/me')).status).toBe(401); // 401 = "not logged in", never 429
    }
    expect((await request(app).post('/api/auth/logout')).status).toBe(200);
  });
});
