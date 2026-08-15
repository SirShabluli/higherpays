import { describe, it, expect } from 'vitest';
import { formatMoney, formatDecimal, formatPct, sum } from './money';

describe('formatMoney', () => {
  it('formats with the euro symbol by default', () => {
    // Some locales use narrow spaces / different separators; assert on
    // *substance*, not the exact glyph.
    const s = formatMoney(1234.56);
    expect(s).toContain('1');
    expect(s).toContain('56');
    expect(/€|EUR/.test(s)).toBe(true);
  });

  it('supports other ISO currencies', () => {
    const s = formatMoney(10, 'USD');
    expect(/\$|USD/.test(s)).toBe(true);
  });

  it('falls back to a plain string when the currency code is nonsense', () => {
    const s = formatMoney(10, 'NOTACURRENCY');
    expect(s).toContain('NOTACURRENCY');
    expect(s).toContain('10');
  });

  it('renders NaN as 0', () => {
    const s = formatMoney(Number.NaN);
    expect(s).not.toContain('NaN');
  });
});

describe('formatDecimal', () => {
  it('always renders 2 decimals', () => {
    expect(formatDecimal(1)).toBe('1.00');
    expect(formatDecimal(1.239)).toBe('1.24');
  });
});

describe('formatPct', () => {
  it('multiplies fraction by 100', () => {
    expect(formatPct(0.125)).toBe('12.5%');
  });

  it('respects the requested precision', () => {
    expect(formatPct(0.12345, 2)).toBe('12.35%');
    expect(formatPct(0.12345, 0)).toBe('12%');
  });
});

describe('sum', () => {
  it('adds an array of numbers', () => {
    expect(sum([1, 2, 3, 4])).toBe(10);
  });

  it('is 0 on an empty array', () => {
    expect(sum([])).toBe(0);
  });
});
