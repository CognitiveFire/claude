/**
 * Printful adapter.
 *
 * ⚠ ENDPOINT PATHS AND FIELD MAPPINGS ARE UNVERIFIED AGAINST THE LIVE API.
 *
 * This session's network policy blocks api.printful.com (the proxy returns 403
 * to CONNECT), so no request in this file has been executed against Printful.
 * Every path and every response field name is therefore a stated assumption,
 * deliberately collected in ENDPOINTS and in the map* functions below so that
 * correcting them is a small, local edit rather than a rewrite.
 *
 * Nothing here fabricates commercial data: absent fields become null and
 * surface as UNKNOWN. Verify against the live API before trusting any figure —
 * see docs/architecture.md, "Verification status".
 */

import { HttpClient } from '../../http/client.ts';
import { logger } from '../../../observability/logger.ts';
import { registerSecret } from '../../../observability/redact.ts';
import {
  DEFAULT_PRINT_FILE_POLICY,
  validatePrintFile as validateLocally,
} from '../../../core/printfile.ts';
import type { Currency } from '../../../core/money.ts';
import type {
  Availability,
  CatalogueProduct,
  CatalogueSearchQuery,
  CatalogueVariant,
  CostQuoteRequest,
  ParsedWebhook,
  PrintAreaSpec,
  PrintFileValidationRequest,
  PrintFileValidationResult,
  ProducerCostQuote,
  ProducerId,
  ProducerOrder,
  ProducerOrderRequest,
  ProducerOrderStatus,
  ProducerPort,
  ProducerProductDraft,
  ProducerProductRef,
  ProducerResponse,
  RawWebhook,
  ShipmentStatus,
} from '../../../ports/producer.ts';
import {
  asArray,
  asNumber,
  asString,
  availabilityFromSupplier,
  envelope,
  moneyFromSupplier,
  pick,
} from '../base.ts';
import { FixtureTransport, HttpTransport, type RawTransport } from '../transport.ts';
import { verifyHmacWebhook } from '../webhook.ts';

/** Single place to correct paths once they are verified against the live API. */
const ENDPOINTS = {
  base: 'https://api.printful.com',
  catalogueSearch: '/v2/catalog-products',
  catalogueProduct: (id: string) => `/v2/catalog-products/${id}`,
  catalogueVariants: (id: string) => `/v2/catalog-products/${id}/catalog-variants`,
  printAreas: (id: string) => `/v2/catalog-products/${id}/prices`,
  variantAvailability: (id: string) => `/v2/catalog-variants/${id}/availability`,
  costEstimate: '/v2/order-estimation-tasks',
  products: '/v2/store/products',
  product: (id: string) => `/v2/store/products/${id}`,
  orders: '/v2/orders',
  order: (id: string) => `/v2/orders/${id}`,
  shipments: (id: string) => `/v2/orders/${id}/shipments`,
} as const;

export interface PrintfulAdapterOptions {
  readonly apiToken?: string;
  readonly storeId?: string;
  readonly currency: Currency;
  readonly useFixtures: boolean;
  readonly webhookSecret?: string;
  readonly fixtureDirectory?: string;
}

export class PrintfulAdapter implements ProducerPort {
  readonly id: ProducerId = 'printful';
  readonly displayName = 'Printful';
  readonly usingFixtures: boolean;

  private readonly transport: RawTransport;
  private readonly currency: Currency;
  private readonly webhookSecret: string | undefined;
  private readonly log = logger.child({ producer: 'printful' });

  constructor(options: PrintfulAdapterOptions) {
    this.currency = options.currency;
    this.webhookSecret = options.webhookSecret;

    if (options.useFixtures) {
      this.usingFixtures = true;
      this.transport = new FixtureTransport('printful', options.fixtureDirectory);
      return;
    }

    if (!options.apiToken) {
      throw new Error(
        'PRINTFUL_API_TOKEN is required when PRODUCER_USE_FIXTURES=false. ' +
          'Set the token, or run against fixtures.',
      );
    }
    registerSecret(options.apiToken);

    const headers: Record<string, string> = {
      authorization: `Bearer ${options.apiToken}`,
    };
    if (options.storeId) headers['x-pf-store-id'] = options.storeId;

    this.usingFixtures = false;
    this.transport = new HttpTransport(
      new HttpClient({ name: 'printful', baseUrl: ENDPOINTS.base, defaultHeaders: headers }),
    );
  }

  // --- Catalogue ----------------------------------------------------------

  async searchCatalogue(
    query: CatalogueSearchQuery,
  ): Promise<ProducerResponse<readonly CatalogueProduct[]>> {
    const params = new URLSearchParams();
    if (query.text) params.set('query', query.text);
    if (query.limit) params.set('limit', String(query.limit));
    const url = params.size > 0
      ? `${ENDPOINTS.catalogueSearch}?${params.toString()}`
      : ENDPOINTS.catalogueSearch;

    const raw = await this.transport.call('catalogue-search', { method: 'GET', url });
    let products = asArray(pick(raw, 'data')).map((item) => mapCatalogueProduct(item));

    // Supplier-side filtering cannot be assumed, so narrow locally too.
    if (query.manufacturerSku) {
      const wanted = query.manufacturerSku.toLowerCase();
      products = products.filter(
        (p) =>
          p.manufacturerSku?.toLowerCase().includes(wanted) ||
          p.model?.toLowerCase().includes(wanted) ||
          p.name.toLowerCase().includes(wanted),
      );
    }
    return envelope(this.id, this.transport.provenance, raw, products);
  }

  async getProduct(producerProductId: string): Promise<ProducerResponse<CatalogueProduct>> {
    const raw = await this.transport.call('catalogue-product', {
      method: 'GET',
      url: ENDPOINTS.catalogueProduct(producerProductId),
    });
    return envelope(this.id, this.transport.provenance, raw, mapCatalogueProduct(pick(raw, 'data')));
  }

  async getVariants(
    producerProductId: string,
  ): Promise<ProducerResponse<readonly CatalogueVariant[]>> {
    const raw = await this.transport.call('catalogue-variants', {
      method: 'GET',
      url: ENDPOINTS.catalogueVariants(producerProductId),
    });
    const variants = asArray(pick(raw, 'data')).map((item) =>
      mapCatalogueVariant(item, producerProductId),
    );
    return envelope(this.id, this.transport.provenance, raw, variants);
  }

  async getPrintAreas(
    producerProductId: string,
  ): Promise<ProducerResponse<readonly PrintAreaSpec[]>> {
    const raw = await this.transport.call('print-areas', {
      method: 'GET',
      url: ENDPOINTS.printAreas(producerProductId),
    });
    const areas = asArray(pick(raw, 'data')).map((item) => mapPrintArea(item));
    return envelope(this.id, this.transport.provenance, raw, areas);
  }

  // --- Pricing ------------------------------------------------------------

  async getCostQuote(
    request: CostQuoteRequest,
  ): Promise<ProducerResponse<ProducerCostQuote>> {
    const raw = await this.transport.call('cost-quote', {
      method: 'POST',
      url: ENDPOINTS.costEstimate,
      body: {
        recipient: { country_code: request.destinationCountry, zip: request.destinationPostcode },
        order_items: [
          {
            catalog_variant_id: request.producerVariantId,
            quantity: request.quantity,
            placements: request.placements.map((placement) => ({ placement })),
          },
        ],
      },
    });

    const costs = pick(raw, 'data', 'costs') ?? pick(raw, 'costs');
    const currency =
      (asString(pick(costs, 'currency')) as Currency | null) ?? this.currency;

    const quote: ProducerCostQuote = {
      producerVariantId: request.producerVariantId,
      currency,
      productCost: moneyFromSupplier(pick(costs, 'product'), currency),
      printCost: moneyFromSupplier(pick(costs, 'printing'), currency),
      fulfilmentCost: moneyFromSupplier(pick(costs, 'fulfillment'), currency),
      shippingCost: moneyFromSupplier(pick(costs, 'shipping'), currency),
      availability: availabilityFromSupplier(pick(raw, 'data', 'availability')),
      expectedFulfilment: mapFulfilmentWindow(pick(raw, 'data', 'fulfillment')),
      fulfilmentCountry: asString(pick(raw, 'data', 'fulfillment', 'country_code')),
    };

    if (quote.productCost === null || quote.shippingCost === null) {
      this.log.warn('supplier quote is missing cost lines; they stay UNKNOWN', {
        variant: request.producerVariantId,
        missing: [
          quote.productCost === null ? 'productCost' : null,
          quote.printCost === null ? 'printCost' : null,
          quote.fulfilmentCost === null ? 'fulfilmentCost' : null,
          quote.shippingCost === null ? 'shippingCost' : null,
        ].filter(Boolean),
      });
    }

    return envelope(this.id, this.transport.provenance, raw, quote);
  }

  async getAvailability(producerVariantId: string): Promise<ProducerResponse<Availability>> {
    const raw = await this.transport.call('availability', {
      method: 'GET',
      url: ENDPOINTS.variantAvailability(producerVariantId),
    });
    const status = availabilityFromSupplier(
      pick(raw, 'data', 'status') ?? pick(raw, 'data', 'availability'),
    );
    return envelope(this.id, this.transport.provenance, raw, status);
  }

  // --- Print files --------------------------------------------------------

  /**
   * Printful publishes no "validate this file" endpoint, so validation is done
   * locally against the supplier's own print-area specification. Pretending to
   * call a validation API would be worse than doing the arithmetic honestly.
   */
  async validatePrintFile(
    request: PrintFileValidationRequest,
  ): Promise<ProducerResponse<PrintFileValidationResult>> {
    const areas = await this.getPrintAreas(request.producerVariantId);
    const area =
      areas.data.find((a) => a.placement === request.placement) ?? areas.data[0] ?? null;

    if (!area) {
      return envelope(this.id, areas.provenance, areas.raw, {
        acceptable: false,
        effectiveDpi: null,
        errors: [
          `No print area published for placement "${request.placement}". ` +
            'Cannot validate the print file against an unknown specification.',
        ],
        warnings: [],
        printArea: null,
      });
    }

    const result = validateLocally(
      {
        widthPx: request.widthPx,
        heightPx: request.heightPx,
        format: request.format,
        colourSpace: request.colourSpace,
        hasAlpha: request.hasAlpha,
        fileSizeBytes: request.fileSizeBytes,
        declaredDpi: null,
      },
      area,
      DEFAULT_PRINT_FILE_POLICY,
    );
    return envelope(this.id, areas.provenance, areas.raw, result);
  }

  // --- Products -----------------------------------------------------------

  async createProduct(
    draft: ProducerProductDraft,
  ): Promise<ProducerResponse<ProducerProductRef>> {
    const raw = await this.transport.call('create-product', {
      method: 'POST',
      url: ENDPOINTS.products,
      body: buildProductBody(draft),
      idempotencyKey: draft.externalId,
    });
    return envelope(this.id, this.transport.provenance, raw, mapProductRef(raw, draft));
  }

  async updateProduct(
    producerSyncProductId: string,
    draft: ProducerProductDraft,
  ): Promise<ProducerResponse<ProducerProductRef>> {
    const raw = await this.transport.call('update-product', {
      method: 'PATCH',
      url: ENDPOINTS.product(producerSyncProductId),
      body: buildProductBody(draft),
    });
    return envelope(this.id, this.transport.provenance, raw, mapProductRef(raw, draft));
  }

  // --- Orders -------------------------------------------------------------

  async createOrder(
    request: ProducerOrderRequest,
  ): Promise<ProducerResponse<ProducerOrder>> {
    const raw = await this.transport.call('create-order', {
      method: 'POST',
      url: `${ENDPOINTS.orders}?confirm=${request.confirm ? 'true' : 'false'}`,
      body: {
        external_id: request.externalId,
        recipient: {
          name: request.recipient.name,
          address1: request.recipient.address1,
          address2: request.recipient.address2,
          city: request.recipient.city,
          zip: request.recipient.postcode,
          country_code: request.recipient.countryCode,
          email: request.recipient.email,
          phone: request.recipient.phone,
        },
        order_items: request.items.map((item) => ({
          external_id: item.externalLineId,
          catalog_variant_id: item.producerVariantId,
          quantity: item.quantity,
        })),
      },
      idempotencyKey: request.idempotencyKey,
    });
    return envelope(this.id, this.transport.provenance, raw, this.mapOrder(raw, request.externalId));
  }

  async getOrder(producerOrderId: string): Promise<ProducerResponse<ProducerOrder>> {
    const raw = await this.transport.call('get-order', {
      method: 'GET',
      url: ENDPOINTS.order(producerOrderId),
    });
    return envelope(this.id, this.transport.provenance, raw, this.mapOrder(raw, null));
  }

  async getShipmentStatus(
    producerOrderId: string,
  ): Promise<ProducerResponse<ShipmentStatus>> {
    const raw = await this.transport.call('shipments', {
      method: 'GET',
      url: ENDPOINTS.shipments(producerOrderId),
    });
    const shipments = asArray(pick(raw, 'data')).map((item) => ({
      carrier: asString(pick(item, 'carrier')),
      trackingNumber: asString(pick(item, 'tracking_number')),
      trackingUrl: asString(pick(item, 'tracking_url')),
      shippedAt: parseDate(pick(item, 'shipped_at')),
      items: asArray(pick(item, 'items')).map((line) => asString(pick(line, 'external_id')) ?? ''),
    }));
    return envelope(this.id, this.transport.provenance, raw, {
      producerOrderId,
      status: mapOrderStatus(pick(raw, 'data', 'status')),
      shipments,
    });
  }

  // --- Webhooks -----------------------------------------------------------

  /**
   * Printful's webhook mechanism has historically relied on a secret URL rather
   * than a payload signature. If no shared secret is configured we return
   * false — we do NOT return true and call it verified. The caller's correct
   * response to an unverified webhook is to treat it as a hint and re-fetch the
   * order from the API, which is what services/ do.
   */
  verifyWebhook(raw: RawWebhook): boolean {
    if (!this.webhookSecret) {
      this.log.warn('webhook signature not verified: no shared secret configured', {
        mitigation: 're-fetch order state from the API before acting',
      });
      return false;
    }
    return verifyHmacWebhook(raw, this.webhookSecret, ['x-printful-signature']);
  }

  parseWebhook(raw: RawWebhook): ParsedWebhook {
    const body = JSON.parse(raw.body.toString('utf8')) as unknown;
    const type = asString(pick(body, 'type')) ?? '';
    return {
      eventId:
        asString(pick(body, 'id')) ??
        `printful:${type}:${asString(pick(body, 'created')) ?? 'unknown'}`,
      kind: mapWebhookKind(type),
      producerOrderId: asString(pick(body, 'data', 'order', 'id')),
      externalId: asString(pick(body, 'data', 'order', 'external_id')),
      occurredAt: parseDate(pick(body, 'created')),
      payload: body,
    };
  }

  private mapOrder(raw: unknown, fallbackExternalId: string | null): ProducerOrder {
    const data = pick(raw, 'data') ?? raw;
    const currency = (asString(pick(data, 'currency')) as Currency | null) ?? this.currency;
    return {
      producerOrderId: asString(pick(data, 'id')) ?? '',
      externalId: asString(pick(data, 'external_id')) ?? fallbackExternalId ?? '',
      status: mapOrderStatus(pick(data, 'status')),
      costs: {
        currency,
        items: moneyFromSupplier(pick(data, 'costs', 'subtotal'), currency),
        shipping: moneyFromSupplier(pick(data, 'costs', 'shipping'), currency),
        tax: moneyFromSupplier(pick(data, 'costs', 'tax'), currency),
        total: moneyFromSupplier(pick(data, 'costs', 'total'), currency),
      },
    };
  }
}

// --- mapping helpers -------------------------------------------------------

function mapCatalogueProduct(item: unknown): CatalogueProduct {
  return {
    producerProductId: asString(pick(item, 'id')) ?? '',
    name: asString(pick(item, 'name')) ?? '',
    brand: asString(pick(item, 'brand')),
    model: asString(pick(item, 'model')),
    manufacturerSku:
      asString(pick(item, 'manufacturer_sku')) ?? asString(pick(item, 'model_code')),
    productType: asString(pick(item, 'type')),
    description: asString(pick(item, 'description')),
    variantCount: asNumber(pick(item, 'variant_count')),
  };
}

function mapCatalogueVariant(item: unknown, producerProductId: string): CatalogueVariant {
  return {
    producerVariantId: asString(pick(item, 'id')) ?? '',
    producerProductId:
      asString(pick(item, 'catalog_product_id')) ?? producerProductId,
    name: asString(pick(item, 'name')) ?? '',
    size: asString(pick(item, 'size')),
    colour: asString(pick(item, 'color')),
    colourHex: asString(pick(item, 'color_code')),
    sku: asString(pick(item, 'sku')),
    availability: availabilityFromSupplier(
      pick(item, 'availability') ?? pick(item, 'availability_status'),
    ),
  };
}

function mapPrintArea(item: unknown): PrintAreaSpec {
  return {
    placement: asString(pick(item, 'placement')) ?? 'unknown',
    widthPx: asNumber(pick(item, 'width')) ?? 0,
    heightPx: asNumber(pick(item, 'height')) ?? 0,
    dpi: asNumber(pick(item, 'dpi')),
    widthMm: asNumber(pick(item, 'width_mm')),
    heightMm: asNumber(pick(item, 'height_mm')),
  };
}

function mapFulfilmentWindow(source: unknown): ProducerCostQuote['expectedFulfilment'] {
  const min = asNumber(pick(source, 'min_business_days'));
  const max = asNumber(pick(source, 'max_business_days'));
  if (min === null || max === null) return null;
  return { minBusinessDays: min, maxBusinessDays: max };
}

function buildProductBody(draft: ProducerProductDraft): Record<string, unknown> {
  return {
    external_id: draft.externalId,
    name: draft.name,
    catalog_product_id: draft.producerProductId,
    sync_variants: draft.variants.map((variant) => ({
      catalog_variant_id: variant.producerVariantId,
      placements: variant.placements.map((placement) => ({
        placement: placement.placement,
        image_url: placement.imageUrl,
      })),
    })),
  };
}

function mapProductRef(raw: unknown, draft: ProducerProductDraft): ProducerProductRef {
  const data = pick(raw, 'data') ?? raw;
  const variantIds = asArray(pick(data, 'sync_variants'))
    .map((v) => asString(pick(v, 'catalog_variant_id')))
    .filter((v): v is string => v !== null);
  return {
    producerProductId: draft.producerProductId,
    producerSyncProductId: asString(pick(data, 'id')),
    variantIds:
      variantIds.length > 0
        ? variantIds
        : draft.variants.map((v) => v.producerVariantId),
    mockupUrls: asArray(pick(data, 'mockups'))
      .map((m) => asString(pick(m, 'url')))
      .filter((m): m is string => m !== null),
  };
}

function mapOrderStatus(value: unknown): ProducerOrderStatus {
  const text = asString(value)?.toLowerCase() ?? '';
  if (text === '') return 'UNKNOWN';
  if (/draft/.test(text)) return 'DRAFT';
  if (/pending|onhold|on_hold/.test(text)) return 'PENDING';
  if (/inprocess|in_process|in_production|fulfilled_partially/.test(text)) return 'IN_PRODUCTION';
  if (/shipped|partial/.test(text)) return 'SHIPPED';
  if (/delivered/.test(text)) return 'DELIVERED';
  if (/cancel/.test(text)) return 'CANCELLED';
  if (/fail|reject/.test(text)) return 'FAILED';
  return 'UNKNOWN';
}

function mapWebhookKind(type: string): ParsedWebhook['kind'] {
  const text = type.toLowerCase();
  if (/shipment_sent|package_shipped/.test(text)) return 'ORDER_SHIPPED';
  if (/order_failed|order_canceled|order_cancelled/.test(text)) return 'ORDER_FAILED';
  if (/order_updated|order_put_hold|order_remove_hold/.test(text)) return 'ORDER_UPDATED';
  if (/stock_updated|product_updated/.test(text)) return 'STOCK_UPDATED';
  return 'UNKNOWN';
}

function parseDate(value: unknown): Date | null {
  const text = asString(value);
  if (text === null) return null;
  const numeric = Number(text);
  const date = Number.isFinite(numeric) && text.length <= 13
    ? new Date(numeric * (text.length <= 10 ? 1000 : 1))
    : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
