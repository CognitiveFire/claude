/**
 * Propose a product for an artwork on a chosen producer.
 *
 * Finds the garment in the supplier catalogue, records the variant mapping, and
 * validates the print file against the supplier's real print area. It creates
 * no supplier product and no storefront product — that is publish's job.
 */

import { audit } from '../observability/audit.ts';
import { logger } from '../observability/logger.ts';
import type { PrintFileValidationResult } from '../ports/producer.ts';
import {
  getArtwork,
  insertProducerProduct,
  insertProduct,
  insertVariants,
  upsertProducer,
} from '../db/repositories/index.ts';
import { producerFor, type Context } from './context.ts';

export interface ProposeProductInput {
  readonly artworkId: string;
  readonly producer?: string;
  readonly name: string;
  readonly slug: string;
  /** Manufacturer SKU to search for, e.g. STTU169. */
  readonly manufacturerSku: string;
  readonly placement: string;
  readonly sizes: readonly string[];
  readonly colour: string | null;
}

export interface ProposeProductResult {
  readonly productId: string;
  readonly producerId: string;
  readonly producerProductId: string;
  readonly catalogueName: string;
  readonly variantCount: number;
  readonly skippedSizes: readonly string[];
  readonly printFile: PrintFileValidationResult;
  readonly provenance: 'LIVE_API' | 'FIXTURE';
}

export async function proposeProduct(
  context: Context,
  input: ProposeProductInput,
): Promise<ProposeProductResult> {
  const artwork = await getArtwork(context.db, input.artworkId);
  if (!artwork) throw new Error(`Unknown artwork ${input.artworkId}.`);
  if (artwork.widthPx === null || artwork.heightPx === null) {
    throw new Error('Artwork has no recorded dimensions; re-register it.');
  }

  const producer = producerFor(context.env, input.producer);
  const log = logger.child({ producer: producer.id, artwork: input.artworkId });

  const search = await producer.searchCatalogue({
    manufacturerSku: input.manufacturerSku,
    productType: 't-shirt',
    destinationCountry: 'GB',
    limit: 25,
  });

  const candidate = search.data[0];
  if (!candidate) {
    throw new Error(
      `${producer.displayName} returned no catalogue product matching ` +
        `"${input.manufacturerSku}". Availability of that garment on this supplier is ` +
        'therefore UNKNOWN, not absent — verify against the live API before concluding.',
    );
  }
  if (search.data.length > 1) {
    log.warn('multiple catalogue matches; using the first and recording the rest', {
      matches: search.data.map((p) => ({ id: p.producerProductId, name: p.name })),
    });
  }

  const variants = await producer.getVariants(candidate.producerProductId);
  const wantedSizes = new Set(input.sizes.map((s) => s.toUpperCase()));

  const selected = variants.data.filter((variant) => {
    const sizeMatch = variant.size !== null && wantedSizes.has(variant.size.toUpperCase());
    const colourMatch =
      input.colour === null ||
      (variant.colour !== null && variant.colour.toLowerCase() === input.colour.toLowerCase());
    return sizeMatch && colourMatch;
  });

  if (selected.length === 0) {
    throw new Error(
      `No variants matched sizes [${input.sizes.join(', ')}]` +
        `${input.colour ? ` in ${input.colour}` : ''}. ` +
        `Supplier offers: ${variants.data
          .map((v) => `${v.size ?? '?'}/${v.colour ?? '?'}`)
          .join(', ')}`,
    );
  }

  const foundSizes = new Set(selected.map((v) => v.size?.toUpperCase()));
  const skippedSizes = input.sizes.filter((s) => !foundSizes.has(s.toUpperCase()));

  const printFile = await producer.validatePrintFile({
    producerVariantId: candidate.producerProductId,
    placement: input.placement,
    widthPx: artwork.widthPx,
    heightPx: artwork.heightPx,
    colourSpace: artwork.colourSpace,
    hasAlpha: artwork.hasAlpha,
    fileSizeBytes: artwork.fileSizeBytes,
    format: artwork.format ?? 'unknown',
  });

  const producerRowId = await upsertProducer(context.db, producer.id, producer.displayName);
  const productId = await insertProduct(context.db, {
    artworkId: input.artworkId,
    name: input.name,
    slug: input.slug,
    productType: 'T-Shirt',
  });

  const producerProductRowId = await insertProducerProduct(context.db, {
    productId,
    producerId: producerRowId,
    producerProductId: candidate.producerProductId,
    manufacturerSku: candidate.manufacturerSku ?? input.manufacturerSku,
  });

  await insertVariants(
    context.db,
    productId,
    producerProductRowId,
    selected.map((variant) => ({
      sku: buildSku(input.slug, variant.colour, variant.size),
      size: variant.size,
      colour: variant.colour,
      producerVariantId: variant.producerVariantId,
      producerSku: variant.sku,
      availability: variant.availability,
    })),
    context.env.BASE_CURRENCY,
  );

  await audit({
    actor: context.actor,
    action: 'product.propose',
    entityType: 'product',
    entityId: productId,
    outcome: printFile.data.acceptable ? 'SUCCESS' : 'BLOCKED',
    after: {
      producer: producer.id,
      producerProductId: candidate.producerProductId,
      variants: selected.length,
      printFileAcceptable: printFile.data.acceptable,
      provenance: search.provenance,
    },
    externalResponse: search.raw,
  });

  return {
    productId,
    producerId: producer.id,
    producerProductId: candidate.producerProductId,
    catalogueName: candidate.name,
    variantCount: selected.length,
    skippedSizes,
    printFile: printFile.data,
    provenance: search.provenance,
  };
}

function buildSku(slug: string, colour: string | null, size: string | null): string {
  const parts = [slug.toUpperCase().replace(/[^A-Z0-9]+/g, '-')];
  if (colour) parts.push(colour.toUpperCase().replace(/[^A-Z0-9]+/g, ''));
  if (size) parts.push(size.toUpperCase());
  return parts.join('-');
}
