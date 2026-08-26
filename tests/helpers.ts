import type { CommercialConfig } from '../src/config/env.ts';

/** A complete commercial config for tests. Values are illustrative only. */
export function testConfig(overrides: Partial<CommercialConfig> = {}): CommercialConfig {
  return {
    currency: 'GBP',
    vatRegistered: true,
    vatRatePct: 20,
    paymentFeePct: 1.5,
    paymentFeeFixedMinor: 20,
    platformFeePct: 0,
    returnsAllowancePct: 3,
    targetContributionBeforeAdsPct: 45,
    targetContributionAfterAdsPct: 20,
    priceRoundingStepMinor: 100,
    priceRoundingEndingMinor: 0,
    ...overrides,
  };
}
