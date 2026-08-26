import type { Currency, Money } from '../money.ts';
import type { CommercialConfig } from '../../config/env.ts';

/**
 * A cost line that may not be known.
 *
 * `null` means UNKNOWN — the supplier did not return it, or we have not asked.
 * It never means zero. A zero garment cost and an unknown garment cost produce
 * very different decisions, and conflating them is how a product gets
 * published below cost.
 */
export type MaybeMoney = Money | null;

export interface EconomicsInputs {
  /** What the customer pays for the product, VAT inclusive (UK convention). */
  readonly retailPriceIncVat: Money;
  /** Shipping charged to the customer, VAT inclusive. Zero for free shipping. */
  readonly shippingChargedIncVat: Money;
  /** Blank garment cost from the producer. */
  readonly garmentCost: MaybeMoney;
  /** Printing/decoration cost from the producer. */
  readonly printCost: MaybeMoney;
  /** Producer's per-order fulfilment/handling fee. */
  readonly fulfilmentCost: MaybeMoney;
  /** What WE pay the producer to ship to the customer. */
  readonly shippingCostPaid: MaybeMoney;
  /** Known or assumed advertising cost per unit sold (CPA). */
  readonly adCostPerUnit: MaybeMoney;
  readonly config: CommercialConfig;
}

export interface EconomicsFigures {
  readonly currency: Currency;

  // Revenue
  readonly retailPriceIncVat: Money;
  readonly shippingChargedIncVat: Money;
  readonly grossRevenueIncVat: Money;
  readonly vat: Money;
  readonly netRevenue: Money;

  // Direct costs
  readonly garmentCost: Money;
  readonly printCost: Money;
  readonly fulfilmentCost: Money;
  readonly productionCost: Money;
  readonly shippingCostPaid: Money;

  // Deductions
  readonly paymentFees: Money;
  readonly platformFees: Money;
  readonly returnsAllowance: Money;
  readonly totalDeductions: Money;

  // The two headline lines
  readonly contributionBeforeAdvertising: Money;
  readonly adCostPerUnit: MaybeMoney;
  readonly contributionAfterAdvertising: MaybeMoney;

  // Margins. Null where the denominator is zero, never a misleading 0.
  readonly grossMarginPct: number | null;
  readonly contributionMarginPct: number | null;

  // Advertising thresholds
  readonly breakEvenCpa: Money;
  readonly breakEvenRoas: number | null;
  readonly targetContributionAfterAds: Money;
  readonly targetCpa: Money;
  readonly targetRoas: number | null;

  /** Achieved ROAS at the supplied ad cost, if one was given. */
  readonly actualRoas: number | null;

  /** Non-fatal but decision-relevant observations. */
  readonly warnings: readonly string[];
}

export type EconomicsResult =
  | ({ readonly status: 'COMPLETE' } & EconomicsFigures)
  | {
      readonly status: 'INCOMPLETE';
      readonly currency: Currency;
      /** Names of the inputs that were UNKNOWN. */
      readonly unknowns: readonly string[];
    };
