import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

const boot = async (secret?: string) => {
  if (secret !== undefined) vi.stubEnv('CRON_SECRET', secret);
  const { createApp } = await import('../src/app.js');
  const request = (await import('supertest')).default;
  return request(createApp());
};

describe('/api/cron/maintenance', () => {
  it('is disabled (401 for everyone) when CRON_SECRET is not set', async () => {
    const api = await boot('');
    expect((await api.get('/api/cron/maintenance')).status).toBe(401);
    expect((await api.get('/api/cron/maintenance').set('Authorization', 'Bearer ')).status).toBe(401);
    expect((await api.get('/api/cron/maintenance').set('Authorization', 'Bearer undefined')).status).toBe(401);
  });

  it('rejects missing or wrong secrets', async () => {
    const api = await boot('s3cret-value-s3cret-value');
    expect((await api.get('/api/cron/maintenance')).status).toBe(401);
    expect((await api.get('/api/cron/maintenance').set('Authorization', 'Bearer nope')).status).toBe(401);
    expect((await api.get('/api/cron/maintenance').set('Authorization', 's3cret-value-s3cret-value')).status).toBe(401); // no "Bearer"
    expect((await api.get('/api/cron/maintenance?secret=s3cret-value-s3cret-value')).status).toBe(401); // never via the URL
  });

  it('runs housekeeping with the right secret, as Vercel Cron sends it', async () => {
    const api = await boot('s3cret-value-s3cret-value');
    const res = await api.get('/api/cron/maintenance').set('Authorization', 'Bearer s3cret-value-s3cret-value');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(typeof res.body.expiredOrders).toBe('number');
  });
});
