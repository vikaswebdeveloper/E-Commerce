import { describe, expect, it } from 'vitest';
import { discountPct, statusLabel, toPaise } from './format';

describe('format helpers', () => {
  it('converts rupees to integer paise without float drift', () => {
    expect(toPaise('19.99')).toBe(1999);
    expect(toPaise(0.1 + 0.2)).toBe(30);
  });
  it('computes discount percentage', () => {
    expect(discountPct(750, 1000)).toBe(25);
    expect(discountPct(1000, 1000)).toBe(0);
    expect(discountPct(1200, 1000)).toBe(0);
  });
  it('humanises statuses', () => {
    expect(statusLabel('PENDING_PAYMENT')).toBe('Pending payment');
  });
});
