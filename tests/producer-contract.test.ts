/**
 * One contract, applied to every adapter.
 *
 * This is the test that keeps the supplier replaceable. If a Printful-shaped
 * assumption leaks into the system, the Gelato run of this suite fails. It runs
 * entirely on fixtures, so it needs no network and no credentials.
 */

import { describe, expect, it } from 'vitest';
import { GelatoAdapter } from '../src/adapters/producer/gelato/index.ts';
import { PrintfulAdapter } from '../src/adapters/producer/printful/index.ts';
import { calculateEconomics } from '../src/core/economics/engine.ts';
import { money, zero } from '../src/core/money.ts';
import type { ProducerPort } from '../src/ports/producer.ts';
import { testConfig } from './helpers.ts';

const adapters: readonly ProducerPort[] = [
  new PrintfulAdapter({ currency: 'GBP', useFixtures: true }),
  new GelatoAdapter({ currency: 'GBP', useFixtures: true }),
];

describe.each(adapters.map((a) => [a.id, a] as const))('ProducerPort contract: %s', (_id, producer) => {
  it('declares that it is serving fixtures', () => {
    expect(producer.usingFixtures).toBe(true);
  });

  it('finds the candidate garment by manufacturer SKU', async () => {
    const response = await producer.searchCatalogue({
      manufacturerSku: 'STTU169',
      productType: 't-shirt',
      limit: 10,
    });
    expect(response.provenance).toBe('FIXTURE');
    expect(response.producerId).toBe(producer.id);
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.raw).not.toBeNull();
    const product = response.data[0]!;
    expect(product.producerProductId).not.toBe('');
    expect(product.name).not.toBe('');
  });

  it('returns variants with stable IDs and a normalised availability enum', async () => {
    const search = await producer.searchCatalogue({ manufacturerSku: 'STTU169' });
    const productId = search.data[0]!.producerProductId;
    const variants = await producer.getVariants(productId);

    expect(variants.data.length).toBeGreaterThan(0);
    for (const variant of variants.data) {
      expect(variant.producerVariantId).not.toBe('');
      expect(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'DISCONTINUED', 'UNKNOWN'])
        .toContain(variant.availability);
    }
    // Sizes must survive the mapping — they become Shopify variant options.
    expect(variants.data.map((v) => v.size)).toContain('M');
  });

  it('publishes print areas with pixel dimensions', async () => {
    const areas = await producer.getPrintAreas('any-product');
    expect(areas.data.length).toBeGreaterThan(0);
    const front = areas.data.find((a) => a.placement === 'front');
    expect(front).toBeDefined();
    expect(front!.widthPx).toBeGreaterThan(0);
    expect(front!.heightPx).toBeGreaterThan(0);
  });

  it('quotes cost in a single currency with explicit availability', async () => {
    const quote = await producer.getCostQuote({
      producerVariantId: 'variant-1',
      placements: ['front'],
      destinationCountry: 'GB',
      quantity: 1,
    });
    expect(quote.data.currency).toBe('GBP');
    expect(quote.data.productCost).not.toBeNull();
    expect(quote.data.shippingCost).not.toBeNull();
    expect(quote.data.availability).toBe('IN_STOCK');
  });

  it('feeds the economics engine to a COMPLETE result without adapter-specific code', async () => {
    const quote = await producer.getCostQuote({
      producerVariantId: 'variant-1',
      placements: ['front'],
      destinationCountry: 'GB',
      quantity: 1,
    });

    const result = calculateEconomics({
      retailPriceIncVat: money(4500, 'GBP'),
      shippingChargedIncVat: zero('GBP'),
      garmentCost: quote.data.productCost,
      printCost: quote.data.printCost,
      fulfilmentCost: quote.data.fulfilmentCost,
      shippingCostPaid: quote.data.shippingCost,
      adCostPerUnit: null,
      config: testConfig(),
    });

    expect(result.status).toBe('COMPLETE');
  });

  it('validates a print file against the real print area and rejects a small one', async () => {
    const good = await producer.validatePrintFile({
      producerVariantId: 'any-product',
      placement: 'front',
      widthPx: 3600,
      heightPx: 4800,
      colourSpace: 'srgb',
      hasAlpha: true,
      fileSizeBytes: 8_000_000,
      format: 'png',
    });
    expect(good.data.errors).toEqual([]);
    expect(good.data.acceptable).toBe(true);

    const tooSmall = await producer.validatePrintFile({
      producerVariantId: 'any-product',
      placement: 'front',
      widthPx: 600,
      heightPx: 800,
      colourSpace: 'srgb',
      hasAlpha: true,
      fileSizeBytes: 100_000,
      format: 'png',
    });
    expect(tooSmall.data.acceptable).toBe(false);
    expect(tooSmall.data.errors.join(' ')).toMatch(/upscaling|DPI/);
  });

  it('normalises order status onto the shared enum', async () => {
    const order = await producer.getOrder('order-1');
    expect([
      'DRAFT', 'PENDING', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED',
      'CANCELLED', 'FAILED', 'UNKNOWN',
    ]).toContain(order.data.status);
    expect(order.data.producerOrderId).not.toBe('');
  });

  it('returns tracking information in the shared shape', async () => {
    const status = await producer.getShipmentStatus('order-1');
    expect(status.data.shipments.length).toBeGreaterThan(0);
    expect(status.data.shipments[0]!.trackingNumber).not.toBeNull();
  });

  it('refuses to call a webhook verified when no shared secret is configured', () => {
    const verified = producer.verifyWebhook({
      headers: { 'x-printful-signature': 'nonsense', 'x-gelato-signature': 'nonsense' },
      body: Buffer.from('{}'),
    });
    expect(verified).toBe(false);
  });

  it('parses a webhook into a stable event ID for idempotent replay handling', () => {
    const parsed = producer.parseWebhook({
      headers: {},
      body: Buffer.from(JSON.stringify({ id: 'evt_1', type: 'order_updated', event: 'order_status_updated' })),
    });
    expect(parsed.eventId).toBe('evt_1');
    expect(parsed.kind).toBe('ORDER_UPDATED');
  });
});

describe('cross-supplier comparison', () => {
  it('produces comparable landed cost from both suppliers through one interface', async () => {
    const quotes = await Promise.all(
      adapters.map(async (producer) => {
        const quote = await producer.getCostQuote({
          producerVariantId: 'variant-1',
          placements: ['front'],
          destinationCountry: 'GB',
          quantity: 1,
        });
        const production =
          (quote.data.productCost?.minor ?? 0) +
          (quote.data.printCost?.minor ?? 0) +
          (quote.data.fulfilmentCost?.minor ?? 0);
        return {
          producer: producer.id,
          landedMinor: production + (quote.data.shippingCost?.minor ?? 0),
          provenance: quote.provenance,
        };
      }),
    );

    expect(quotes).toHaveLength(2);
    // Both must be FIXTURE here: no live comparison has been performed, and
    // nothing in the system may present these as real supplier prices.
    for (const quote of quotes) {
      expect(quote.provenance).toBe('FIXTURE');
      expect(quote.landedMinor).toBeGreaterThan(0);
    }
  });
});
