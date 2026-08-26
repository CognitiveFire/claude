/**
 * Webhook signature verification.
 *
 * Uses a timing-safe comparison over the RAW body bytes. Re-serialising JSON
 * before hashing is the classic way to break signature verification, so the
 * raw Buffer is carried all the way from the HTTP layer.
 *
 * Returns false when no signature header is present. It never returns true on
 * the grounds that verification was impossible.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RawWebhook } from '../../ports/producer.ts';
import { logger } from '../../observability/logger.ts';

export function verifyHmacWebhook(
  raw: RawWebhook,
  secret: string,
  headerNames: readonly string[],
  encoding: 'hex' | 'base64' = 'hex',
): boolean {
  const normalised = new Map<string, string>();
  for (const [key, value] of Object.entries(raw.headers)) {
    if (typeof value === 'string') normalised.set(key.toLowerCase(), value);
  }

  const provided = headerNames
    .map((name) => normalised.get(name.toLowerCase()))
    .find((value): value is string => typeof value === 'string' && value.length > 0);

  if (!provided) {
    logger.warn('webhook rejected: no signature header present', { expected: headerNames });
    return false;
  }

  const expected = createHmac('sha256', secret).update(raw.body).digest(encoding);
  const a = Buffer.from(provided.trim(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
