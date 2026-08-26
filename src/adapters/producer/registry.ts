/**
 * Producer registry.
 *
 * The ONLY place that knows which concrete adapters exist. Adding a supplier is
 * one entry here plus one adapter directory; nothing in services/ or core/
 * changes.
 */

import type { Env } from '../../config/env.ts';
import type { ProducerId, ProducerPort } from '../../ports/producer.ts';
import { GelatoAdapter } from './gelato/index.ts';
import { PrintfulAdapter } from './printful/index.ts';

export const PRODUCER_IDS: readonly ProducerId[] = ['printful', 'gelato'];

export function isProducerId(value: string): value is ProducerId {
  return (PRODUCER_IDS as readonly string[]).includes(value);
}

export function createProducer(id: ProducerId, env: Env): ProducerPort {
  switch (id) {
    case 'printful':
      return new PrintfulAdapter({
        apiToken: env.PRINTFUL_API_TOKEN,
        storeId: env.PRINTFUL_STORE_ID,
        currency: env.BASE_CURRENCY,
        useFixtures: env.PRODUCER_USE_FIXTURES,
      });
    case 'gelato':
      return new GelatoAdapter({
        apiKey: env.GELATO_API_KEY,
        currency: env.BASE_CURRENCY,
        useFixtures: env.PRODUCER_USE_FIXTURES,
      });
  }
}

/** Every configured producer, for side-by-side supplier comparison. */
export function createAllProducers(env: Env): readonly ProducerPort[] {
  return PRODUCER_IDS.map((id) => createProducer(id, env));
}
