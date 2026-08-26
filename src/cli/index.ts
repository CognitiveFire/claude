#!/usr/bin/env node
/**
 * Indie Archive CLI.
 *
 * No dashboard. Milestone one is one artwork and one product, and a CLI is the
 * smallest interface that can prove the commercial model.
 */

import { readFile } from 'node:fs/promises';
import { format, money, toMajorString } from '../core/money.ts';
import { ConfigError, loadCommercial, loadEnv } from '../config/env.ts';
import { auditCommercialConfig } from '../core/economics/pricing.ts';
import { scanForProtectedReferences } from '../core/rights.ts';
import { createAllProducers } from '../adapters/producer/registry.ts';
import { closeDatabase, getDatabase, schema } from '../db/client.ts';
import {
  getArtwork,
  listArtworks,
  listProducts,
  listVariantsWithProducer,
} from '../db/repositories/index.ts';
import { createContext } from '../services/context.ts';
import { onboardArtwork } from '../services/onboardArtwork.ts';
import { proposeProduct } from '../services/proposeProduct.ts';
import { priceProduct } from '../services/priceProduct.ts';
import { generateCopy } from '../services/generateCopy.ts';
import { PublishBlockedError, publishProduct } from '../services/publishProduct.ts';
import { eq } from 'drizzle-orm';
import {
  list,
  optionalInt,
  optionalString,
  parseArgs,
  requireString,
  type ParsedArgs,
} from './args.ts';
import { renderEconomics, wrap } from './report.ts';

const HELP = `
Indie Archive — artwork to fulfilled merchandise.

  ia config:check                    Validate environment and commercial config
  ia artwork:add                     Register an artwork file
      --file <path> --title <text> [--artist <name>] [--phrase <text>]
  ia artwork:list                    List registered artworks
  ia rights:set                      Record a rights decision (human judgement)
      --artwork <id> [--artwork-rights cleared|blocked|review]
      [--brand-reference cleared|blocked|review] [--licensing required|not-required]
      [--licensing-status obtained|required-not-obtained]
  ia product:propose                 Match a garment and map variants
      --artwork <id> --name <text> --slug <text> [--producer printful|gelato]
      [--sku STTU169] [--sizes S,M,L,XL] [--colour Black] [--placement front]
  ia product:price                   Quote costs and propose a retail price
      --product <id> [--producer <id>] [--country GB] [--postcode <code>]
      [--shipping-charged <pence>] [--cpa <pence>] [--price <pence>]
  ia product:copy                    Generate or load product copy
      --product <id> [--garment <text>] [--artwork-notes <text>]
      [--phrase <text>] [--allow <phrase,phrase>] [--from-file <path>]
  ia product:publish                 Create the Shopify DRAFT product
      --product <id> --print-file-url <url> [--vendor <name>] [--placement front]
  ia product:list                     List products and their status
  ia product:show                     Show a product, variants and latest economics
      --product <id>
  ia producer:compare                Compare suppliers through one interface
      [--sku STTU169] [--country GB]
  ia rights:scan                     Check text for protected references
      --text "<text>" [--allow <phrase,phrase>]
  ia meta:status                     Meta isolation and write-guard state
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'config:check':
      return configCheck();
    case 'artwork:add':
      return artworkAdd(args);
    case 'artwork:list':
      return artworkList();
    case 'rights:set':
      return rightsSet(args);
    case 'rights:scan':
      return rightsScan(args);
    case 'product:propose':
      return productPropose(args);
    case 'product:price':
      return productPrice(args);
    case 'product:copy':
      return productCopy(args);
    case 'product:publish':
      return productPublish(args);
    case 'product:list':
      return productList();
    case 'product:show':
      return productShow(args);
    case 'producer:compare':
      return producerCompare(args);
    case 'meta:status':
      return metaStatus();
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(`${HELP}\n`);
      return;
    default:
      process.stdout.write(`Unknown command "${args.command}".\n${HELP}\n`);
      process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------

function configCheck(): void {
  const env = loadEnv();
  out('Environment');
  out(`  node env                 ${env.NODE_ENV}`);
  out(`  base currency            ${env.BASE_CURRENCY}`);
  out(`  default producer         ${env.DEFAULT_PRODUCER}`);
  out(`  producer mode            ${env.PRODUCER_USE_FIXTURES ? 'FIXTURES (cannot publish)' : 'LIVE API'}`);
  out(`  quote TTL                ${env.COST_QUOTE_TTL_MINUTES} minutes`);
  out(`  database                 ${env.DATABASE_URL ? 'configured' : 'NOT SET'}`);
  out(`  printful token           ${env.PRINTFUL_API_TOKEN ? 'configured' : 'NOT SET'}`);
  out(`  gelato key               ${env.GELATO_API_KEY ? 'configured' : 'NOT SET'}`);
  out(`  shopify                  ${env.SHOPIFY_SHOP_DOMAIN ? env.SHOPIFY_SHOP_DOMAIN : 'NOT SET (dry run)'}`);
  out(`  anthropic key            ${env.ANTHROPIC_API_KEY ? 'configured' : 'NOT SET'}`);
  out(`  meta writes              ${env.META_WRITE_ENABLED ? 'ENABLED' : 'disabled'}`);
  out('');

  try {
    const config = loadCommercial();
    out('Commercial configuration');
    out(`  VAT registered           ${config.vatRegistered ? `yes (${config.vatRatePct}%)` : 'no'}`);
    out(`  payment fee              ${config.paymentFeePct}% + ${config.paymentFeeFixedMinor}p`);
    out(`  platform fee             ${config.platformFeePct}%`);
    out(`  returns allowance        ${config.returnsAllowancePct}%`);
    out(`  target margin (pre-ads)  ${config.targetContributionBeforeAdsPct}%`);
    out(`  target margin (post-ads) ${config.targetContributionAfterAdsPct}%`);
    const problems = auditCommercialConfig(config);
    if (problems.length > 0) {
      out('');
      out('Problems');
      for (const problem of problems) out(`  ! ${wrap(problem, 72, 4)}`);
      process.exitCode = 1;
    } else {
      out('');
      out('  Configuration is coherent.');
    }
  } catch (error) {
    out('Commercial configuration');
    out(`  ${error instanceof ConfigError ? error.message.split('\n').join('\n  ') : String(error)}`);
    process.exitCode = 1;
  }
}

async function artworkAdd(args: ParsedArgs): Promise<void> {
  const context = createContext(actor());
  const result = await onboardArtwork(context, {
    filePath: requireString(args, 'file'),
    title: requireString(args, 'title'),
    artist: optionalString(args, 'artist') ?? null,
    designPhrase: optionalString(args, 'phrase') ?? null,
  });

  out(`Artwork registered: ${result.artworkId}`);
  out(`  ${result.metadata.widthPx}x${result.metadata.heightPx}px ${result.metadata.format}`);
  out(`  colour space             ${result.metadata.colourSpace ?? 'UNKNOWN'}`);
  out(`  alpha channel            ${result.metadata.hasAlpha === null ? 'UNKNOWN' : result.metadata.hasAlpha}`);
  out(`  declared DPI             ${result.metadata.declaredDpi ?? 'UNKNOWN'}`);
  out(`  sha256                   ${result.metadata.sha256.slice(0, 16)}...`);

  if (result.referenceFlags.length > 0) {
    out('');
    out('  RIGHTS REVIEW REQUIRED — potentially protected references detected:');
    for (const flagged of result.referenceFlags) {
      out(`    ${flagged.category}: "${flagged.matched}"`);
      out(`      ${wrap(flagged.note, 68, 6)}`);
    }
    out('');
    out('  This is a flag for human judgement, not a legal opinion. Publication is');
    out('  blocked until you record a decision with `ia rights:set`.');
  }
}

async function artworkList(): Promise<void> {
  const rows = await listArtworks(getDatabase());
  if (rows.length === 0) return out('No artworks registered.');
  for (const row of rows) {
    out(`${row.id}  ${row.title}`);
    out(`    rights: artwork=${row.artworkRightsStatus} brand=${row.brandReferenceStatus} licensing=${row.licensingStatus}`);
  }
}

async function rightsSet(args: ParsedArgs): Promise<void> {
  const db = getDatabase();
  const artworkId = requireString(args, 'artwork');
  const artwork = await getArtwork(db, artworkId);
  if (!artwork) throw new Error(`Unknown artwork ${artworkId}.`);

  const statusMap = {
    cleared: 'CLEARED',
    blocked: 'BLOCKED',
    review: 'REVIEW_REQUIRED',
    unknown: 'UNKNOWN',
  } as const;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const artworkRights = optionalString(args, 'artwork-rights');
  if (artworkRights) {
    const mapped = statusMap[artworkRights.toLowerCase() as keyof typeof statusMap];
    if (!mapped) throw new Error(`--artwork-rights must be one of ${Object.keys(statusMap).join(', ')}.`);
    updates['artworkRightsStatus'] = mapped;
  }
  const brandReference = optionalString(args, 'brand-reference');
  if (brandReference) {
    const mapped = statusMap[brandReference.toLowerCase() as keyof typeof statusMap];
    if (!mapped) throw new Error(`--brand-reference must be one of ${Object.keys(statusMap).join(', ')}.`);
    updates['brandReferenceStatus'] = mapped;
  }
  const licensing = optionalString(args, 'licensing');
  if (licensing) {
    if (licensing === 'required') {
      updates['licensingRequired'] = true;
    } else if (licensing === 'not-required') {
      updates['licensingRequired'] = false;
      updates['licensingStatus'] = 'NOT_REQUIRED';
    } else {
      throw new Error('--licensing must be "required" or "not-required".');
    }
  }
  const licensingStatus = optionalString(args, 'licensing-status');
  if (licensingStatus === 'obtained') updates['licensingStatus'] = 'OBTAINED';
  else if (licensingStatus === 'required-not-obtained') updates['licensingStatus'] = 'REQUIRED_NOT_OBTAINED';
  else if (licensingStatus) throw new Error('--licensing-status must be "obtained" or "required-not-obtained".');

  if (Object.keys(updates).length === 1) {
    throw new Error('Nothing to set. Supply at least one rights flag.');
  }

  await db.update(schema.artworks).set(updates).where(eq(schema.artworks.id, artworkId));

  const { audit } = await import('../observability/audit.ts');
  await audit({
    actor: actor(),
    action: 'rights.set',
    entityType: 'artwork',
    entityId: artworkId,
    outcome: 'SUCCESS',
    before: {
      artworkRightsStatus: artwork.artworkRightsStatus,
      brandReferenceStatus: artwork.brandReferenceStatus,
      licensingRequired: artwork.licensingRequired,
      licensingStatus: artwork.licensingStatus,
    },
    after: updates,
  });

  out(`Rights updated on ${artworkId}. This decision is recorded in audit_log.`);
}

function rightsScan(args: ParsedArgs): void {
  const text = requireString(args, 'text');
  const allowed = list(args, 'allow', []);
  const flags = scanForProtectedReferences([text], { allowedPhrases: allowed });
  if (flags.length === 0) return out('No protected references detected.');
  for (const flagged of flags) {
    out(`${flagged.category}: "${flagged.matched}"`);
    out(`  context: ${flagged.context}`);
    out(`  ${wrap(flagged.note, 70, 2)}`);
  }
  process.exitCode = 1;
}

async function productPropose(args: ParsedArgs): Promise<void> {
  const context = createContext(actor());
  const result = await proposeProduct(context, {
    artworkId: requireString(args, 'artwork'),
    producer: optionalString(args, 'producer'),
    name: requireString(args, 'name'),
    slug: requireString(args, 'slug'),
    manufacturerSku: optionalString(args, 'sku') ?? 'STTU169',
    placement: optionalString(args, 'placement') ?? 'front',
    sizes: list(args, 'sizes', ['S', 'M', 'L', 'XL']),
    colour: optionalString(args, 'colour') ?? null,
  });

  out(`Product proposed: ${result.productId}`);
  out(`  producer                 ${result.producerId} (${result.provenance})`);
  out(`  catalogue match          ${result.catalogueName}`);
  out(`  producer product id      ${result.producerProductId}`);
  out(`  variants mapped          ${result.variantCount}`);
  if (result.skippedSizes.length > 0) {
    out(`  sizes not offered        ${result.skippedSizes.join(', ')}`);
  }
  out('');
  out(`  print file               ${result.printFile.acceptable ? 'ACCEPTABLE' : 'REJECTED'}`);
  out(`  effective DPI            ${result.printFile.effectiveDpi?.toFixed(0) ?? 'UNKNOWN'}`);
  for (const error of result.printFile.errors) out(`    ERROR   ${wrap(error, 66, 12)}`);
  for (const warning of result.printFile.warnings) out(`    warning ${wrap(warning, 66, 12)}`);
}

async function productPrice(args: ParsedArgs): Promise<void> {
  const context = createContext(actor());
  const result = await priceProduct(context, {
    productId: requireString(args, 'product'),
    producer: optionalString(args, 'producer'),
    placement: optionalString(args, 'placement') ?? 'front',
    destinationCountry: optionalString(args, 'country') ?? 'GB',
    destinationPostcode: optionalString(args, 'postcode'),
    shippingChargedMinor: optionalInt(args, 'shipping-charged') ?? 0,
    adCostPerUnitMinor: optionalInt(args, 'cpa'),
    overridePriceMinor: optionalInt(args, 'price'),
  });

  out(`Snapshot ${result.snapshotId}`);
  out(`  cost provenance          ${result.provenance}${result.provenance === 'FIXTURE' ? '  <-- cannot be published' : ''}`);
  out(`  quoted at                ${result.quotedAt.toISOString()}`);
  out('');

  for (const problem of result.configProblems) out(`  ! ${wrap(problem, 72, 4)}`);

  switch (result.outcome.kind) {
    case 'PRICED':
      if (result.outcome.solvedPrice) {
        out(`  solved price             ${format(result.outcome.solvedPrice)} (before rounding)`);
        out('');
      }
      out(renderEconomics(result.outcome.figures));
      break;
    case 'UNKNOWN_COSTS':
      out('  Cannot price: the supplier did not return these cost lines, and the');
      out('  system will not substitute a guess.');
      for (const unknown of result.outcome.unknowns) out(`    UNKNOWN  ${unknown}`);
      process.exitCode = 1;
      break;
    case 'UNACHIEVABLE':
      out(`  ${wrap(result.outcome.reason, 72, 2)}`);
      process.exitCode = 1;
      break;
  }
}

async function productCopy(args: ParsedArgs): Promise<void> {
  const context = createContext(actor());
  const fromFilePath = optionalString(args, 'from-file');
  const fromFile = fromFilePath
    ? (JSON.parse(await readFile(fromFilePath, 'utf8')) as never)
    : undefined;

  const copy = await generateCopy(context, {
    productId: requireString(args, 'product'),
    garmentDescription:
      optionalString(args, 'garment') ?? 'Heavyweight organic cotton unisex t-shirt.',
    artworkDescription: optionalString(args, 'artwork-notes') ?? 'Original painting.',
    designPhrase: optionalString(args, 'phrase') ?? null,
    allowedPhrases: list(args, 'allow', []),
    ...(fromFile ? { fromFile } : {}),
  });

  out(`Title:  ${copy.title}`);
  out(`SEO:    ${copy.seoTitle}`);
  out(`Meta:   ${copy.seoDescription}`);
  out(`Tags:   ${copy.tags.join(', ')}`);
  out('');
  out(copy.descriptionHtml);
}

async function productPublish(args: ParsedArgs): Promise<void> {
  const context = createContext(actor());
  try {
    const result = await publishProduct(context, {
      productId: requireString(args, 'product'),
      placement: optionalString(args, 'placement') ?? 'front',
      printFileUrl: requireString(args, 'print-file-url'),
      vendor: optionalString(args, 'vendor') ?? 'Indie Archive',
    });
    out(result.dryRun ? 'DRY RUN — nothing was created on Shopify.' : 'Shopify DRAFT created.');
    out(`  commerce product id      ${result.commerce.commerceProductId}`);
    out(`  admin url                ${result.commerce.adminUrl ?? 'n/a'}`);
    out(`  variants                 ${result.commerce.variants.length}`);
    out(`  images                   ${result.mockupUrls.length}`);
    out('');
    out('  Status is DRAFT. Nothing is live.');
  } catch (error) {
    if (!(error instanceof PublishBlockedError)) throw error;
    out('PUBLICATION BLOCKED');
    for (const blocker of error.blockers) out(`  - ${wrap(blocker, 70, 4)}`);
    process.exitCode = 1;
  }
}

async function productList(): Promise<void> {
  const rows = await listProducts(getDatabase());
  if (rows.length === 0) return out('No products.');
  for (const row of rows) {
    out(`${row.id}  ${row.status.padEnd(16)} ${row.name}`);
  }
}

async function productShow(args: ParsedArgs): Promise<void> {
  const db = getDatabase();
  const productId = requireString(args, 'product');
  const { getProduct, latestSnapshot } = await import('../db/repositories/index.ts');
  const product = await getProduct(db, productId);
  if (!product) throw new Error(`Unknown product ${productId}.`);

  out(`${product.name}`);
  out(`  id                       ${product.id}`);
  out(`  status                   ${product.status}`);
  out(`  seo title                ${product.seoTitle ?? 'not set'}`);
  out('');

  const variants = await listVariantsWithProducer(db, productId);
  out('  Variants');
  for (const variant of variants) {
    const price =
      variant.priceMinor === null
        ? 'unpriced'
        : format(money(variant.priceMinor, variant.currency));
    out(
      `    ${variant.sku.padEnd(28)} ${(variant.size ?? '').padEnd(4)} ` +
        `${price.padStart(9)}  ${variant.producerSlug}:${variant.producerVariantId} ` +
        `[${variant.availability}]`,
    );
  }

  const snapshot = await latestSnapshot(db, productId);
  if (!snapshot) return out('\n  No economic snapshot yet.');
  out('');
  out('  Latest economics');
  out(`    provenance             ${snapshot.provenance}`);
  out(`    quoted at              ${snapshot.quotedAt.toISOString()}`);
  out(`    retail                 ${format(money(snapshot.retailPriceMinor, snapshot.currency))}`);
  out(
    `    contribution pre-ads   ${
      snapshot.contributionBeforeAdsMinor === null
        ? 'UNKNOWN'
        : format(money(snapshot.contributionBeforeAdsMinor, snapshot.currency))
    }`,
  );
  out(`    contribution margin    ${snapshot.contributionMarginPct ?? 'UNKNOWN'}%`);
  out(
    `    break-even CPA         ${
      snapshot.breakEvenCpaMinor === null
        ? 'UNKNOWN'
        : format(money(snapshot.breakEvenCpaMinor, snapshot.currency))
    }`,
  );
  const unknowns = (snapshot.unknowns as string[]) ?? [];
  if (unknowns.length > 0) out(`    UNKNOWN inputs         ${unknowns.join(', ')}`);
}

async function producerCompare(args: ParsedArgs): Promise<void> {
  const env = loadEnv();
  const sku = optionalString(args, 'sku') ?? 'STTU169';
  const country = optionalString(args, 'country') ?? 'GB';
  const producers = createAllProducers(env);

  out(`Supplier comparison for ${sku} into ${country}`);
  out('');
  out(
    `  ${'supplier'.padEnd(10)}${'garment'.padStart(9)}${'print'.padStart(9)}` +
      `${'fulfil'.padStart(9)}${'ship'.padStart(9)}${'landed'.padStart(9)}` +
      `${'days'.padStart(8)}${'  source'}`,
  );

  for (const producer of producers) {
    try {
      const search = await producer.searchCatalogue({ manufacturerSku: sku, limit: 5 });
      const candidate = search.data[0];
      if (!candidate) {
        out(`  ${producer.id.padEnd(10)}  no catalogue match — availability UNKNOWN, not absent`);
        continue;
      }
      const variants = await producer.getVariants(candidate.producerProductId);
      const variant = variants.data[0];
      if (!variant) {
        out(`  ${producer.id.padEnd(10)}  no variants returned`);
        continue;
      }
      const quote = await producer.getCostQuote({
        producerVariantId: variant.producerVariantId,
        placements: ['front'],
        destinationCountry: country,
        quantity: 1,
      });
      const q = quote.data;
      const parts = [q.productCost, q.printCost, q.fulfilmentCost, q.shippingCost];
      const landed = parts.every((p) => p !== null)
        ? format(money(parts.reduce((sum, p) => sum + p!.minor, 0), q.currency))
        : 'UNKNOWN';
      const days = q.expectedFulfilment
        ? `${q.expectedFulfilment.minBusinessDays}-${q.expectedFulfilment.maxBusinessDays}`
        : 'UNKNOWN';

      out(
        `  ${producer.id.padEnd(10)}` +
          `${cell(q.productCost)}${cell(q.printCost)}${cell(q.fulfilmentCost)}` +
          `${cell(q.shippingCost)}${landed.padStart(9)}${days.padStart(8)}  ${quote.provenance}`,
      );
    } catch (error) {
      out(`  ${producer.id.padEnd(10)}  FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  out('');
  out('  Landed cost is only one of twelve criteria. Print quality, UK fulfilment,');
  out('  API reliability, webhooks and returns terms are not in this table and are');
  out('  not yet known. The cheapest supplier is not automatically the best one.');
  if (env.PRODUCER_USE_FIXTURES) {
    out('');
    out('  ! PRODUCER_USE_FIXTURES=true — every figure above is a placeholder, not a');
    out('    supplier price. Set it to false with credentials for a real comparison.');
  }
}

function cell(value: { minor: number; currency: 'GBP' | 'EUR' | 'USD' } | null): string {
  return (value === null ? 'UNKNOWN' : toMajorString(value)).padStart(9);
}

function metaStatus(): void {
  const env = loadEnv();
  out('Meta isolation status');
  out('');
  out(`  write operations         ${env.META_WRITE_ENABLED ? 'ENABLED' : 'DISABLED (default)'}`);
  out('  adapter present          NO — no Meta adapter exists in this codebase.');
  out('                           No code path can reach Meta, so no code path can');
  out('                           spend money. This is milestone 3.');
  out('');
  out(`  expected identity        ${env.META_EXPECTED_IDENTITY_LABEL ?? 'not set'}`);
  out('                           (a human label for setup only — the runtime pin is');
  out('                           the app-scoped user ID, not the email address)');
  out(`  approved user id         ${env.META_APPROVED_USER_ID ?? 'not established'}`);
  out(`  approved business        ${env.META_APPROVED_BUSINESS_ID ?? 'not established'}`);
  out(`  approved ad account      ${env.META_APPROVED_AD_ACCOUNT_ID ?? 'not established'}`);
  out(`  approved page            ${env.META_APPROVED_PAGE_ID ?? 'not established'}`);
  out(`  approved instagram       ${env.META_APPROVED_INSTAGRAM_ACCOUNT_ID ?? 'not established'}`);
  out(`  approved pixel           ${env.META_APPROVED_PIXEL_ID ?? 'not established'}`);
  out(`  approved dataset         ${env.META_APPROVED_DATASET_ID ?? 'not established'}`);
  const denied = (env.META_DENIED_BUSINESS_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  out(`  denied business ids      ${denied.length > 0 ? denied.join(', ') : 'none recorded'}`);
  out('');
  out('  Enforcement is by ID, never by name: a renamed asset still trips the');
  out('  denylist, and an asset that is merely accessible is never usable.');
  out('  See docs/meta-isolation.md.');
}

// ---------------------------------------------------------------------------

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function actor(): string {
  return `cli:${process.env['USER'] ?? 'unknown'}`;
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nError: ${message}\n\n`);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => undefined);
}
