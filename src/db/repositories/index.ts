/**
 * Repositories. Thin, explicit, and the only place SQL-shaped concerns live.
 *
 * Deliberately functions rather than classes: there is one database and one
 * process, and a class per table would be ceremony without benefit.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../client.ts';
import { schema } from '../client.ts';
import type { Money } from '../../core/money.ts';
import type { EconomicsFigures } from '../../core/economics/types.ts';
import type { CommercialConfig } from '../../config/env.ts';
import type { DataProvenance, ProducerId } from '../../ports/producer.ts';

const minor = (value: Money | null | undefined): number | null =>
  value === null || value === undefined ? null : value.minor;

// --- producers -------------------------------------------------------------

export async function upsertProducer(
  db: Database,
  slug: ProducerId,
  displayName: string,
): Promise<string> {
  const existing = await db
    .select({ id: schema.producers.id })
    .from(schema.producers)
    .where(eq(schema.producers.slug, slug))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const inserted = await db
    .insert(schema.producers)
    .values({ slug, displayName })
    .returning({ id: schema.producers.id });
  return inserted[0]!.id;
}

// --- artworks --------------------------------------------------------------

export interface NewArtwork {
  readonly title: string;
  readonly artist: string | null;
  readonly sourcePath: string;
  readonly fileHash: string;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly format: string | null;
  readonly colourSpace: string | null;
  readonly hasAlpha: boolean | null;
  readonly fileSizeBytes: number | null;
  readonly declaredDpi: number | null;
  readonly brandReferenceStatus: 'UNKNOWN' | 'REVIEW_REQUIRED' | 'CLEARED' | 'BLOCKED';
  readonly advertisingRestrictions: readonly string[];
  readonly reviewNotes: readonly string[];
}

export async function insertArtwork(db: Database, artwork: NewArtwork): Promise<string> {
  const inserted = await db
    .insert(schema.artworks)
    .values({
      title: artwork.title,
      artist: artwork.artist,
      sourcePath: artwork.sourcePath,
      fileHash: artwork.fileHash,
      widthPx: artwork.widthPx,
      heightPx: artwork.heightPx,
      format: artwork.format,
      colourSpace: artwork.colourSpace,
      hasAlpha: artwork.hasAlpha,
      fileSizeBytes: artwork.fileSizeBytes,
      declaredDpi: artwork.declaredDpi,
      brandReferenceStatus: artwork.brandReferenceStatus,
      advertisingRestrictions: [...artwork.advertisingRestrictions],
      reviewNotes: [...artwork.reviewNotes],
    })
    .onConflictDoNothing({ target: schema.artworks.fileHash })
    .returning({ id: schema.artworks.id });

  if (inserted[0]) return inserted[0].id;

  // Same file already registered: return the existing row rather than creating
  // a duplicate artwork identity.
  const existing = await db
    .select({ id: schema.artworks.id })
    .from(schema.artworks)
    .where(eq(schema.artworks.fileHash, artwork.fileHash))
    .limit(1);
  return existing[0]!.id;
}

export async function getArtwork(db: Database, id: string) {
  const rows = await db
    .select()
    .from(schema.artworks)
    .where(eq(schema.artworks.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listArtworks(db: Database) {
  return db.select().from(schema.artworks).orderBy(desc(schema.artworks.createdAt)).limit(50);
}

// --- products --------------------------------------------------------------

export interface NewProduct {
  readonly artworkId: string;
  readonly name: string;
  readonly slug: string;
  readonly productType: string;
}

export async function insertProduct(db: Database, product: NewProduct): Promise<string> {
  const inserted = await db
    .insert(schema.products)
    .values(product)
    .returning({ id: schema.products.id });
  return inserted[0]!.id;
}

export async function getProduct(db: Database, id: string) {
  const rows = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listProducts(db: Database) {
  return db.select().from(schema.products).orderBy(desc(schema.products.createdAt)).limit(50);
}

export async function updateProductStatus(
  db: Database,
  id: string,
  status: 'DRAFT' | 'PRICED' | 'PUBLISHED_DRAFT' | 'LIVE' | 'ARCHIVED',
): Promise<void> {
  await db
    .update(schema.products)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.products.id, id));
}

export async function updateProductCopy(
  db: Database,
  id: string,
  copy: {
    readonly descriptionHtml: string;
    readonly seoTitle: string;
    readonly seoDescription: string;
    readonly tags: readonly string[];
  },
): Promise<void> {
  await db
    .update(schema.products)
    .set({
      descriptionHtml: copy.descriptionHtml,
      seoTitle: copy.seoTitle,
      seoDescription: copy.seoDescription,
      tags: [...copy.tags],
      updatedAt: new Date(),
    })
    .where(eq(schema.products.id, id));
}

// --- variants and producer mapping ----------------------------------------

export interface NewVariantMapping {
  readonly sku: string;
  readonly size: string | null;
  readonly colour: string | null;
  readonly producerVariantId: string;
  readonly producerSku: string | null;
  readonly availability: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'DISCONTINUED' | 'UNKNOWN';
}

export async function insertProducerProduct(
  db: Database,
  input: {
    readonly productId: string;
    readonly producerId: string;
    readonly producerProductId: string;
    readonly manufacturerSku: string | null;
  },
): Promise<string> {
  const inserted = await db
    .insert(schema.producerProducts)
    .values(input)
    .returning({ id: schema.producerProducts.id });
  return inserted[0]!.id;
}

export async function insertVariants(
  db: Database,
  productId: string,
  producerProductRowId: string,
  variants: readonly NewVariantMapping[],
  currency: 'GBP' | 'EUR' | 'USD',
): Promise<void> {
  for (const variant of variants) {
    const inserted = await db
      .insert(schema.productVariants)
      .values({
        productId,
        sku: variant.sku,
        size: variant.size,
        colour: variant.colour,
        currency,
      })
      .returning({ id: schema.productVariants.id });

    await db.insert(schema.producerVariants).values({
      productVariantId: inserted[0]!.id,
      producerProductRowId,
      producerVariantId: variant.producerVariantId,
      producerSku: variant.producerSku,
      availability: variant.availability,
      availabilityCheckedAt: new Date(),
    });
  }
}

export async function listVariantsWithProducer(db: Database, productId: string) {
  return db
    .select({
      variantId: schema.productVariants.id,
      sku: schema.productVariants.sku,
      size: schema.productVariants.size,
      colour: schema.productVariants.colour,
      priceMinor: schema.productVariants.priceMinor,
      currency: schema.productVariants.currency,
      producerVariantId: schema.producerVariants.producerVariantId,
      availability: schema.producerVariants.availability,
      producerProductId: schema.producerProducts.producerProductId,
      producerProductRowId: schema.producerProducts.id,
      producerSlug: schema.producers.slug,
    })
    .from(schema.productVariants)
    .innerJoin(
      schema.producerVariants,
      eq(schema.producerVariants.productVariantId, schema.productVariants.id),
    )
    .innerJoin(
      schema.producerProducts,
      eq(schema.producerProducts.id, schema.producerVariants.producerProductRowId),
    )
    .innerJoin(schema.producers, eq(schema.producers.id, schema.producerProducts.producerId))
    .where(eq(schema.productVariants.productId, productId));
}

export async function setVariantPrices(
  db: Database,
  productId: string,
  price: Money,
): Promise<void> {
  await db
    .update(schema.productVariants)
    .set({ priceMinor: price.minor, currency: price.currency })
    .where(eq(schema.productVariants.productId, productId));
}

// --- economic snapshots ----------------------------------------------------

export async function insertEconomicSnapshot(
  db: Database,
  input: {
    readonly productId: string;
    readonly producerId: string;
    readonly provenance: DataProvenance;
    readonly quotedAt: Date;
    readonly config: CommercialConfig;
    readonly figures: EconomicsFigures | null;
    readonly unknowns: readonly string[];
    readonly retailPrice: Money;
    readonly shippingCharged: Money;
    readonly rawSupplierResponse: unknown;
  },
): Promise<string> {
  const f = input.figures;
  const inserted = await db
    .insert(schema.economicSnapshots)
    .values({
      productId: input.productId,
      producerId: input.producerId,
      provenance: input.provenance,
      quotedAt: input.quotedAt,
      currency: input.config.currency,
      retailPriceMinor: input.retailPrice.minor,
      shippingChargedMinor: input.shippingCharged.minor,
      garmentCostMinor: minor(f?.garmentCost),
      printCostMinor: minor(f?.printCost),
      fulfilmentCostMinor: minor(f?.fulfilmentCost),
      shippingCostMinor: minor(f?.shippingCostPaid),
      adCostPerUnitMinor: minor(f?.adCostPerUnit),
      commercialConfig: input.config as unknown as Record<string, unknown>,
      vatMinor: minor(f?.vat),
      netRevenueMinor: minor(f?.netRevenue),
      paymentFeesMinor: minor(f?.paymentFees),
      platformFeesMinor: minor(f?.platformFees),
      returnsAllowanceMinor: minor(f?.returnsAllowance),
      contributionBeforeAdsMinor: minor(f?.contributionBeforeAdvertising),
      contributionAfterAdsMinor: minor(f?.contributionAfterAdvertising),
      grossMarginPct: f?.grossMarginPct?.toFixed(4) ?? null,
      contributionMarginPct: f?.contributionMarginPct?.toFixed(4) ?? null,
      breakEvenCpaMinor: minor(f?.breakEvenCpa),
      breakEvenRoas: f?.breakEvenRoas?.toFixed(4) ?? null,
      targetCpaMinor: minor(f?.targetCpa),
      targetRoas: f?.targetRoas?.toFixed(4) ?? null,
      unknowns: [...input.unknowns],
      warnings: [...(f?.warnings ?? [])],
      rawSupplierResponse: input.rawSupplierResponse as Record<string, unknown>,
    })
    .returning({ id: schema.economicSnapshots.id });
  return inserted[0]!.id;
}

export async function latestSnapshot(db: Database, productId: string) {
  const rows = await db
    .select()
    .from(schema.economicSnapshots)
    .where(eq(schema.economicSnapshots.productId, productId))
    .orderBy(desc(schema.economicSnapshots.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

// --- commerce mapping ------------------------------------------------------

export async function insertCommerceProduct(
  db: Database,
  input: {
    readonly productId: string;
    readonly commerceProductId: string;
    readonly handle: string | null;
    readonly adminUrl: string | null;
    readonly status: string;
  },
): Promise<string> {
  const inserted = await db
    .insert(schema.commerceProducts)
    .values({ ...input, platform: 'shopify' })
    .returning({ id: schema.commerceProducts.id });
  return inserted[0]!.id;
}

export async function insertCommerceVariants(
  db: Database,
  commerceProductRowId: string,
  mappings: readonly { readonly internalVariantId: string; readonly commerceVariantId: string }[],
): Promise<void> {
  if (mappings.length === 0) return;
  await db.insert(schema.commerceVariants).values(
    mappings.map((mapping) => ({
      commerceProductRowId,
      productVariantId: mapping.internalVariantId,
      commerceVariantId: mapping.commerceVariantId,
    })),
  );
}

export async function findCommerceProduct(db: Database, productId: string) {
  const rows = await db
    .select()
    .from(schema.commerceProducts)
    .where(
      and(
        eq(schema.commerceProducts.productId, productId),
        isNull(schema.commerceProducts.publishedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
