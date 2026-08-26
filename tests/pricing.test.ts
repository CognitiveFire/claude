import { describe, expect, it } from 'vitest';
import {
  auditCommercialConfig,
  proposeRetailPrice,
} from '../src/core/economics/pricing.ts';
import { money, zero } from '../src/core/money.ts';
import { testConfig } from './helpers.ts';

const GBP = (minor: number) => money(minor, 'GBP');

function baseInputs(overrides: Partial<Parameters<typeof proposeRetailPrice>[0]> = {}) {
  return {
    garmentCost: GBP(900),
    printCost: GBP(500),
    fulfilmentCost: GBP(0),
    shippingCostPaid: GBP(450),
    shippingChargedIncVat: zero('GBP'),
    adCostPerUnit: null,
    config: testConfig(),
    ...overrides,
  };
}

describe('proposeRetailPrice', () => {
  it('solves for the target margin and rounds up to a real price point', () => {
    const proposal = proposeRetailPrice(baseInputs());
    if (proposal.status !== 'PROPOSED') throw new Error(`expected PROPOSED, got ${proposal.status}`);

    // Solved exactly: ((1400 + 450) * 1.03 + 20) / 0.502 * 1.2 = 4602.8 -> 4603
    expect(proposal.solvedPriceIncVat).toEqual(GBP(4603));
    expect(proposal.proposedPriceIncVat).toEqual(GBP(4700));
  });

  it('reports the ACTUAL economics at the rounded price, not the target', () => {
    const proposal = proposeRetailPrice(baseInputs());
    if (proposal.status !== 'PROPOSED') throw new Error('expected PROPOSED');
    const e = proposal.economics;

    expect(e.retailPriceIncVat).toEqual(GBP(4700));
    expect(e.netRevenue).toEqual(GBP(3917));
    expect(e.contributionBeforeAdvertising).toEqual(GBP(1803));
    expect(e.contributionMarginPct).not.toBeNull();
    expect(e.contributionMarginPct!).toBeGreaterThanOrEqual(45);
  });

  it('hits or beats the target margin across a range of cost bases', () => {
    for (const garment of [500, 900, 1400, 2200, 3500]) {
      for (const ship of [0, 250, 450, 900]) {
        const proposal = proposeRetailPrice(
          baseInputs({ garmentCost: GBP(garment), shippingCostPaid: GBP(ship) }),
        );
        if (proposal.status !== 'PROPOSED') throw new Error('expected PROPOSED');
        expect(proposal.economics.contributionMarginPct!).toBeGreaterThanOrEqual(45);
      }
    }
  });

  it('refuses to propose a price when a supplier cost is unknown', () => {
    const proposal = proposeRetailPrice(baseInputs({ printCost: null }));
    expect(proposal.status).toBe('UNKNOWN_COSTS');
    if (proposal.status !== 'UNKNOWN_COSTS') throw new Error('expected UNKNOWN_COSTS');
    expect(proposal.unknowns).toEqual(['printCost']);
  });

  it('reports UNACHIEVABLE when fees and returns consume the target margin', () => {
    const proposal = proposeRetailPrice(
      baseInputs({
        config: testConfig({
          targetContributionBeforeAdsPct: 90,
          returnsAllowancePct: 10,
          paymentFeePct: 2,
        }),
      }),
    );
    expect(proposal.status).toBe('UNACHIEVABLE');
    if (proposal.status !== 'UNACHIEVABLE') throw new Error('expected UNACHIEVABLE');
    expect(proposal.reason).toContain('unreachable at any price');
  });

  it('passes a known ad cost through to contribution after advertising', () => {
    const proposal = proposeRetailPrice(baseInputs({ adCostPerUnit: GBP(1000) }));
    if (proposal.status !== 'PROPOSED') throw new Error('expected PROPOSED');
    expect(proposal.economics.contributionAfterAdvertising).toEqual(GBP(803));
  });
});

describe('auditCommercialConfig', () => {
  it('accepts a coherent configuration', () => {
    expect(auditCommercialConfig(testConfig())).toEqual([]);
  });

  it('rejects an after-ads target that leaves no acquisition budget', () => {
    const problems = auditCommercialConfig(
      testConfig({ targetContributionBeforeAdsPct: 20, targetContributionAfterAdsPct: 20 }),
    );
    expect(problems.join(' ')).toContain('must be below');
  });

  it('flags percentages that look like fractions', () => {
    const problems = auditCommercialConfig(testConfig({ returnsAllowancePct: 60 }));
    expect(problems.join(' ')).toContain('implausibly high');
  });
});
