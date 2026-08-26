/**
 * Environment configuration, parsed once and validated at the edge.
 *
 * Split deliberately into two loaders:
 *
 *  - `loadEnv()`         infrastructure and credentials. Optional fields stay
 *                        optional so `ia artwork:add` runs on a bare checkout.
 *  - `loadCommercial()`  the commercial numbers. These have NO defaults, and a
 *                        missing one is a hard error naming exactly what to
 *                        supply. A guessed VAT rate or payment fee misstates
 *                        contribution per unit by double digits, so the system
 *                        refuses to price rather than assume.
 */

import { z } from 'zod';
import { CURRENCIES, type Currency } from '../core/money.ts';

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const percent = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative number')
  .transform(Number)
  .refine((v) => v <= 100, 'must be <= 100');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1).optional(),

  DEFAULT_PRODUCER: z.enum(['printful', 'gelato']).default('printful'),
  PRINTFUL_API_TOKEN: z.string().min(1).optional(),
  PRINTFUL_STORE_ID: z.string().min(1).optional(),
  GELATO_API_KEY: z.string().min(1).optional(),
  PRODUCER_USE_FIXTURES: boolish.default('true'),
  COST_QUOTE_TTL_MINUTES: z.coerce.number().int().positive().default(1440),

  SHOPIFY_SHOP_DOMAIN: z.string().min(1).optional(),
  SHOPIFY_ADMIN_ACCESS_TOKEN: z.string().min(1).optional(),
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-\d{2}$/).default('2025-01'),
  SHOPIFY_WEBHOOK_SECRET: z.string().min(1).optional(),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-5'),

  BASE_CURRENCY: z.enum(CURRENCIES as [Currency, ...Currency[]]).default('GBP'),

  // Meta: milestone 3. There is no Meta adapter in this codebase yet, and this
  // flag must be false until one exists and its asset approvals are pinned.
  META_WRITE_ENABLED: boolish.default('false'),
  META_EXPECTED_IDENTITY_LABEL: z.string().optional(),
  META_APPROVED_USER_ID: z.string().optional(),
  META_APPROVED_BUSINESS_ID: z.string().optional(),
  META_APPROVED_AD_ACCOUNT_ID: z.string().optional(),
  META_APPROVED_PAGE_ID: z.string().optional(),
  META_APPROVED_INSTAGRAM_ACCOUNT_ID: z.string().optional(),
  META_APPROVED_PIXEL_ID: z.string().optional(),
  META_APPROVED_DATASET_ID: z.string().optional(),
  META_DENIED_BUSINESS_IDS: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;

  // Blank strings in a .env file are absence, not a value.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() !== '') cleaned[key] = value.trim();
  }

  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${issues}`);
  }

  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Test-only: drop the memoised env so a test can vary it. */
export function resetEnvCache(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Commercial configuration
// ---------------------------------------------------------------------------

const commercialSchema = z.object({
  VAT_REGISTERED: boolish,
  VAT_RATE_PCT: percent.default('20'),
  PAYMENT_FEE_PCT: percent,
  PAYMENT_FEE_FIXED_MINOR: z.coerce.number().int().nonnegative(),
  PLATFORM_FEE_PCT: percent.default('0'),
  RETURNS_ALLOWANCE_PCT: percent,
  TARGET_CONTRIBUTION_BEFORE_ADS_PCT: percent,
  TARGET_CONTRIBUTION_AFTER_ADS_PCT: percent,
  PRICE_ROUNDING_STEP_MINOR: z.coerce.number().int().positive().default(100),
  PRICE_ROUNDING_ENDING_MINOR: z.coerce.number().int().nonnegative().default(0),
});

export interface CommercialConfig {
  readonly currency: Currency;
  readonly vatRegistered: boolean;
  /** Zero when not VAT registered — there is no VAT to remit. */
  readonly vatRatePct: number;
  readonly paymentFeePct: number;
  readonly paymentFeeFixedMinor: number;
  readonly platformFeePct: number;
  readonly returnsAllowancePct: number;
  /** Drives the proposed retail price. */
  readonly targetContributionBeforeAdsPct: number;
  /** Drives target CPA and target ROAS. */
  readonly targetContributionAfterAdsPct: number;
  readonly priceRoundingStepMinor: number;
  readonly priceRoundingEndingMinor: number;
}

const REQUIRED_COMMERCIAL: readonly string[] = [
  'VAT_REGISTERED',
  'PAYMENT_FEE_PCT',
  'PAYMENT_FEE_FIXED_MINOR',
  'RETURNS_ALLOWANCE_PCT',
  'TARGET_CONTRIBUTION_BEFORE_ADS_PCT',
  'TARGET_CONTRIBUTION_AFTER_ADS_PCT',
];

export function loadCommercial(source: NodeJS.ProcessEnv = process.env): CommercialConfig {
  const env = loadEnv(source);

  const missing = REQUIRED_COMMERCIAL.filter((key) => {
    const value = source[key];
    return typeof value !== 'string' || value.trim() === '';
  });
  if (missing.length > 0) {
    throw new ConfigError(
      'Commercial configuration is incomplete. These are your numbers and the ' +
        'system will not guess them, because a guessed fee or VAT rate ' +
        'misstates contribution per unit:\n' +
        missing.map((k) => `  ${k}`).join('\n') +
        '\nSee .env.example for what each one means.',
    );
  }

  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() !== '') cleaned[key] = value.trim();
  }

  const parsed = commercialSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid commercial configuration:\n${issues}`);
  }
  const c = parsed.data;

  if (c.PRICE_ROUNDING_ENDING_MINOR >= c.PRICE_ROUNDING_STEP_MINOR) {
    throw new ConfigError(
      `PRICE_ROUNDING_ENDING_MINOR (${c.PRICE_ROUNDING_ENDING_MINOR}) must be ` +
        `less than PRICE_ROUNDING_STEP_MINOR (${c.PRICE_ROUNDING_STEP_MINOR}).`,
    );
  }

  return {
    currency: env.BASE_CURRENCY,
    vatRegistered: c.VAT_REGISTERED,
    vatRatePct: c.VAT_REGISTERED ? c.VAT_RATE_PCT : 0,
    paymentFeePct: c.PAYMENT_FEE_PCT,
    paymentFeeFixedMinor: c.PAYMENT_FEE_FIXED_MINOR,
    platformFeePct: c.PLATFORM_FEE_PCT,
    returnsAllowancePct: c.RETURNS_ALLOWANCE_PCT,
    targetContributionBeforeAdsPct: c.TARGET_CONTRIBUTION_BEFORE_ADS_PCT,
    targetContributionAfterAdsPct: c.TARGET_CONTRIBUTION_AFTER_ADS_PCT,
    priceRoundingStepMinor: c.PRICE_ROUNDING_STEP_MINOR,
    priceRoundingEndingMinor: c.PRICE_ROUNDING_ENDING_MINOR,
  };
}
