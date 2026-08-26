import { describe, expect, it } from 'vitest';
import { calculateEconomics } from '../src/core/economics/engine.ts';
import { money, zero } from '../src/core/money.ts';
import { testConfig } from './helpers.ts';

const GBP = (minor: number) => money(minor, 'GBP');

/**
 * Worked example, hand-checked:
 *   retail £45.00, free shipping, garment £9.00, print £5.00, fulfilment £0,
 *   shipping paid £4.50; VAT 20%, payment 1.5% + 20p, platform 0%, returns 3%.
 *
 *   gross              4500
 *   VAT (4500 * 20/120) 750
 *   net                3750
 *   production         1400
 *   payment (68 + 20)    88
 *   returns 3% of 5600  168
 *   deductions         2106  (1400 + 450 + 88 + 0 + 168)
 *   contribution        1644
 */
function baseInputs(overrides: Partial<Parameters<typeof calculateEconomics>[0]> = {}) {
  return {
    retailPriceIncVat: GBP(4500),
    shippingChargedIncVat: zero('GBP'),
    garmentCost: GBP(900),
    printCost: GBP(500),
    fulfilmentCost: GBP(0),
    shippingCostPaid: GBP(450),
    adCostPerUnit: null,
    config: testConfig(),
    ...overrides,
  };
}

describe('calculateEconomics — worked example', () => {
  const result = calculateEconomics(baseInputs());
  if (result.status !== 'COMPLETE') throw new Error('expected COMPLETE');

  it('extracts VAT from a VAT-inclusive price', () => {
    expect(result.grossRevenueIncVat).toEqual(GBP(4500));
    expect(result.vat).toEqual(GBP(750));
    expect(result.netRevenue).toEqual(GBP(3750));
  });

  it('sums production cost from garment, print and fulfilment', () => {
    expect(result.productionCost).toEqual(GBP(1400));
  });

  it('charges payment fees on gross revenue plus the fixed fee', () => {
    expect(result.paymentFees).toEqual(GBP(88));
    expect(result.platformFees).toEqual(zero('GBP'));
  });

  it('applies the returns allowance to net revenue plus production and shipping', () => {
    expect(result.returnsAllowance).toEqual(GBP(168));
  });

  it('reaches contribution before advertising', () => {
    expect(result.totalDeductions).toEqual(GBP(2106));
    expect(result.contributionBeforeAdvertising).toEqual(GBP(1644));
  });

  it('computes gross and contribution margin against net revenue', () => {
    expect(result.grossMarginPct).toBeCloseTo(62.667, 3);
    expect(result.contributionMarginPct).toBeCloseTo(43.84, 2);
  });

  it('sets break-even CPA at the contribution available before advertising', () => {
    expect(result.breakEvenCpa).toEqual(GBP(1644));
    expect(result.breakEvenRoas).toBeCloseTo(2.7372, 4);
  });

  it('derives target CPA and ROAS from the target contribution', () => {
    expect(result.targetContributionAfterAds).toEqual(GBP(750));
    expect(result.targetCpa).toEqual(GBP(894));
    expect(result.targetRoas).toBeCloseTo(5.0336, 4);
  });

  it('leaves contribution after advertising unknown when no ad cost is supplied', () => {
    expect(result.adCostPerUnit).toBeNull();
    expect(result.contributionAfterAdvertising).toBeNull();
    expect(result.actualRoas).toBeNull();
  });
});

describe('contribution after advertising', () => {
  it('subtracts a known ad cost and reports achieved ROAS', () => {
    const result = calculateEconomics(baseInputs({ adCostPerUnit: GBP(900) }));
    if (result.status !== 'COMPLETE') throw new Error('expected COMPLETE');
    expect(result.contributionAfterAdvertising).toEqual(GBP(744));
    expect(result.actualRoas).toBeCloseTo(5, 4);
    expect(result.warnings.join(' ')).not.toContain('after advertising is negative');
  });

  it('warns when CPA exceeds break-even', () => {
    const result = calculateEconomics(baseInputs({ adCostPerUnit: GBP(2000) }));
    if (result.status !== 'COMPLETE') throw new Error('expected COMPLETE');
    expect(result.contributionAfterAdvertising).toEqual(GBP(-356));
    expect(result.warnings.join(' ')).toContain('after advertising is negative');
  });
});

describe('UNKNOWN propagation', () => {
  it('returns INCOMPLETE naming every missing cost instead of assuming zero', () => {
    const result = calculateEconomics(
      baseInputs({ garmentCost: null, shippingCostPaid: null }),
    );
    expect(result.status).toBe('INCOMPLETE');
    if (result.status !== 'INCOMPLETE') throw new Error('expected INCOMPLETE');
    expect(result.unknowns).toEqual(['garmentCost', 'shippingCostPaid']);
  });

  it('treats a zero cost as a real value, not as unknown', () => {
    const result = calculateEconomics(baseInputs({ fulfilmentCost: GBP(0) }));
    expect(result.status).toBe('COMPLETE');
  });

  it('refuses to mix currencies rather than producing a plausible wrong number', () => {
    expect(() =>
      calculateEconomics(baseInputs({ garmentCost: money(900, 'EUR') })),
    ).toThrow(/must all be in GBP/);
  });
});

describe('VAT registration', () => {
  it('deducts no VAT when not registered', () => {
    const result = calculateEconomics(
      baseInputs({ config: testConfig({ vatRegistered: false, vatRatePct: 0 }) }),
    );
    if (result.status !== 'COMPLETE') throw new Error('expected COMPLETE');
    expect(result.vat).toEqual(zero('GBP'));
    expect(result.netRevenue).toEqual(GBP(4500));
    expect(result.warnings.join(' ')).toContain('Not VAT registered');
  });

  it('materially changes contribution — registration is not a cosmetic setting', () => {
    const registered = calculateEconomics(baseInputs());
    const unregistered = calculateEconomics(
      baseInputs({ config: testConfig({ vatRegistered: false, vatRatePct: 0 }) }),
    );
    if (registered.status !== 'COMPLETE' || unregistered.status !== 'COMPLETE') {
      throw new Error('expected COMPLETE');
    }
    const delta =
      unregistered.contributionBeforeAdvertising.minor -
      registered.contributionBeforeAdvertising.minor;
    expect(delta).toBeGreaterThan(700);
  });
});

describe('loss-making products', () => {
  it('warns loudly when contribution before advertising is negative', () => {
    const result = calculateEconomics(baseInputs({ retailPriceIncVat: GBP(1500) }));
    if (result.status !== 'COMPLETE') throw new Error('expected COMPLETE');
    expect(result.contributionBeforeAdvertising.minor).toBeLessThan(0);
    expect(result.breakEvenRoas).toBeNull();
    expect(result.warnings.join(' ')).toContain('loses money on every unit');
  });

  it('reports target ROAS as undefined when no acquisition budget remains', () => {
    const result = calculateEconomics(baseInputs({ retailPriceIncVat: GBP(3000) }));
    if (result.status !== 'COMPLETE') throw new Error('expected COMPLETE');
    expect(result.targetCpa.minor).toBeLessThanOrEqual(0);
    expect(result.targetRoas).toBeNull();
    expect(result.warnings.join(' ')).toContain('leaves no budget to acquire a customer');
  });
});

describe('shipping charged to the customer', () => {
  it('counts as revenue and is included in the VAT and fee base', () => {
    const free = calculateEconomics(baseInputs());
    const charged = calculateEconomics(
      baseInputs({ shippingChargedIncVat: GBP(495) }),
    );
    if (free.status !== 'COMPLETE' || charged.status !== 'COMPLETE') {
      throw new Error('expected COMPLETE');
    }
    expect(charged.grossRevenueIncVat).toEqual(GBP(4995));
    expect(charged.contributionBeforeAdvertising.minor).toBeGreaterThan(
      free.contributionBeforeAdvertising.minor,
    );
  });
});
