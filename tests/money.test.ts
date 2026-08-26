import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  MoneyPrecisionError,
  add,
  compare,
  format,
  fromMajorString,
  money,
  multiply,
  percentOf,
  ratioPercent,
  roundHalfAwayFromZero,
  roundUpToPricePoint,
  subtract,
  sum,
  toMajorString,
  zero,
} from '../src/core/money.ts';

describe('money construction', () => {
  it('rejects non-integer minor units', () => {
    expect(() => money(10.5, 'GBP')).toThrow(MoneyPrecisionError);
  });

  it('parses major-unit strings exactly', () => {
    expect(fromMajorString('24.99', 'GBP')).toEqual({ minor: 2499, currency: 'GBP' });
    expect(fromMajorString('24.9', 'GBP')).toEqual({ minor: 2490, currency: 'GBP' });
    expect(fromMajorString('24', 'GBP')).toEqual({ minor: 2400, currency: 'GBP' });
    expect(fromMajorString('0.05', 'GBP')).toEqual({ minor: 5, currency: 'GBP' });
    expect(fromMajorString('-3.50', 'GBP')).toEqual({ minor: -350, currency: 'GBP' });
  });

  it('rejects unparseable amounts rather than coercing them', () => {
    expect(() => fromMajorString('24.999', 'GBP')).toThrow();
    expect(() => fromMajorString('twenty', 'GBP')).toThrow();
    expect(() => fromMajorString('', 'GBP')).toThrow();
  });

  it('round-trips through the major-unit representation', () => {
    for (const minor of [0, 5, 99, 100, 2499, 100000]) {
      expect(fromMajorString(toMajorString(money(minor, 'GBP')), 'GBP').minor).toBe(minor);
    }
  });

  it('formats negatives with the sign outside the symbol', () => {
    expect(format(money(-450, 'GBP'))).toBe('-£4.50');
    expect(format(money(2499, 'GBP'))).toBe('£24.99');
  });
});

describe('money arithmetic', () => {
  it('refuses to mix currencies', () => {
    expect(() => add(money(100, 'GBP'), money(100, 'EUR'))).toThrow(CurrencyMismatchError);
    expect(() => subtract(money(100, 'GBP'), money(100, 'USD'))).toThrow(CurrencyMismatchError);
    expect(() => compare(money(100, 'GBP'), money(100, 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('sums an empty list to zero in the stated currency', () => {
    expect(sum([], 'GBP')).toEqual(zero('GBP'));
  });

  it('rounds half away from zero so cost lines never flatter the margin', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(1.5)).toBe(2);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(percentOf(money(4500, 'GBP'), 1.5)).toEqual(money(68, 'GBP'));
    expect(multiply(money(-101, 'GBP'), 0.5)).toEqual(money(-51, 'GBP'));
  });

  it('reports an undefined ratio as null, not zero', () => {
    expect(ratioPercent(money(100, 'GBP'), zero('GBP'))).toBeNull();
    expect(ratioPercent(money(50, 'GBP'), money(200, 'GBP'))).toBe(25);
  });
});

describe('price point rounding', () => {
  it('rounds up to the nearest whole pound by default', () => {
    expect(roundUpToPricePoint(money(4603, 'GBP'), 100, 0)).toEqual(money(4700, 'GBP'));
    expect(roundUpToPricePoint(money(4600, 'GBP'), 100, 0)).toEqual(money(4600, 'GBP'));
  });

  it('honours a configured ending such as .95', () => {
    expect(roundUpToPricePoint(money(2400, 'GBP'), 100, 95)).toEqual(money(2495, 'GBP'));
    expect(roundUpToPricePoint(money(2496, 'GBP'), 100, 95)).toEqual(money(2595, 'GBP'));
  });

  it('never rounds down below the solved price', () => {
    for (const minor of [1, 99, 100, 101, 2495, 2496, 9999]) {
      const rounded = roundUpToPricePoint(money(minor, 'GBP'), 100, 95);
      expect(rounded.minor).toBeGreaterThanOrEqual(minor);
    }
  });

  it('rejects an incoherent rounding configuration', () => {
    expect(() => roundUpToPricePoint(money(100, 'GBP'), 100, 100)).toThrow();
    expect(() => roundUpToPricePoint(money(100, 'GBP'), 0, 0)).toThrow();
  });
});
