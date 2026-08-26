/**
 * The unit-economic model. Pure: no IO, no clock, no supplier knowledge.
 *
 * revenue
 *   - VAT
 *   - garment cost
 *   - printing cost
 *   - fulfilment
 *   - shipping
 *   - payment fees
 *   - platform fees
 *   - expected returns allowance
 *   = contribution before advertising
 *   - advertising cost
 *   = contribution after advertising          <-- the primary business KPI
 *
 * The returns allowance is modelled conservatively as a total loss of the
 * returned unit: the return rate multiplied by (net revenue + production cost
 * + outbound shipping). Resale of returned stock is NOT modelled, because
 * print-on-demand returns are rarely resaleable. If that changes, the
 * assumption is here, in one place, and documented.
 */

import {
  add,
  isNegative,
  percentOf,
  ratioPercent,
  subtract,
  sum,
  zero,
  type Money,
} from '../money.ts';
import type { EconomicsInputs, EconomicsResult, MaybeMoney } from './types.ts';

interface NamedCost {
  readonly name: string;
  readonly value: MaybeMoney;
}

export function calculateEconomics(inputs: EconomicsInputs): EconomicsResult {
  const { config } = inputs;
  const currency = config.currency;

  const required: readonly NamedCost[] = [
    { name: 'garmentCost', value: inputs.garmentCost },
    { name: 'printCost', value: inputs.printCost },
    { name: 'fulfilmentCost', value: inputs.fulfilmentCost },
    { name: 'shippingCostPaid', value: inputs.shippingCostPaid },
  ];

  const unknowns = required.filter((c) => c.value === null).map((c) => c.name);
  const mismatched = [
    inputs.retailPriceIncVat,
    inputs.shippingChargedIncVat,
    ...required.map((c) => c.value),
    inputs.adCostPerUnit,
  ]
    .filter((m): m is Money => m !== null)
    .filter((m) => m.currency !== currency);

  if (mismatched.length > 0) {
    throw new Error(
      `Economics inputs must all be in ${currency}; found ` +
        `${[...new Set(mismatched.map((m) => m.currency))].join(', ')}. ` +
        'Convert supplier costs explicitly before pricing.',
    );
  }

  if (unknowns.length > 0) {
    return { status: 'INCOMPLETE', currency, unknowns };
  }

  const garmentCost = inputs.garmentCost!;
  const printCost = inputs.printCost!;
  const fulfilmentCost = inputs.fulfilmentCost!;
  const shippingCostPaid = inputs.shippingCostPaid!;

  // --- Revenue -------------------------------------------------------------
  const grossRevenueIncVat = add(inputs.retailPriceIncVat, inputs.shippingChargedIncVat);

  // VAT is extracted from a VAT-inclusive price: gross * rate / (100 + rate).
  const vat = config.vatRegistered
    ? percentOf(grossRevenueIncVat, (config.vatRatePct / (100 + config.vatRatePct)) * 100)
    : zero(currency);

  const netRevenue = subtract(grossRevenueIncVat, vat);

  // --- Direct costs --------------------------------------------------------
  const productionCost = sum([garmentCost, printCost, fulfilmentCost], currency);

  // --- Deductions ----------------------------------------------------------
  // Payment and platform fees are charged on the gross (VAT-inclusive) amount
  // the customer actually pays, not on net revenue.
  const paymentFees = add(
    percentOf(grossRevenueIncVat, config.paymentFeePct),
    { minor: config.paymentFeeFixedMinor, currency },
  );
  const platformFees = percentOf(grossRevenueIncVat, config.platformFeePct);
  const returnsAllowance = percentOf(
    sum([netRevenue, productionCost, shippingCostPaid], currency),
    config.returnsAllowancePct,
  );

  const totalDeductions = sum(
    [productionCost, shippingCostPaid, paymentFees, platformFees, returnsAllowance],
    currency,
  );

  // --- The headline lines --------------------------------------------------
  const contributionBeforeAdvertising = subtract(netRevenue, totalDeductions);

  const adCostPerUnit = inputs.adCostPerUnit;
  const contributionAfterAdvertising =
    adCostPerUnit === null ? null : subtract(contributionBeforeAdvertising, adCostPerUnit);

  // --- Margins -------------------------------------------------------------
  const grossMarginPct = ratioPercent(subtract(netRevenue, productionCost), netRevenue);
  const contributionMarginPct = ratioPercent(contributionBeforeAdvertising, netRevenue);

  // --- Advertising thresholds ---------------------------------------------
  // Break-even CPA is exactly the contribution available before advertising:
  // spend a penny more to acquire the order and the unit loses money.
  const breakEvenCpa = contributionBeforeAdvertising;
  const breakEvenRoas =
    breakEvenCpa.minor > 0 ? grossRevenueIncVat.minor / breakEvenCpa.minor : null;

  const targetContributionAfterAds = percentOf(
    netRevenue,
    config.targetContributionAfterAdsPct,
  );
  const targetCpa = subtract(contributionBeforeAdvertising, targetContributionAfterAds);
  const targetRoas = targetCpa.minor > 0 ? grossRevenueIncVat.minor / targetCpa.minor : null;

  const actualRoas =
    adCostPerUnit !== null && adCostPerUnit.minor > 0
      ? grossRevenueIncVat.minor / adCostPerUnit.minor
      : null;

  // --- Warnings ------------------------------------------------------------
  const warnings: string[] = [];
  if (isNegative(contributionBeforeAdvertising)) {
    warnings.push(
      'Contribution before advertising is negative: this product loses money on ' +
        'every unit before a penny of ad spend. Raise price or change garment.',
    );
  }
  if (breakEvenRoas === null && !isNegative(contributionBeforeAdvertising)) {
    warnings.push('Break-even ROAS is undefined because contribution before advertising is zero.');
  }
  if (targetCpa.minor <= 0 && !isNegative(contributionBeforeAdvertising)) {
    warnings.push(
      `Target contribution of ${config.targetContributionAfterAdsPct}% of net revenue ` +
        'leaves no budget to acquire a customer. Target CPA is zero or negative, ' +
        'so this price cannot hit that target at any ad efficiency.',
    );
  }
  if (contributionAfterAdvertising !== null && isNegative(contributionAfterAdvertising)) {
    warnings.push(
      'Contribution after advertising is negative at the supplied ad cost: ' +
        'the current CPA exceeds break-even.',
    );
  }
  if (!config.vatRegistered) {
    warnings.push(
      'Not VAT registered: no VAT is deducted. Contribution will fall once ' +
        'registration is required, so re-price before crossing the threshold.',
    );
  }

  return {
    status: 'COMPLETE',
    currency,
    retailPriceIncVat: inputs.retailPriceIncVat,
    shippingChargedIncVat: inputs.shippingChargedIncVat,
    grossRevenueIncVat,
    vat,
    netRevenue,
    garmentCost,
    printCost,
    fulfilmentCost,
    productionCost,
    shippingCostPaid,
    paymentFees,
    platformFees,
    returnsAllowance,
    totalDeductions,
    contributionBeforeAdvertising,
    adCostPerUnit,
    contributionAfterAdvertising,
    grossMarginPct,
    contributionMarginPct,
    breakEvenCpa,
    breakEvenRoas,
    targetContributionAfterAds,
    targetCpa,
    targetRoas,
    actualRoas,
    warnings,
  };
}
