import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

describe('secrets configuration', () => {
  it('never falls back to a known JWT secret in development (random per process)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('JWT_SECRET', '');
    const a = (await import('../src/config.js')).config.jwtSecret;
    vi.resetModules();
    const b = (await import('../src/config.js')).config.jwtSecret;
    expect(a).toHaveLength(96);
    expect(a).not.toBe(b); // different every start, so it cannot be guessed from the repo
    expect(a).not.toMatch(/dev-only|insecure|change-me/i);
  });

  it('refuses to start in production without a strong JWT_SECRET', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', '');
    await expect(import('../src/config.js')).rejects.toThrow(/JWT_SECRET/);
    vi.resetModules();
    vi.stubEnv('JWT_SECRET', 'too-short');
    await expect(import('../src/config.js')).rejects.toThrow(/at least 32/);
  });
});
