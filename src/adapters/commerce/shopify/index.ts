/**
 * Shopify adapter — GraphQL Admin API.
 *
 * ⚠ UNVERIFIED AGAINST A LIVE SHOP. No Shopify credentials or shop domain were
 * available in this environment, so no mutation here has been executed. The
 * mutation documents are collected at the bottom of this file so correcting a
 * field name is a local edit.
 *
 * Uses the GraphQL Admin API because that is Shopify's current supported
 * architecture; the REST product endpoints are legacy.
 *
 * Products are created as DRAFT. There is no code path in this adapter that
 * sets a product ACTIVE — going live is a separate, deliberate act.
 */

import { HttpClient } from '../../http/client.ts';
import { logger } from '../../../observability/logger.ts';
import { fingerprint, registerSecret } from '../../../observability/redact.ts';
import { toMajorString, type Currency } from '../../../core/money.ts';
import type {
  CommerceImageDraft,
  CommercePort,
  CommerceProductDraft,
  CommerceProductRef,
} from '../../../ports/commerce.ts';

export interface ShopifyAdapterOptions {
  readonly shopDomain?: string;
  readonly accessToken?: string;
  readonly apiVersion: string;
  readonly currency: Currency;
}

interface GraphQlUserError {
  readonly field?: readonly string[] | null;
  readonly message: string;
}

export class ShopifyUserError extends Error {
  constructor(operation: string, errors: readonly GraphQlUserError[]) {
    super(
      `Shopify rejected ${operation}:\n` +
        errors.map((e) => `  ${(e.field ?? []).join('.') || '(general)'}: ${e.message}`).join('\n'),
    );
    this.name = 'ShopifyUserError';
  }
}

export class ShopifyAdapter implements CommercePort {
  readonly id = 'shopify' as const;
  readonly displayName = 'Shopify';
  readonly currency: Currency;
  readonly dryRun: boolean;

  private readonly client: HttpClient | null;
  private readonly tokenFingerprint: string | null;
  private readonly log = logger.child({ commerce: 'shopify' });

  private readonly options: ShopifyAdapterOptions;

  constructor(options: ShopifyAdapterOptions) {
    this.options = options;
    this.currency = options.currency;

    if (!options.shopDomain || !options.accessToken) {
      this.dryRun = true;
      this.client = null;
      this.tokenFingerprint = null;
      this.log.warn('running in DRY RUN: no Shopify credentials configured', {
        effect: 'product payloads are built and validated but nothing is created',
      });
      return;
    }

    registerSecret(options.accessToken);
    this.dryRun = false;
    this.tokenFingerprint = fingerprint(options.accessToken);
    this.client = new HttpClient({
      name: 'shopify',
      baseUrl: `https://${options.shopDomain}/admin/api/${options.apiVersion}`,
      defaultHeaders: { 'x-shopify-access-token': options.accessToken },
    });
  }

  get credentialFingerprint(): string | null {
    return this.tokenFingerprint;
  }

  async createDraftProduct(draft: CommerceProductDraft): Promise<CommerceProductRef> {
    if (draft.status !== 'DRAFT') {
      throw new Error(
        `Refusing to create a ${draft.status} product: milestone one publishes drafts only.`,
      );
    }

    const productInput = buildProductInput(draft);

    if (this.dryRun) {
      return this.simulate(draft, productInput);
    }

    const created = await this.graphql<{
      productCreate: {
        product: { id: string; handle: string } | null;
        userErrors: readonly GraphQlUserError[];
      };
    }>('productCreate', PRODUCT_CREATE, { product: productInput });

    if (created.productCreate.userErrors.length > 0) {
      throw new ShopifyUserError('productCreate', created.productCreate.userErrors);
    }
    const product = created.productCreate.product;
    if (!product) throw new Error('Shopify returned no product from productCreate.');

    const variants = await this.graphql<{
      productVariantsBulkCreate: {
        productVariants: readonly { id: string; sku: string | null }[];
        userErrors: readonly GraphQlUserError[];
      };
    }>('productVariantsBulkCreate', VARIANTS_BULK_CREATE, {
      productId: product.id,
      variants: draft.variants.map((variant) => ({
        price: toMajorString(variant.priceIncVat),
        inventoryItem: {
          sku: variant.sku,
          tracked: false,
          ...(variant.weightGrams === null
            ? {}
            : { measurement: { weight: { value: variant.weightGrams, unit: 'GRAMS' } } }),
        },
        inventoryPolicy: variant.inventoryPolicy,
        optionValues: Object.entries(variant.optionValues).map(([name, value]) => ({
          optionName: name,
          name: value,
        })),
        metafields: [
          {
            namespace: 'indie_archive',
            key: 'producer_variant_id',
            type: 'single_line_text_field',
            value: variant.producerVariantId,
          },
          {
            namespace: 'indie_archive',
            key: 'internal_variant_id',
            type: 'single_line_text_field',
            value: variant.internalVariantId,
          },
        ],
      })),
    });

    if (variants.productVariantsBulkCreate.userErrors.length > 0) {
      throw new ShopifyUserError(
        'productVariantsBulkCreate',
        variants.productVariantsBulkCreate.userErrors,
      );
    }

    await this.attachImages(product.id, draft.images);

    const created_variants = variants.productVariantsBulkCreate.productVariants;
    return {
      commerceProductId: product.id,
      handle: product.handle,
      adminUrl: this.adminUrl(product.id),
      status: 'DRAFT',
      variants: draft.variants.map((variant, index) => ({
        internalVariantId: variant.internalVariantId,
        commerceVariantId:
          created_variants.find((v) => v.sku === variant.sku)?.id ??
          created_variants[index]?.id ??
          '',
        sku: variant.sku,
      })),
    };
  }

  async updateProduct(
    commerceProductId: string,
    draft: CommerceProductDraft,
  ): Promise<CommerceProductRef> {
    if (this.dryRun) return this.simulate(draft, buildProductInput(draft));

    const updated = await this.graphql<{
      productUpdate: {
        product: { id: string; handle: string } | null;
        userErrors: readonly GraphQlUserError[];
      };
    }>('productUpdate', PRODUCT_UPDATE, {
      product: { id: commerceProductId, ...buildProductInput(draft) },
    });

    if (updated.productUpdate.userErrors.length > 0) {
      throw new ShopifyUserError('productUpdate', updated.productUpdate.userErrors);
    }

    return {
      commerceProductId,
      handle: updated.productUpdate.product?.handle ?? null,
      adminUrl: this.adminUrl(commerceProductId),
      status: draft.status,
      variants: [],
    };
  }

  async getProduct(commerceProductId: string): Promise<CommerceProductRef | null> {
    if (this.dryRun) return null;

    const result = await this.graphql<{
      product: { id: string; handle: string; status: string } | null;
    }>('product', PRODUCT_QUERY, { id: commerceProductId });

    if (!result.product) return null;
    return {
      commerceProductId: result.product.id,
      handle: result.product.handle,
      adminUrl: this.adminUrl(result.product.id),
      status: result.product.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
      variants: [],
    };
  }

  private async attachImages(
    productId: string,
    images: readonly CommerceImageDraft[],
  ): Promise<void> {
    if (images.length === 0) return;
    const result = await this.graphql<{
      productCreateMedia: { mediaUserErrors: readonly GraphQlUserError[] };
    }>('productCreateMedia', PRODUCT_CREATE_MEDIA, {
      productId,
      media: [...images]
        .sort((a, b) => a.position - b.position)
        .map((image) => ({
          originalSource: image.url,
          alt: image.altText,
          mediaContentType: 'IMAGE',
        })),
    });
    if (result.productCreateMedia.mediaUserErrors.length > 0) {
      throw new ShopifyUserError('productCreateMedia', result.productCreateMedia.mediaUserErrors);
    }
  }

  private async graphql<T>(
    operation: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    if (!this.client) throw new Error('Shopify client is not configured.');

    const response = await this.client.request({
      method: 'POST',
      url: '/graphql.json',
      body: { query, variables },
    });

    const body = response.body as {
      data?: T;
      errors?: readonly { message: string }[];
      extensions?: { cost?: { throttleStatus?: { currentlyAvailable?: number } } };
    };

    if (body.errors && body.errors.length > 0) {
      throw new Error(
        `Shopify GraphQL error on ${operation}: ${body.errors.map((e) => e.message).join('; ')}`,
      );
    }
    if (!body.data) throw new Error(`Shopify returned no data for ${operation}.`);

    const remaining = body.extensions?.cost?.throttleStatus?.currentlyAvailable;
    if (typeof remaining === 'number' && remaining < 200) {
      this.log.warn('approaching Shopify GraphQL cost limit', { remaining, operation });
    }

    return body.data;
  }

  private adminUrl(gid: string): string | null {
    if (!this.options.shopDomain) return null;
    const numeric = gid.split('/').pop();
    return numeric ? `https://${this.options.shopDomain}/admin/products/${numeric}` : null;
  }

  /**
   * DRY RUN result. IDs are deliberately prefixed so a simulated product can
   * never be mistaken for, or persisted as, a real Shopify product.
   */
  private simulate(
    draft: CommerceProductDraft,
    productInput: Record<string, unknown>,
  ): CommerceProductRef {
    this.log.info('DRY RUN: product payload built but not sent', {
      title: draft.title,
      variants: draft.variants.length,
      images: draft.images.length,
      payloadKeys: Object.keys(productInput),
    });
    return {
      commerceProductId: `dry-run:${draft.identifiers.internalProductId}`,
      handle: null,
      adminUrl: null,
      status: 'DRAFT',
      variants: draft.variants.map((variant) => ({
        internalVariantId: variant.internalVariantId,
        commerceVariantId: `dry-run:${variant.internalVariantId}`,
        sku: variant.sku,
      })),
    };
  }
}

function buildProductInput(draft: CommerceProductDraft): Record<string, unknown> {
  const optionNames = [
    ...new Set(draft.variants.flatMap((variant) => Object.keys(variant.optionValues))),
  ];

  return {
    title: draft.title,
    descriptionHtml: draft.descriptionHtml,
    productType: draft.productType,
    vendor: draft.vendor,
    tags: [...draft.tags],
    status: 'DRAFT',
    seo: { title: draft.seoTitle, description: draft.seoDescription },
    productOptions: optionNames.map((name) => ({
      name,
      values: [
        ...new Set(
          draft.variants
            .map((variant) => variant.optionValues[name])
            .filter((value): value is string => typeof value === 'string'),
        ),
      ].map((value) => ({ name: value })),
    })),
    metafields: [
      {
        namespace: 'indie_archive',
        key: 'internal_product_id',
        type: 'single_line_text_field',
        value: draft.identifiers.internalProductId,
      },
      {
        namespace: 'indie_archive',
        key: 'producer',
        type: 'single_line_text_field',
        value: draft.identifiers.producerId,
      },
      {
        namespace: 'indie_archive',
        key: 'producer_product_id',
        type: 'single_line_text_field',
        value: draft.identifiers.producerProductId,
      },
    ],
  };
}

// --- GraphQL documents -----------------------------------------------------

const PRODUCT_CREATE = `
  mutation CreateProduct($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product { id handle status }
      userErrors { field message }
    }
  }
`;

const PRODUCT_UPDATE = `
  mutation UpdateProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id handle status }
      userErrors { field message }
    }
  }
`;

const VARIANTS_BULK_CREATE = `
  mutation CreateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants { id sku }
      userErrors { field message }
    }
  }
`;

const PRODUCT_CREATE_MEDIA = `
  mutation CreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { alt status }
      mediaUserErrors { field message }
    }
  }
`;

const PRODUCT_QUERY = `
  query GetProduct($id: ID!) {
    product(id: $id) { id handle status }
  }
`;
