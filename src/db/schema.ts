/**
 * Relational schema (PostgreSQL via Drizzle).
 *
 * Rules this schema enforces:
 *  - Internal UUIDs are the only primary keys. Names are display data.
 *  - Every external identifier is stored explicitly and separately, with a
 *    unique constraint per (system, id) so a mapping cannot silently duplicate.
 *  - Money is an integer number of minor units alongside its currency. There is
 *    no float column anywhere in the commercial path.
 *  - economic_snapshots is append-only: a price is a historical fact.
 *
 * Milestone 2 adds customers, orders, order_items and webhook_events; those
 * tables are deliberately absent rather than created empty.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const currencyEnum = pgEnum('currency', ['GBP', 'EUR', 'USD']);

export const productStatusEnum = pgEnum('product_status', [
  'DRAFT',
  'PRICED',
  'PUBLISHED_DRAFT',
  'LIVE',
  'ARCHIVED',
]);

export const rightsStatusEnum = pgEnum('rights_status', [
  'UNKNOWN',
  'REVIEW_REQUIRED',
  'CLEARED',
  'BLOCKED',
]);

export const licensingStatusEnum = pgEnum('licensing_status', [
  'NOT_REQUIRED',
  'REQUIRED_NOT_OBTAINED',
  'OBTAINED',
  'UNKNOWN',
]);

export const provenanceEnum = pgEnum('data_provenance', ['LIVE_API', 'FIXTURE']);

export const availabilityEnum = pgEnum('availability', [
  'IN_STOCK',
  'LOW_STOCK',
  'OUT_OF_STOCK',
  'DISCONTINUED',
  'UNKNOWN',
]);

export const campaignStateEnum = pgEnum('campaign_state', [
  'DRAFT',
  'APPROVED',
  'LIVE',
  'PAUSED',
  'KILLED',
]);

// ---------------------------------------------------------------------------

export const artworks = pgTable(
  'artworks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    artist: text('artist'),
    sourcePath: text('source_path').notNull(),
    /** sha256 of the file: the artwork's real identity. */
    fileHash: text('file_hash').notNull(),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),
    format: text('format'),
    colourSpace: text('colour_space'),
    hasAlpha: boolean('has_alpha'),
    fileSizeBytes: integer('file_size_bytes'),
    declaredDpi: integer('declared_dpi'),

    // Intellectual property. Defaults are the safe answer, not the convenient one.
    artworkRightsStatus: rightsStatusEnum('artwork_rights_status').notNull().default('UNKNOWN'),
    brandReferenceStatus: rightsStatusEnum('brand_reference_status').notNull().default('UNKNOWN'),
    licensingRequired: boolean('licensing_required'),
    licensingStatus: licensingStatusEnum('licensing_status').notNull().default('UNKNOWN'),
    advertisingRestrictions: jsonb('advertising_restrictions').notNull().default([]),
    reviewNotes: jsonb('review_notes').notNull().default([]),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fileHashIdx: uniqueIndex('artworks_file_hash_idx').on(table.fileHash),
  }),
);

export const producers = pgTable(
  'producers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable adapter key: 'printful', 'gelato'. */
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({ slugIdx: uniqueIndex('producers_slug_idx').on(table.slug) }),
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artworkId: uuid('artwork_id').notNull().references(() => artworks.id),
    /** Human-facing name. Never used as a key. */
    name: text('name').notNull(),
    /** Internal stable slug for SKU construction. */
    slug: text('slug').notNull(),
    status: productStatusEnum('status').notNull().default('DRAFT'),
    productType: text('product_type').notNull(),
    descriptionHtml: text('description_html'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    tags: jsonb('tags').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex('products_slug_idx').on(table.slug),
    artworkIdx: index('products_artwork_idx').on(table.artworkId),
  }),
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id').notNull().references(() => products.id),
    sku: text('sku').notNull(),
    size: text('size'),
    colour: text('colour'),
    priceMinor: integer('price_minor'),
    currency: currencyEnum('currency').notNull().default('GBP'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skuIdx: uniqueIndex('product_variants_sku_idx').on(table.sku),
    productIdx: index('product_variants_product_idx').on(table.productId),
  }),
);

export const producerProducts = pgTable(
  'producer_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id').notNull().references(() => products.id),
    producerId: uuid('producer_id').notNull().references(() => producers.id),
    /** The supplier's catalogue product ID. */
    producerProductId: text('producer_product_id').notNull(),
    /** The supplier's own created-product ID, once we create one. */
    producerSyncProductId: text('producer_sync_product_id'),
    manufacturerSku: text('manufacturer_sku'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mappingIdx: uniqueIndex('producer_products_mapping_idx').on(
      table.producerId,
      table.producerProductId,
      table.productId,
    ),
  }),
);

export const producerVariants = pgTable(
  'producer_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productVariantId: uuid('product_variant_id').notNull().references(() => productVariants.id),
    producerProductRowId: uuid('producer_product_row_id')
      .notNull()
      .references(() => producerProducts.id),
    producerVariantId: text('producer_variant_id').notNull(),
    producerSku: text('producer_sku'),
    availability: availabilityEnum('availability').notNull().default('UNKNOWN'),
    availabilityCheckedAt: timestamp('availability_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mappingIdx: uniqueIndex('producer_variants_mapping_idx').on(
      table.producerProductRowId,
      table.producerVariantId,
    ),
  }),
);

export const commerceProducts = pgTable(
  'commerce_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id').notNull().references(() => products.id),
    /** 'shopify'. Kept as a column so a second storefront does not need a migration. */
    platform: text('platform').notNull().default('shopify'),
    commerceProductId: text('commerce_product_id').notNull(),
    handle: text('handle'),
    adminUrl: text('admin_url'),
    status: text('status').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mappingIdx: uniqueIndex('commerce_products_mapping_idx').on(
      table.platform,
      table.commerceProductId,
    ),
    productIdx: index('commerce_products_product_idx').on(table.productId),
  }),
);

export const commerceVariants = pgTable(
  'commerce_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productVariantId: uuid('product_variant_id').notNull().references(() => productVariants.id),
    commerceProductRowId: uuid('commerce_product_row_id')
      .notNull()
      .references(() => commerceProducts.id),
    commerceVariantId: text('commerce_variant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mappingIdx: uniqueIndex('commerce_variants_mapping_idx').on(
      table.commerceProductRowId,
      table.commerceVariantId,
    ),
  }),
);

/**
 * Append-only record of every pricing run: the inputs, the raw supplier
 * response, and the derived KPIs. This is the evidence trail behind any
 * decision to scale or kill, and behind any supplier cost dispute.
 */
export const economicSnapshots = pgTable(
  'economic_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id').notNull().references(() => products.id),
    productVariantId: uuid('product_variant_id').references(() => productVariants.id),
    producerId: uuid('producer_id').notNull().references(() => producers.id),

    provenance: provenanceEnum('provenance').notNull(),
    quotedAt: timestamp('quoted_at', { withTimezone: true }).notNull(),
    currency: currencyEnum('currency').notNull(),

    // Inputs
    retailPriceMinor: integer('retail_price_minor').notNull(),
    shippingChargedMinor: integer('shipping_charged_minor').notNull(),
    garmentCostMinor: integer('garment_cost_minor'),
    printCostMinor: integer('print_cost_minor'),
    fulfilmentCostMinor: integer('fulfilment_cost_minor'),
    shippingCostMinor: integer('shipping_cost_minor'),
    adCostPerUnitMinor: integer('ad_cost_per_unit_minor'),

    // Commercial configuration in force at the time, so the number is reproducible.
    commercialConfig: jsonb('commercial_config').notNull(),

    // Derived
    vatMinor: integer('vat_minor'),
    netRevenueMinor: integer('net_revenue_minor'),
    paymentFeesMinor: integer('payment_fees_minor'),
    platformFeesMinor: integer('platform_fees_minor'),
    returnsAllowanceMinor: integer('returns_allowance_minor'),
    contributionBeforeAdsMinor: integer('contribution_before_ads_minor'),
    contributionAfterAdsMinor: integer('contribution_after_ads_minor'),
    grossMarginPct: text('gross_margin_pct'),
    contributionMarginPct: text('contribution_margin_pct'),
    breakEvenCpaMinor: integer('break_even_cpa_minor'),
    breakEvenRoas: text('break_even_roas'),
    targetCpaMinor: integer('target_cpa_minor'),
    targetRoas: text('target_roas'),

    /** UNKNOWN inputs, named. An empty array means the model was complete. */
    unknowns: jsonb('unknowns').notNull().default([]),
    warnings: jsonb('warnings').notNull().default([]),
    rawSupplierResponse: jsonb('raw_supplier_response'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    productIdx: index('economic_snapshots_product_idx').on(table.productId, table.createdAt),
  }),
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'cli:matthew', 'webhook:printful', 'system'. */
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    /** Outcome so a failed attempt is as visible as a successful one. */
    outcome: text('outcome').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    /** Redacted request/response pair for external calls. */
    externalRequest: jsonb('external_request'),
    externalResponse: jsonb('external_response'),
    /** Non-reversible fingerprint of the credential used. Never the credential. */
    credentialFingerprint: text('credential_fingerprint'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entityIdx: index('audit_log_entity_idx').on(table.entityType, table.entityId),
    createdIdx: index('audit_log_created_idx').on(table.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Meta asset isolation (milestone 3 — no Meta adapter exists yet)
//
// These tables exist so the approval mechanism is a schema-level fact rather
// than something remembered later. Enforcement is by ID, never by name:
// name_at_approval is stored for display and drift detection only.
// ---------------------------------------------------------------------------

export const metaIdentity = pgTable('meta_identity', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * App-scoped Meta user ID captured at first authorised setup. THIS is the
   * authorisation key — not the email address, which Meta does not reliably
   * expose and which is not a stable identifier.
   */
  approvedUserId: text('approved_user_id').notNull(),
  /** Human label shown during setup, e.g. the expected login email. */
  identityLabel: text('identity_label'),
  /** Fingerprint of the access token in use. Never the token itself. */
  tokenFingerprint: text('token_fingerprint'),
  grantedScopes: jsonb('granted_scopes').notNull().default([]),
  establishedAt: timestamp('established_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const metaAssetApprovals = pgTable(
  'meta_asset_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** BUSINESS | AD_ACCOUNT | PAGE | INSTAGRAM_ACCOUNT | PIXEL | DATASET */
    assetType: text('asset_type').notNull(),
    metaId: text('meta_id').notNull(),
    businessId: text('business_id'),
    /** Display only. A rename is surfaced as drift, never as authority. */
    nameAtApproval: text('name_at_approval'),
    accessRelationship: text('access_relationship'),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
    approvedBy: text('approved_by').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    assetIdx: uniqueIndex('meta_asset_approvals_asset_idx').on(table.assetType, table.metaId),
  }),
);

export const metaDeniedBusinesses = pgTable(
  'meta_denied_businesses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: text('business_id').notNull(),
    label: text('label'),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    businessIdx: uniqueIndex('meta_denied_businesses_idx').on(table.businessId),
  }),
);

/** Every identity/asset check performed before a spend-capable operation. */
export const metaSpendPreflightLog = pgTable('meta_spend_preflight_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  authenticatedUserId: text('authenticated_user_id'),
  businessId: text('business_id'),
  adAccountId: text('ad_account_id'),
  campaignId: text('campaign_id'),
  operation: text('operation').notNull(),
  passed: boolean('passed').notNull(),
  failureReason: text('failure_reason'),
  tokenFingerprint: text('token_fingerprint'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Campaign state machine, present so APPROVED is a stored fact from day one. */
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id),
  name: text('name').notNull(),
  state: campaignStateEnum('state').notNull().default('DRAFT'),
  /** Which approved ad account this campaign is bound to. */
  metaAdAccountId: text('meta_ad_account_id'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by'),
  dailyBudgetMinor: integer('daily_budget_minor'),
  currency: currencyEnum('currency').notNull().default('GBP'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
