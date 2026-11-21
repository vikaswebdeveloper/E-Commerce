import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import { config } from '../config.js';

/**
 * express-rate-limit store backed by Upstash Redis (REST API, so it works on serverless hosts with no
 * persistent connections). Counters are shared by every server instance.
 *
 * Fails OPEN: if Redis is unreachable, requests are allowed rather than the whole site being locked out
 * (the per-account lockout in the database still protects logins).
 */
export class UpstashStore implements Store {
  localKeys = false;
  prefix: string;
  private windowMs = 15 * 60_000;
  private lastErrorLog = 0;

  constructor(prefix: string) {
    this.prefix = `rl:${prefix}:`;
  }

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  private async pipeline(commands: (string | number)[][]): Promise<{ result?: unknown; error?: string }[]> {
    const res = await fetch(`${config.upstash.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.upstash.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`Upstash responded ${res.status}`);
    return (await res.json()) as { result?: unknown; error?: string }[];
  }

  private failOpen(e: unknown): ClientRateLimitInfo {
    if (Date.now() - this.lastErrorLog > 60_000) {
      this.lastErrorLog = Date.now();
      console.error('[rate-limit] Upstash unavailable, allowing request:', (e as Error).message);
    }
    return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const k = this.prefix + key;
    try {
      const [incr, pttl] = await this.pipeline([['INCR', k], ['PTTL', k]]);
      if (incr?.error || typeof incr?.result !== 'number') throw new Error(incr?.error ?? 'bad INCR result');
      let ttl = Number(pttl?.result);
      if (!Number.isFinite(ttl) || ttl < 0) {
        // First hit in this window (or the key somehow lost its expiry): start the window.
        await this.pipeline([['PEXPIRE', k, this.windowMs]]);
        ttl = this.windowMs;
      }
      return { totalHits: incr.result, resetTime: new Date(Date.now() + ttl) };
    } catch (e) {
      return this.failOpen(e);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.pipeline([['DECR', this.prefix + key]]);
    } catch (e) {
      this.failOpen(e);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.pipeline([['DEL', this.prefix + key]]);
    } catch (e) {
      this.failOpen(e);
    }
  }
}
