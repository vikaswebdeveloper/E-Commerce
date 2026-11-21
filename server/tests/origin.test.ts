import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '../src/lib/origin.js';
import { assertSafeTestDb } from './safety.js';

const allowed = ['http://localhost:5173'];

describe('origin allow-list (LAN access)', () => {
  it('accepts configured origins regardless of LAN mode', () => {
    expect(isAllowedOrigin('http://localhost:5173', allowed, false)).toBe(true);
  });

  it.each(['http://192.168.1.20:5173', 'http://10.0.0.7:5173', 'http://172.16.4.9:5173', 'http://172.31.255.1:3000', 'http://localhost:3000'])(
    'accepts private network origin %s only when LAN mode is on',
    (o) => {
      expect(isAllowedOrigin(o, allowed, true)).toBe(true);
      expect(isAllowedOrigin(o, allowed, false)).toBe(false);
    },
  );

  it.each([
    'https://evil.example',
    'http://192.168.1.20.evil.com',
    'http://evil.com/192.168.1.1',
    'http://172.32.0.1:5173', // just outside 172.16/12
    'http://11.0.0.1:5173',
    'http://8.8.8.8',
    'http://192.168.1.20@evil.com',
    'javascript:alert(1)',
    'null',
    '',
  ])('rejects %s even with LAN mode on', (o) => {
    expect(isAllowedOrigin(o, allowed, true)).toBe(false);
  });

  it('does not trust https private-IP origins it was not told about', () => {
    expect(isAllowedOrigin('https://192.168.1.20', allowed, true)).toBe(false);
  });
});

describe('test-database safety guard (the test run wipes its DB)', () => {
  const real = 'postgresql://u:p@ep-a-pooler.eu.aws.neon.tech/neondb?sslmode=require';
  it('requires TEST_DATABASE_URL', () => {
    expect(() => assertSafeTestDb(undefined, [real])).toThrow(/TEST_DATABASE_URL/);
  });
  it('refuses a database whose name does not contain "test"', () => {
    expect(() => assertSafeTestDb('postgresql://u:p@h/neondb', [])).toThrow(/must contain "test"/);
  });
  it('refuses the same database as the real one (pooled or direct host)', () => {
    expect(() => assertSafeTestDb('postgresql://u:p@ep-a.eu.aws.neon.tech/neondb_test', ['postgresql://u:p@ep-a.eu.aws.neon.tech/neondb_test'])).toThrow(/same database/);
    expect(() => assertSafeTestDb('postgresql://u:p@ep-a.eu.aws.neon.tech/neondb_test', ['postgresql://u:p@ep-a-pooler.eu.aws.neon.tech/neondb_test'])).toThrow(/same database/);
  });
  it('rejects non-postgres URLs and accepts a proper test DB', () => {
    expect(() => assertSafeTestDb('file:./test.db', [])).toThrow();
    expect(assertSafeTestDb('postgresql://u:p@ep-a.eu.aws.neon.tech/shop_test', [real])).toContain('shop_test');
  });
});
