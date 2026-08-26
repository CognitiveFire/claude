/**
 * Retail price proposal.
 *
 * Solves for the VAT-inclusive retail price that hits the configured target
 * contribution margin BEFORE advertising, rounds it up to a real price point,
 * then re-runs the full economics at that rounded price and reports the ACTUAL
 * figures. The solved price is advisory; the reported economics are the truth.
 *
 * Derivation (all fractions, minor units):
 *   S  = shipping charged to customer      P = production cost
 *   H  = shipping cost we pay              F = fixed payment fee
 *   v  = VAT rate      r = return rate     pf/plf = payment/platform fee rates
 *   tb = target contribution margin before advertising
 *
 *   contribution = N(1-r) - (P+H)(1+r) - G(pf+plf) - F, with G = N(1+v)
 *   setting contribution = tb*N and solving for N:
 *
 *   N = [(P+H)(1+r) + F] / [(1-r) - (1+v)(pf+plf) - tb]
 *   G = N(1+v),  retail price = G - S
 *
 * A non-positive denominator means the fee and return structure consumes the
 * target margin at ANY price — a real commercial finding, reported as
 * UNACHIEVABLE rather than papered over with a bigger number.
 */

import { money, roundUpToPricePoint, sum, zero, type Money } from '../money.ts';
import type { CommercialConfig } from '../../config/env.ts';
import { calculateEconomics } from './engine.ts';
import type { EconomicsFigures, MaybeMoney } from './types.ts';

export interface PriceProposalInputs {
  readonly garmentCost: MaybeMoney;
  readonly printCost: MaybeMoney;
  readonly fulfilmentCost: MaybeMoney;
  readonly shippingCostPaid: MaybeMoney;
  readonly shippingChargedIncVat: Money;
  readonly adCostPerUnit: MaybeMoney;
  readonly config: CommercialConfig;
}

export type PriceProposal =
  | {
      readonly status: 'PROPOSED';
      /** Exact solved price before rounding, for transparency. */
      readonly solvedPriceIncVat: Money;
      /** The price we actually propose. */
      readonly proposedPriceIncVat: Money;
      readonly economics: EconomicsFigures;
    }
  | { readonly status: 'UNKNOWN_COSTS'; readonly unknowns: readonly string[] }
  | { readonly status: 'UNACHIEVABLE'; readonly reason: string };

export function proposeRetailPrice(inputs: PriceProposalInputs): PriceProposal {
  const { config } = inputs;
  const currency = config.currency;

  const unknowns = (
    [
      ['garmentCost', inputs.garmentCost],
      ['printCost', inputs.printCost],
      ['fulfilmentCost', inputs.fulfilmentCost],
      ['shippingCostPaid', inputs.shippingCostPaid],
    ] as const
  )
    .filter(([, value]) => value === null)
    .map(([name]) => name);

  if (unknowns.length > 0) {
    return { status: 'UNKNOWN_COSTS', unknowns };
  }

  const production = sum(
    [inputs.garmentCost!, inputs.printCost!, inputs.fulfilmentCost!],
    currency,
  );
  const P = production.minor;
  const H = inputs.shippingCostPaid!.minor;
  const S = inputs.shippingChargedIncVat.minor;
  const F = config.paymentFeeFixedMinor;

  const v = config.vatRatePct / 100;
  const r = config.returnsAllowancePct / 100;
  const pf = config.paymentFeePct / 100;
  const plf = config.platformFeePct / 100;
  const tb = config.targetContributionBeforeAdsPct / 100;

  const denominator = 1 - r - (1 + v) * (pf + plf) - tb;
  if (denominator <= 0) {
    return {
      status: 'UNACHIEVABLE',
      reason:
        `A ${config.targetContributionBeforeAdsPct}% target contribution margin is ` +
        `unreachable at any price: returns (${config.returnsAllowancePct}%), payment ` +
        `fees (${config.paymentFeePct}%) and platform fees (${config.platformFeePct}%) ` +
        'already consume the available margin. Lower the target or the cost base.',
    };
  }

  const netRevenue = ((P + H) * (1 + r) + F) / denominator;
  const grossRevenue = netRevenue * (1 + v);
  const solvedMinor = Math.ceil(grossRevenue - S);

  if (solvedMinor <= 0) {
    return {
      status: 'UNACHIEVABLE',
      reason:
        'The solved retail price is zero or negative, which means shipping charged ' +
        'to the customer already exceeds the required revenue. Reduce the shipping ' +
        'charge or re-check the supplier costs.',
    };
  }

  const solvedPriceIncVat = money(solvedMinor, currency);
  const proposedPriceIncVat = roundUpToPricePoint(
    solvedPriceIncVat,
    config.priceRoundingStepMinor,
    config.priceRoundingEndingMinor,
  );

  const economics = calculateEconomics({
    retailPriceIncVat: proposedPriceIncVat,
    shippingChargedIncVat: inputs.shippingChargedIncVat,
    garmentCost: inputs.garmentCost,
    printCost: inputs.printCost,
    fulfilmentCost: inputs.fulfilmentCost,
    shippingCostPaid: inputs.shippingCostPaid,
    adCostPerUnit: inputs.adCostPerUnit,
    config,
  });

  if (economics.status !== 'COMPLETE') {
    // Unreachable: we checked every cost above. Fail loudly rather than
    // returning a proposal with no economics behind it.
    throw new Error(
      `Economics went INCOMPLETE after cost validation: ${economics.unknowns.join(', ')}`,
    );
  }

  return { status: 'PROPOSED', solvedPriceIncVat, proposedPriceIncVat, economics };
}

/**
 * Sanity-check the commercial configuration itself. Returns human-readable
 * problems rather than throwing, so the CLI can show all of them at once.
 */
export function auditCommercialConfig(config: CommercialConfig): readonly string[] {
  const problems: string[] = [];
  if (config.targetContributionAfterAdsPct >= config.targetContributionBeforeAdsPct) {
    problems.push(
      `TARGET_CONTRIBUTION_AFTER_ADS_PCT (${config.targetContributionAfterAdsPct}%) must be ` +
        `below TARGET_CONTRIBUTION_BEFORE_ADS_PCT (${config.targetContributionBeforeAdsPct}%), ` +
        'otherwise no budget remains to acquire a customer.',
    );
  }
  if (config.returnsAllowancePct >= 50) {
    problems.push(
      `RETURNS_ALLOWANCE_PCT of ${config.returnsAllowancePct}% is implausibly high — ` +
        'check whether this was entered as a fraction rather than a percentage.',
    );
  }
  if (config.paymentFeePct >= 20) {
    problems.push(
      `PAYMENT_FEE_PCT of ${config.paymentFeePct}% is implausibly high for card ` +
        'processing — check the units.',
    );
  }
  return problems;
}

/** Convenience for callers that price at a fixed shipping charge of zero. */
export function freeShipping(config: CommercialConfig): Money {
  return zero(config.currency);
}
