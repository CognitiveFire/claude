/**
 * Price a product from a live supplier quote.
 *
 * Fetches current costs, runs the economics engine, proposes a retail price,
 * and writes an immutable economic snapshot. Every figure it reports is derived
 * from the supplier response in that snapshot; nothing is assumed.
 */

import { audit } from '../observability/audit.ts';
import { auditCommercialConfig, proposeRetailPrice } from '../core/economics/pricing.ts';
import { calculateEconomics } from '../core/economics/engine.ts';
import { money, zero, type Money } from '../core/money.ts';
import type { EconomicsFigures } from '../core/economics/types.ts';
import type { DataProvenance } from '../ports/producer.ts';
import {
  getProduct,
  insertEconomicSnapshot,
  listVariantsWithProducer,
  setVariantPrices,
  updateProductStatus,
  upsertProducer,
} from '../db/repositories/index.ts';
import { commercial, producerFor, type Context } from './context.ts';

export interface PriceProductInput {
  readonly productId: string;
  readonly producer?: string;
  readonly placement: string;
  readonly destinationCountry: string;
  readonly destinationPostcode?: string;
  /** Charge to the customer for shipping, in minor units. Default 0 (free). */
  readonly shippingChargedMinor: number;
  /** Optional known CPA, in minor units, to compute contribution after ads. */
  readonly adCostPerUnitMinor: number | null;
  /** Price the product at this figure instead of solving for one. */
  readonly overridePriceMinor: number | null;
}

export interface PriceProductResult {
  readonly snapshotId: string;
  readonly provenance: DataProvenance;
  readonly quotedAt: Date;
  readonly configProblems: readonly string[];
  readonly outcome:
    | { readonly kind: 'PRICED'; readonly solvedPrice: Money | null; readonly figures: EconomicsFigures }
    | { readonly kind: 'UNKNOWN_COSTS'; readonly unknowns: readonly string[] }
    | { readonly kind: 'UNACHIEVABLE'; readonly reason: string };
}

export async function priceProduct(
  context: Context,
  input: PriceProductInput,
): Promise<PriceProductResult> {
  const config = commercial();
  const configProblems = auditCommercialConfig(config);

  const product = await getProduct(context.db, input.productId);
  if (!product) throw new Error(`Unknown product ${input.productId}.`);

  const variants = await listVariantsWithProducer(context.db, input.productId);
  const first = variants[0];
  if (!first) throw new Error(`Product ${input.productId} has no variants.`);

  const producer = producerFor(context.env, input.producer ?? first.producerSlug);
  const producerRowId = await upsertProducer(context.db, producer.id, producer.displayName);

  const quote = await producer.getCostQuote({
    producerVariantId: first.producerVariantId,
    placements: [input.placement],
    destinationCountry: input.destinationCountry,
    destinationPostcode: input.destinationPostcode,
    quantity: 1,
  });

  if (quote.data.currency !== config.currency) {
    throw new Error(
      `${producer.displayName} quoted in ${quote.data.currency} but the base currency is ` +
        `${config.currency}. A conversion rate must be recorded explicitly before ` +
        'these figures can be combined — the system will not apply an assumed rate.',
    );
  }

  const shippingCharged = money(input.shippingChargedMinor, config.currency);
  const adCost =
    input.adCostPerUnitMinor === null
      ? null
      : money(input.adCostPerUnitMinor, config.currency);

  const costInputs = {
    garmentCost: quote.data.productCost,
    printCost: quote.data.printCost,
    fulfilmentCost: quote.data.fulfilmentCost,
    shippingCostPaid: quote.data.shippingCost,
  };

  let outcome: PriceProductResult['outcome'];
  let figures: EconomicsFigures | null = null;
  let unknowns: readonly string[] = [];
  let solvedPrice: Money | null = null;
  let retailPrice: Money = zero(config.currency);

  if (input.overridePriceMinor !== null) {
    retailPrice = money(input.overridePriceMinor, config.currency);
    const result = calculateEconomics({
      retailPriceIncVat: retailPrice,
      shippingChargedIncVat: shippingCharged,
      ...costInputs,
      adCostPerUnit: adCost,
      config,
    });
    if (result.status === 'COMPLETE') {
      figures = result;
      outcome = { kind: 'PRICED', solvedPrice: null, figures: result };
    } else {
      unknowns = result.unknowns;
      outcome = { kind: 'UNKNOWN_COSTS', unknowns: result.unknowns };
    }
  } else {
    const proposal = proposeRetailPrice({
      ...costInputs,
      shippingChargedIncVat: shippingCharged,
      adCostPerUnit: adCost,
      config,
    });

    switch (proposal.status) {
      case 'PROPOSED':
        figures = proposal.economics;
        solvedPrice = proposal.solvedPriceIncVat;
        retailPrice = proposal.proposedPriceIncVat;
        outcome = { kind: 'PRICED', solvedPrice, figures: proposal.economics };
        break;
      case 'UNKNOWN_COSTS':
        unknowns = proposal.unknowns;
        outcome = { kind: 'UNKNOWN_COSTS', unknowns: proposal.unknowns };
        break;
      case 'UNACHIEVABLE':
        outcome = { kind: 'UNACHIEVABLE', reason: proposal.reason };
        break;
    }
  }

  const snapshotId = await insertEconomicSnapshot(context.db, {
    productId: input.productId,
    producerId: producerRowId,
    provenance: quote.provenance,
    quotedAt: quote.retrievedAt,
    config,
    figures,
    unknowns,
    retailPrice,
    shippingCharged,
    rawSupplierResponse: quote.raw,
  });

  if (figures) {
    await setVariantPrices(context.db, input.productId, figures.retailPriceIncVat);
    await updateProductStatus(context.db, input.productId, 'PRICED');
  }

  await audit({
    actor: context.actor,
    action: 'product.price',
    entityType: 'product',
    entityId: input.productId,
    outcome: figures ? 'SUCCESS' : 'BLOCKED',
    after: {
      snapshotId,
      provenance: quote.provenance,
      outcome: outcome.kind,
      retailPriceMinor: figures?.retailPriceIncVat.minor ?? null,
      contributionBeforeAdsMinor: figures?.contributionBeforeAdvertising.minor ?? null,
    },
    externalResponse: quote.raw,
  });

  return {
    snapshotId,
    provenance: quote.provenance,
    quotedAt: quote.retrievedAt,
    configProblems,
    outcome,
  };
}
