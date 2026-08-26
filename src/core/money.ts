/**
 * Money as integer minor units plus an explicit currency.
 *
 * Floating-point money in a margin engine is a defect waiting for a
 * production order. Every value in this system is an integer number of minor
 * units (pence for GBP) carrying its own currency, and mixed-currency
 * arithmetic throws rather than silently producing a plausible wrong number.
 */

export type Currency = 'GBP' | 'EUR' | 'USD';

export const CURRENCIES: readonly Currency[] = ['GBP', 'EUR', 'USD'];

export interface Money {
  /** Integer minor units. May be negative (a loss is a real result). */
  readonly minor: number;
  readonly currency: Currency;
}

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Refusing to combine ${a} with ${b}: convert explicitly first.`);
    this.name = 'CurrencyMismatchError';
  }
}

export class MoneyPrecisionError extends Error {
  constructor(value: number) {
    super(`Money requires integer minor units, received ${value}.`);
    this.name = 'MoneyPrecisionError';
  }
}

export function money(minor: number, currency: Currency): Money {
  if (!Number.isInteger(minor)) throw new MoneyPrecisionError(minor);
  return { minor, currency };
}

export function zero(currency: Currency): Money {
  return { minor: 0, currency };
}

/**
 * Parse a major-unit decimal string ("24.99") into Money. Used for config and
 * for supplier responses that quote decimal strings. Deliberately string-only:
 * accepting a float here would reintroduce the rounding we are avoiding.
 */
export function fromMajorString(value: string, currency: Currency): Money {
  const trimmed = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`Cannot parse "${value}" as a ${currency} amount.`);
  }
  const [, sign, whole, fraction = '0'] = match;
  const minorFraction = Number.parseInt(fraction.padEnd(2, '0'), 10);
  const minor = Number.parseInt(whole!, 10) * 100 + minorFraction;
  return { minor: sign === '-' ? -minor : minor, currency };
}

export function toMajorString(value: Money): string {
  const negative = value.minor < 0;
  const abs = Math.abs(value.minor);
  const major = Math.trunc(abs / 100);
  const minor = abs % 100;
  return `${negative ? '-' : ''}${major}.${String(minor).padStart(2, '0')}`;
}

const SYMBOLS: Record<Currency, string> = { GBP: '£', EUR: '€', USD: '$' };

export function format(value: Money): string {
  const negative = value.minor < 0;
  const body = `${SYMBOLS[value.currency]}${toMajorString(
    negative ? { ...value, minor: -value.minor } : value,
  )}`;
  return negative ? `-${body}` : body;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

export function sum(values: readonly Money[], currency: Currency): Money {
  return values.reduce((acc, v) => add(acc, v), zero(currency));
}

export function negate(a: Money): Money {
  return { minor: -a.minor, currency: a.currency };
}

/**
 * Multiply by a percentage. Rounds half away from zero on minor units, so a
 * cost line is never rounded down to flatter the margin.
 */
export function percentOf(value: Money, percent: number): Money {
  if (!Number.isFinite(percent)) throw new Error(`Percentage must be finite, got ${percent}.`);
  return { minor: roundHalfAwayFromZero((value.minor * percent) / 100), currency: value.currency };
}

export function multiply(value: Money, factor: number): Money {
  if (!Number.isFinite(factor)) throw new Error(`Factor must be finite, got ${factor}.`);
  return { minor: roundHalfAwayFromZero(value.minor * factor), currency: value.currency };
}

export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function isNegative(value: Money): boolean {
  return value.minor < 0;
}

export function isZero(value: Money): boolean {
  return value.minor === 0;
}

export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.minor === b.minor ? 0 : a.minor < b.minor ? -1 : 1;
}

/**
 * Ratio of two amounts as a percentage, or null when the denominator is zero.
 * Null means "undefined", which is a different statement from zero — the
 * caller must decide how to present it rather than being handed a 0 that
 * reads as a real margin.
 */
export function ratioPercent(numerator: Money, denominator: Money): number | null {
  assertSameCurrency(numerator, denominator);
  if (denominator.minor === 0) return null;
  return (numerator.minor / denominator.minor) * 100;
}

/** Round UP to the nearest step, then to the configured ending within a step. */
export function roundUpToPricePoint(
  value: Money,
  stepMinor: number,
  endingMinor: number,
): Money {
  if (stepMinor <= 0) throw new Error('Price rounding step must be positive.');
  if (endingMinor < 0 || endingMinor >= stepMinor) {
    throw new Error(`Price ending ${endingMinor} must be within [0, ${stepMinor}).`);
  }
  const steps = Math.ceil(value.minor / stepMinor);
  let candidate = steps * stepMinor + endingMinor;
  if (candidate < value.minor) candidate += stepMinor;
  return { minor: candidate, currency: value.currency };
}
