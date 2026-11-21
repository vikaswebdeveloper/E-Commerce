import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { app, customer, loginAs, makeUser, PASSWORD, prisma, request } from './helpers.js';

const email = () => `u${Math.random().toString(36).slice(2)}@test.dev`;

describe('signup', () => {
  it('creates a customer, sets an httpOnly cookie and never leaks the hash', async () => {
    const res = await request(app).post('/api/auth/signup').send({ name: 'Asha Rao', email: email(), password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CUSTOMER');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('ignores a client-supplied role (no privilege escalation via mass assignment)', async () => {
    const res = await request(app).post('/api/auth/signup').send({ name: 'Evil', email: email(), password: PASSWORD, role: 'ADMIN', isBlocked: false });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CUSTOMER');
    const stored = await prisma.user.findUnique({ where: { email: res.body.user.email } });
    expect(stored?.role).toBe('CUSTOMER');
  });

  it('stores a bcrypt hash, not the password', async () => {
    const e = email();
    await request(app).post('/api/auth/signup').send({ name: 'Hash Test', email: e, password: PASSWORD });
    const u = await prisma.user.findUnique({ where: { email: e } });
    expect(u!.passwordHash).not.toContain(PASSWORD);
    expect(u!.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it.each([
    ['short', 'Ab1'],
    ['no uppercase', 'password1'],
    ['no digit', 'Passwordd'],
    ['too long (bcrypt truncation)', 'Aa1' + 'x'.repeat(80)],
  ])('rejects weak password: %s', async (_n, pw) => {
    const res = await request(app).post('/api/auth/signup').send({ name: 'Weak', email: email(), password: pw });
    expect(res.status).toBe(400);
  });

  it('rejects invalid email and duplicate email (case-insensitive)', async () => {
    expect((await request(app).post('/api/auth/signup').send({ name: 'X Y', email: 'nope', password: PASSWORD })).status).toBe(400);
    const e = email();
    await request(app).post('/api/auth/signup').send({ name: 'First', email: e, password: PASSWORD }).expect(201);
    expect((await request(app).post('/api/auth/signup').send({ name: 'Second', email: e.toUpperCase(), password: PASSWORD })).status).toBe(409);
  });

  it('strips HTML from the name', async () => {
    const res = await request(app).post('/api/auth/signup').send({ name: '<script>alert(1)</script>Bob', email: email(), password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.name).not.toMatch(/[<>]/);
  });
});

describe('login', () => {
  it('logs in and /me returns the user', async () => {
    const c = await customer();
    const me = await c.agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(c.email);
  });

  it('gives an identical generic error for unknown email and wrong password (no user enumeration)', async () => {
    const u = await makeUser();
    const a = await request(app).post('/api/auth/login').send({ email: u.email, password: 'WrongPass1' });
    const b = await request(app).post('/api/auth/login').send({ email: email(), password: 'WrongPass1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: u.email, password: 'WrongPass1' });
    const res = await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(429);
  });

  it('blocks suspended users from logging in and invalidates their live session', async () => {
    const c = await customer();
    await prisma.user.update({ where: { id: c.user.id }, data: { isBlocked: true } });
    expect((await c.agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: c.email, password: PASSWORD })).status).toBe(403);
  });

  it('survives SQL-injection style input', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: "' OR 1=1 --", password: "' OR '1'='1" });
    expect(res.status).toBe(400);
    const res2 = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    expect(res2.status).toBe(400);
  });

  it('logout clears the cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect((res.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/token=;/);
  });
});

describe('token security', () => {
  it('rejects a forged token signed with the wrong secret', async () => {
    const u = await makeUser();
    const forged = jwt.sign({ sub: u.user.id, tv: 0 }, 'attacker-secret-attacker-secret-1234');
    const res = await request(app).get('/api/auth/me').set('Cookie', `token=${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const u = await makeUser('ADMIN');
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.user.id, tv: 0 })}.`;
    const res = await request(app).get('/api/admin/stats').set('Cookie', `token=${none}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const u = await makeUser();
    const t = jwt.sign({ sub: u.user.id, tv: 0 }, 'test-secret-test-secret-test-secret-123456', { expiresIn: -10 });
    expect((await request(app).get('/api/auth/me').set('Cookie', `token=${t}`)).status).toBe(401);
  });

  it('changing the password invalidates other sessions', async () => {
    const u = await makeUser();
    const a = await loginAs(u.email);
    const b = await loginAs(u.email);
    await a.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'NewPassw0rd' }).expect(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect((await a.get('/api/auth/me')).status).toBe(200);
  });

  it('change-password requires the correct current password', async () => {
    const c = await customer();
    const res = await c.agent.post('/api/auth/change-password').send({ currentPassword: 'Wrong1234', newPassword: 'NewPassw0rd' });
    expect(res.status).toBe(400);
  });
});

describe('password reset', () => {
  it('does not reveal whether an email exists', async () => {
    const u = await makeUser();
    const a = await request(app).post('/api/auth/forgot-password').send({ email: u.email });
    const b = await request(app).post('/api/auth/forgot-password').send({ email: email() });
    expect(a.status).toBe(200);
    expect(a.body).toEqual(b.body);
  });

  it('rejects bad / expired tokens and works once with a valid token', async () => {
    const u = await makeUser();
    expect((await request(app).post('/api/auth/reset-password').send({ token: 'x'.repeat(40), password: 'NewPassw0rd' })).status).toBe(400);
    const crypto = await import('node:crypto');
    const token = 'a'.repeat(64);
    await prisma.user.update({
      where: { id: u.user.id },
      data: { resetTokenHash: crypto.createHash('sha256').update(token).digest('hex'), resetExpires: new Date(Date.now() + 60000) },
    });
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'NewPassw0rd' })).status).toBe(200);
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'Another1Pass' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: 'NewPassw0rd' })).status).toBe(200);

    await prisma.user.update({
      where: { id: u.user.id },
      data: { resetTokenHash: crypto.createHash('sha256').update('b'.repeat(64)).digest('hex'), resetExpires: new Date(Date.now() - 1000) },
    });
    expect((await request(app).post('/api/auth/reset-password').send({ token: 'b'.repeat(64), password: 'NewPassw0rd' })).status).toBe(400);
  });
});
