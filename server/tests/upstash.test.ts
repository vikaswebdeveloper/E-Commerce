import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io/');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok_123');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const reply = (...results: unknown[]) => ({ ok: true, json: async () => results.map((result) => ({ result })) });
const load = async () => {
  const { UpstashStore } = await import('../src/lib/upstashStore.js');
  const store = new UpstashStore('auth');
  store.init({ windowMs: 60_000 } as any);
  return store;
};
const sentCommands = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body);

describe('Upstash rate-limit store', () => {
  it('counts hits in a shared Redis key and starts the window on the first hit', async () => {
    const store = await load();
    fetchMock.mockResolvedValueOnce(reply(1, -1)).mockResolvedValueOnce(reply(1));
    const r = await store.increment('1.2.3.4');

    expect(r.totalHits).toBe(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.upstash.io/pipeline'); // trailing slash normalised
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok_123');
    expect(sentCommands(0)).toEqual([['INCR', 'rl:auth:1.2.3.4'], ['PTTL', 'rl:auth:1.2.3.4']]);
    expect(sentCommands(1)).toEqual([['PEXPIRE', 'rl:auth:1.2.3.4', 60000]]);
    expect(r.resetTime!.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('does not reset the window on later hits and reports the remaining time', async () => {
    const store = await load();
    fetchMock.mockResolvedValueOnce(reply(7, 42_000));
    const r = await store.increment('1.2.3.4');
    expect(r.totalHits).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no PEXPIRE
    expect(r.resetTime!.getTime()).toBeLessThanOrEqual(Date.now() + 42_000);
  });

  it('fails OPEN: if Redis is down the site keeps working instead of locking everyone out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = await load();
    fetchMock.mockRejectedValue(new Error('timeout'));
    expect((await store.increment('ip')).totalHits).toBe(1);
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    expect((await store.increment('ip')).totalHits).toBe(1);
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ error: 'WRONGTYPE' }, { result: 1 }] });
    expect((await store.increment('ip')).totalHits).toBe(1);
  });

  it('supports decrement and reset', async () => {
    const store = await load();
    fetchMock.mockResolvedValue(reply(1));
    await store.decrement('ip');
    await store.resetKey('ip');
    expect(sentCommands(0)).toEqual([['DECR', 'rl:auth:ip']]);
    expect(sentCommands(1)).toEqual([['DEL', 'rl:auth:ip']]);
  });

  it('is only used when Upstash is configured (limiters fall back to in-memory otherwise)', async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const { authLimiter } = await import('../src/middleware/security.js');
    expect(typeof authLimiter()).toBe('function'); // builds fine without any Upstash settings
  });
});
