/**
 * CommercePort — the storefront abstraction (Shopify today).
 *
 * Kept separate from ProducerPort so the store and the supplier can change
 * independently. Shopify is the source of truth for customer orders; it is
 * never the source of truth for product identity, which is ours.
 */

import type { Currency, Money } from '../core/money.ts';

export interface CommerceProductDraft {
  readonly title: string;
  readonly descriptionHtml: string;
  readonly productType: string;
  readonly vendor: string;
  readonly tags: readonly string[];
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly status: 'DRAFT' | 'ACTIVE';
  readonly variants: readonly CommerceVariantDraft[];
  readonly images: readonly CommerceImageDraft[];
  /**
   * Identifier mapping written to metafields. Names are display data; these
   * IDs are how the two systems actually find each other.
   */
  readonly identifiers: {
    readonly internalProductId: string;
    readonly producerId: string;
    readonly producerProductId: string;
  };
}

export interface CommerceVariantDraft {
  readonly internalVariantId: string;
  readonly sku: string;
  readonly priceIncVat: Money;
  readonly optionValues: Readonly<Record<string, string>>;
  readonly producerVariantId: string;
  readonly weightGrams: number | null;
  readonly inventoryPolicy: 'CONTINUE' | 'DENY';
}

export interface CommerceImageDraft {
  readonly url: string;
  readonly altText: string;
  readonly position: number;
}

export interface CommerceProductRef {
  readonly commerceProductId: string;
  readonly handle: string | null;
  readonly adminUrl: string | null;
  readonly status: 'DRAFT' | 'ACTIVE';
  readonly variants: readonly {
    readonly internalVariantId: string;
    readonly commerceVariantId: string;
    readonly sku: string;
  }[];
}

export interface CommercePort {
  readonly id: 'shopify';
  readonly displayName: string;
  readonly currency: Currency;
  /** True when no live credentials are configured and calls would be simulated. */
  readonly dryRun: boolean;

  createDraftProduct(draft: CommerceProductDraft): Promise<CommerceProductRef>;
  updateProduct(
    commerceProductId: string,
    draft: CommerceProductDraft,
  ): Promise<CommerceProductRef>;
  getProduct(commerceProductId: string): Promise<CommerceProductRef | null>;
}
