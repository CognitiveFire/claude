import { loadCommercial, loadEnv, type CommercialConfig, type Env } from '../config/env.ts';
import { createProducer, isProducerId } from '../adapters/producer/registry.ts';
import { ShopifyAdapter } from '../adapters/commerce/shopify/index.ts';
import { getDatabase, type Database } from '../db/client.ts';
import type { CommercePort } from '../ports/commerce.ts';
import type { ProducerId, ProducerPort } from '../ports/producer.ts';

export interface Context {
  readonly env: Env;
  readonly db: Database;
  readonly actor: string;
}

export function createContext(actor: string): Context {
  return { env: loadEnv(), db: getDatabase(), actor };
}

export function commercial(): CommercialConfig {
  return loadCommercial();
}

export function producerFor(env: Env, requested?: string): ProducerPort {
  const id: ProducerId = requested
    ? (() => {
        if (!isProducerId(requested)) {
          throw new Error(`Unknown producer "${requested}". Known: printful, gelato.`);
        }
        return requested;
      })()
    : env.DEFAULT_PRODUCER;
  return createProducer(id, env);
}

export function commerceFor(env: Env): CommercePort {
  return new ShopifyAdapter({
    shopDomain: env.SHOPIFY_SHOP_DOMAIN,
    accessToken: env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    apiVersion: env.SHOPIFY_API_VERSION,
    currency: env.BASE_CURRENCY,
  });
}
