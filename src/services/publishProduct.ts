/**
 * Publish a product as a Shopify DRAFT.
 *
 * This is the gate. Every check below fails closed, and none of them can be
 * bypassed by a flag:
 *
 *  1. Rights   — UNKNOWN or REVIEW_REQUIRED blocks. An unknown is not consent.
 *  2. Costs    — the snapshot must come from a LIVE_API quote. Fixture or
 *                simulated costs cannot reach a real product page.
 *  3. Freshness— a quote older than COST_QUOTE_TTL_MINUTES is stale.
 *  4. Complete — any UNKNOWN cost line blocks. So does negative contribution.
 *  5. Print    — the artwork must pass validation against the real print area.
 *  6. Copy     — a product with no description does not get published.
 *
 * Nothing here sets a product ACTIVE. Going live is a separate decision.
 */

import { audit } from '../observability/audit.ts';
import { format, money, toMajorString } from '../core/money.ts';
import { evaluateRightsGate, type RightsRecord } from '../core/rights.ts';
import { validatePrintFile } from '../core/printfile.ts';
import type { CommerceProductRef } from '../ports/commerce.ts';
import {
  findCommerceProduct,
  getArtwork,
  getProduct,
  insertCommerceProduct,
  insertCommerceVariants,
  latestSnapshot,
  listVariantsWithProducer,
  updateProductStatus,
} from '../db/repositories/index.ts';
import { commerceFor, producerFor, type Context } from './context.ts';

export interface PublishProductInput {
  readonly productId: string;
  readonly placement: string;
  /** Publicly reachable URL of the print file for the producer. */
  readonly printFileUrl: string;
  readonly vendor: string;
}

export class PublishBlockedError extends Error {
  readonly blockers: readonly string[];

  constructor(blockers: readonly string[]) {
    super(
      `Publication blocked by ${blockers.length} check(s):\n` +
        blockers.map((b) => `  - ${b}`).join('\n'),
    );
    this.name = 'PublishBlockedError';
    this.blockers = blockers;
  }
}

export interface PublishResult {
  readonly commerce: CommerceProductRef;
  readonly dryRun: boolean;
  readonly mockupUrls: readonly string[];
}

export async function publishProduct(
  context: Context,
  input: PublishProductInput,
): Promise<PublishResult> {
  const blockers: string[] = [];

  const product = await getProduct(context.db, input.productId);
  if (!product) throw new Error(`Unknown product ${input.productId}.`);
  const artwork = await getArtwork(context.db, product.artworkId);
  if (!artwork) throw new Error(`Product ${input.productId} has no artwork.`);

  // --- 1. Rights ----------------------------------------------------------
  const rights: RightsRecord = {
    artworkRightsStatus: artwork.artworkRightsStatus,
    brandReferenceStatus: artwork.brandReferenceStatus,
    licensingRequired: artwork.licensingRequired,
    licensingStatus: artwork.licensingStatus,
    advertisingRestrictions: (artwork.advertisingRestrictions as string[]) ?? [],
    reviewNotes: (artwork.reviewNotes as string[]) ?? [],
  };
  const rightsGate = evaluateRightsGate(rights);
  blockers.push(...rightsGate.blockers);

  // --- 2/3/4. Economics ---------------------------------------------------
  const snapshot = await latestSnapshot(context.db, input.productId);
  if (!snapshot) {
    blockers.push('No economic snapshot exists. Run `ia product:price` first.');
  } else {
    if (snapshot.provenance !== 'LIVE_API') {
      blockers.push(
        `The latest cost snapshot has provenance ${snapshot.provenance}. Only a ` +
          'LIVE_API supplier quote may back a published product — fixture costs are ' +
          'placeholders, not prices.',
      );
    }
    const ageMinutes = (Date.now() - snapshot.quotedAt.getTime()) / 60_000;
    if (ageMinutes > context.env.COST_QUOTE_TTL_MINUTES) {
      blockers.push(
        `The supplier quote is ${Math.round(ageMinutes)} minutes old, beyond the ` +
          `${context.env.COST_QUOTE_TTL_MINUTES} minute limit. Re-price before publishing.`,
      );
    }
    const unknowns = (snapshot.unknowns as string[]) ?? [];
    if (unknowns.length > 0) {
      blockers.push(`Cost lines are UNKNOWN: ${unknowns.join(', ')}.`);
    }
    if (
      snapshot.contributionBeforeAdsMinor === null ||
      snapshot.contributionBeforeAdsMinor <= 0
    ) {
      blockers.push(
        'Contribution before advertising is not positive. Publishing this product ' +
          'would lose money on every unit sold.',
      );
    }
    if (snapshot.retailPriceMinor <= 0) {
      blockers.push('No retail price is set on the snapshot.');
    }
  }

  // --- 5. Print file ------------------------------------------------------
  const variants = await listVariantsWithProducer(context.db, input.productId);
  if (variants.length === 0) blockers.push('Product has no variants.');

  const producer = producerFor(context.env, variants[0]?.producerSlug);
  let mockupUrls: readonly string[] = [];

  if (variants[0] && artwork.widthPx !== null && artwork.heightPx !== null) {
    const areas = await producer.getPrintAreas(variants[0].producerProductId);
    const area =
      areas.data.find((a) => a.placement === input.placement) ?? areas.data[0] ?? null;
    if (!area) {
      blockers.push(
        `No print area published for placement "${input.placement}"; the print file ` +
          'cannot be validated.',
      );
    } else {
      const validation = validatePrintFile(
        {
          widthPx: artwork.widthPx,
          heightPx: artwork.heightPx,
          format: artwork.format ?? 'unknown',
          colourSpace: artwork.colourSpace,
          hasAlpha: artwork.hasAlpha,
          fileSizeBytes: artwork.fileSizeBytes,
          declaredDpi: artwork.declaredDpi,
        },
        area,
      );
      if (!validation.acceptable) {
        blockers.push(...validation.errors.map((e) => `Print file: ${e}`));
      }
    }
  }

  // --- 6. Copy ------------------------------------------------------------
  if (!product.descriptionHtml || product.descriptionHtml.trim() === '') {
    blockers.push('Product has no description. Run `ia product:copy` first.');
  }
  if (!product.seoTitle || !product.seoDescription) {
    blockers.push('Product is missing SEO title or description.');
  }

  const existing = await findCommerceProduct(context.db, input.productId);
  if (existing) {
    blockers.push(
      `Product is already mapped to ${existing.platform} product ` +
        `${existing.commerceProductId}. Use an update rather than a second create.`,
    );
  }

  if (blockers.length > 0) {
    await audit({
      actor: context.actor,
      action: 'product.publish',
      entityType: 'product',
      entityId: input.productId,
      outcome: 'BLOCKED',
      after: { blockers },
    });
    throw new PublishBlockedError(blockers);
  }

  // --- Producer product (for supplier IDs and mockup imagery) -------------
  const producerProduct = await producer.createProduct({
    name: product.name,
    producerProductId: variants[0]!.producerProductId,
    externalId: input.productId,
    variants: variants.map((variant) => ({
      producerVariantId: variant.producerVariantId,
      placements: [{ placement: input.placement, imageUrl: input.printFileUrl }],
    })),
  });
  mockupUrls = producerProduct.data.mockupUrls;

  // --- Storefront draft ---------------------------------------------------
  const commerce = commerceFor(context.env);
  const price = money(snapshot!.retailPriceMinor, snapshot!.currency);

  const ref = await commerce.createDraftProduct({
    title: product.name,
    descriptionHtml: product.descriptionHtml!,
    productType: product.productType,
    vendor: input.vendor,
    tags: (product.tags as string[]) ?? [],
    seoTitle: product.seoTitle!,
    seoDescription: product.seoDescription!,
    status: 'DRAFT',
    variants: variants.map((variant) => ({
      internalVariantId: variant.variantId,
      sku: variant.sku,
      priceIncVat: price,
      optionValues: {
        ...(variant.size ? { Size: variant.size } : {}),
        ...(variant.colour ? { Colour: variant.colour } : {}),
      },
      producerVariantId: variant.producerVariantId,
      weightGrams: null,
      inventoryPolicy: 'CONTINUE',
    })),
    images: mockupUrls.map((url, index) => ({
      url,
      altText: `${product.name} — ${artwork.title}`,
      position: index + 1,
    })),
    identifiers: {
      internalProductId: input.productId,
      producerId: producer.id,
      producerProductId: variants[0]!.producerProductId,
    },
  });

  const commerceRowId = await insertCommerceProduct(context.db, {
    productId: input.productId,
    commerceProductId: ref.commerceProductId,
    handle: ref.handle,
    adminUrl: ref.adminUrl,
    status: ref.status,
  });
  await insertCommerceVariants(
    context.db,
    commerceRowId,
    ref.variants.map((variant) => ({
      internalVariantId: variant.internalVariantId,
      commerceVariantId: variant.commerceVariantId,
    })),
  );
  await updateProductStatus(context.db, input.productId, 'PUBLISHED_DRAFT');

  await audit({
    actor: context.actor,
    action: 'product.publish',
    entityType: 'product',
    entityId: input.productId,
    outcome: 'SUCCESS',
    after: {
      commerceProductId: ref.commerceProductId,
      dryRun: commerce.dryRun,
      priceIncVat: toMajorString(price),
      variants: ref.variants.length,
      images: mockupUrls.length,
    },
  });

  return { commerce: ref, dryRun: commerce.dryRun, mockupUrls };
}

/** Human-readable one-line summary used by the CLI. */
export function describePublication(result: PublishResult, price: number, currency: 'GBP' | 'EUR' | 'USD'): string {
  return (
    `${result.dryRun ? 'DRY RUN — nothing created. ' : ''}` +
    `${result.commerce.commerceProductId} at ${format(money(price, currency))} ` +
    `(${result.commerce.variants.length} variants, ${result.mockupUrls.length} images)`
  );
}
