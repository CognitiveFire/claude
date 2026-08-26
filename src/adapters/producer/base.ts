import type {
  DataProvenance,
  ProducerId,
  ProducerResponse,
} from '../../ports/producer.ts';

/** Wrap adapter output in the provenance envelope every caller relies on. */
export function envelope<T>(
  producerId: ProducerId,
  provenance: DataProvenance,
  raw: unknown,
  data: T,
): ProducerResponse<T> {
  return { data, provenance, retrievedAt: new Date(), producerId, raw };
}

/** Safe nested read from an unknown supplier payload. */
export function pick(source: unknown, ...pathSegments: readonly string[]): unknown {
  let current: unknown = source;
  for (const segment of pathSegments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

// ---------------------------------------------------------------------------

import { fromMajorString, type Currency, type Money } from '../../core/money.ts';

/**
 * Convert a supplier-quoted amount into Money, or null when absent.
 *
 * Returns null — never zero — for a missing or unparseable value. A supplier
 * that omits a cost is telling us it is UNKNOWN, and the economics engine must
 * see that rather than a zero that reads as free.
 */
export function moneyFromSupplier(value: unknown, currency: Currency): Money | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return fromMajorString(value.toFixed(2), currency);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return fromMajorString(parsed.toFixed(2), currency);
  }
  return null;
}

/** Map a supplier's free-text availability wording onto our enum. */
export function availabilityFromSupplier(value: unknown): import('../../ports/producer.ts').Availability {
  const text = asString(value)?.toLowerCase() ?? '';
  if (text === '') return 'UNKNOWN';
  if (/discontinued|removed/.test(text)) return 'DISCONTINUED';
  if (/out[_\s-]?of[_\s-]?stock|unavailable|sold[_\s-]?out/.test(text)) return 'OUT_OF_STOCK';
  if (/low|limited/.test(text)) return 'LOW_STOCK';
  if (/in[_\s-]?stock|available|active|ready/.test(text)) return 'IN_STOCK';
  return 'UNKNOWN';
}
