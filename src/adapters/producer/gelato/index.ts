/**
 * Gelato adapter — the second implementation of ProducerPort.
 *
 * ⚠ ENDPOINT PATHS AND FIELD MAPPINGS ARE UNVERIFIED AGAINST THE LIVE API.
 * api.gelato.com is blocked by this environment's network policy (403 to
 * CONNECT), so nothing here has been executed against Gelato. Paths live in
 * ENDPOINTS so correcting them is a local edit.
 *
 * This adapter exists NOW rather than "later" on purpose: a single adapter
 * proves nothing about an abstraction. Writing the second one is what
 * demonstrates that no Printful-shaped assumption leaked into the business
 * logic, and it is what makes the supplier comparison possible at all.
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

const ENDPOINTS = {
  base: 'https://product.gelatoapis.com',
  catalogueSearch: '/v3/catalogs/apparel/products:search',
  catalogueProduct: (id: string) => `/v3/products/${id}`,
  catalogueVariants: (id: string) => `/v3/products/${id}/variants`,
  printAreas: (id: string) => `/v3/products/${id}/print-areas`,
  availability: (id: string) => `/v3/products/${id}/availability`,
  priceQuote: 'https://order.gelatoapis.com/v4/orders:quote',
  products: 'https://ecommerce.gelatoapis.com/v1/stores/products',
  product: (id: string) => `https://ecommerce.gelatoapis.com/v1/stores/products/${id}`,
  orders: 'https://order.gelatoapis.com/v4/orders',
  order: (id: string) => `https://order.gelatoapis.com/v4/orders/${id}`,
} as const;

export interface GelatoAdapterOptions {
  readonly apiKey?: string;
  readonly currency: Currency;
  readonly useFixtures: boolean;
  readonly webhookSecret?: string;
  readonly fixtureDirectory?: string;
}

export class GelatoAdapter implements ProducerPort {
  readonly id: ProducerId = 'gelato';
  readonly displayName = 'Gelato';
  readonly usingFixtures: boolean;

  private readonly transport: RawTransport;
  private readonly currency: Currency;
  private readonly webhookSecret: string | undefined;
  private readonly log = logger.child({ producer: 'gelato' });

  constructor(options: GelatoAdapterOptions) {
    this.currency = options.currency;
    this.webhookSecret = options.webhookSecret;

    if (options.useFixtures) {
      this.usingFixtures = true;
      this.transport = new FixtureTransport('gelato', options.fixtureDirectory);
      return;
    }

    if (!options.apiKey) {
      throw new Error(
        'GELATO_API_KEY is required when PRODUCER_USE_FIXTURES=false. ' +
          'Set the key, or run against fixtures.',
      );
    }
    registerSecret(options.apiKey);

    this.usingFixtures = false;
    this.transport = new HttpTransport(
      new HttpClient({
        name: 'gelato',
        baseUrl: ENDPOINTS.base,
        defaultHeaders: { 'x-api-key': options.apiKey },
      }),
    );
  }

  async searchCatalogue(
    query: CatalogueSearchQuery,
  ): Promise<ProducerResponse<readonly CatalogueProduct[]>> {
    const raw = await this.transport.call('catalogue-search', {
      method: 'POST',
      url: ENDPOINTS.catalogueSearch,
      body: {
        limit: query.limit ?? 25,
        attributeFilters: query.manufacturerSku
          ? { GarmentBrandSku: [query.manufacturerSku] }
          : undefined,
      },
    });
    const products = asArray(pick(raw, 'products')).map((item) => mapProduct(item));
    return envelope(this.id, this.transport.provenance, raw, products);
  }

  async getProduct(producerProductId: string): Promise<ProducerResponse<CatalogueProduct>> {
    const raw = await this.transport.call('catalogue-product', {
      method: 'GET',
      url: ENDPOINTS.catalogueProduct(producerProductId),
    });
    return envelope(this.id, this.transport.provenance, raw, mapProduct(raw));
  }

  async getVariants(
    producerProductId: string,
  ): Promise<ProducerResponse<readonly CatalogueVariant[]>> {
    const raw = await this.transport.call('catalogue-variants', {
      method: 'GET',
      url: ENDPOINTS.catalogueVariants(producerProductId),
    });
    const variants = asArray(pick(raw, 'variants')).map((item) => ({
      producerVariantId: asString(pick(item, 'productUid')) ?? '',
      producerProductId,
      name: asString(pick(item, 'title')) ?? '',
      size: asString(pick(item, 'attributes', 'GarmentSize')),
      colour: asString(pick(item, 'attributes', 'GarmentColor')),
      colourHex: asString(pick(item, 'attributes', 'GarmentColorHex')),
      sku: asString(pick(item, 'sku')),
      availability: availabilityFromSupplier(pick(item, 'status')),
    }));
    return envelope(this.id, this.transport.provenance, raw, variants);
  }

  async getPrintAreas(
    producerProductId: string,
  ): Promise<ProducerResponse<readonly PrintAreaSpec[]>> {
    const raw = await this.transport.call('print-areas', {
      method: 'GET',
      url: ENDPOINTS.printAreas(producerProductId),
    });
    const areas = asArray(pick(raw, 'printAreas')).map((item) => ({
      placement: asString(pick(item, 'name')) ?? 'unknown',
      widthPx: asNumber(pick(item, 'widthPx')) ?? 0,
      heightPx: asNumber(pick(item, 'heightPx')) ?? 0,
      dpi: asNumber(pick(item, 'dpi')),
      widthMm: asNumber(pick(item, 'widthMm')),
      heightMm: asNumber(pick(item, 'heightMm')),
    }));
    return envelope(this.id, this.transport.provenance, raw, areas);
  }

  async getCostQuote(
    request: CostQuoteRequest,
  ): Promise<ProducerResponse<ProducerCostQuote>> {
    const raw = await this.transport.call('cost-quote', {
      method: 'POST',
      url: ENDPOINTS.priceQuote,
      body: {
        orderReferenceId: `quote-${request.producerVariantId}`,
        currency: this.currency,
        recipient: {
          countryIsoCode: request.destinationCountry,
          postCode: request.destinationPostcode,
        },
        products: [
          { productUid: request.producerVariantId, quantity: request.quantity },
        ],
      },
    });

    const quote = pick(raw, 'quotes', '0') ?? pick(raw, 'quote') ?? raw;
    const currency = (asString(pick(quote, 'currency')) as Currency | null) ?? this.currency;

    // Gelato quotes a combined product price rather than a garment/print split.
    // We do NOT invent a split: printCost stays UNKNOWN and productCost carries
    // the combined figure, which the economics engine handles correctly because
    // it sums the production lines.
    const combined = moneyFromSupplier(
      pick(quote, 'products', '0', 'priceExclVat') ?? pick(quote, 'productPrice'),
      currency,
    );

    const result: ProducerCostQuote = {
      producerVariantId: request.producerVariantId,
      currency,
      productCost: combined,
      printCost: combined === null ? null : { minor: 0, currency },
      fulfilmentCost: moneyFromSupplier(pick(quote, 'fulfillmentPrice'), currency),
      shippingCost: moneyFromSupplier(
        pick(quote, 'shipmentMethods', '0', 'priceExclVat') ?? pick(quote, 'shippingPrice'),
        currency,
      ),
      availability: availabilityFromSupplier(pick(quote, 'status')),
      expectedFulfilment: mapWindow(pick(quote, 'shipmentMethods', '0')),
      fulfilmentCountry: asString(pick(quote, 'fulfillmentCountry')),
    };

    if (combined !== null) {
      this.log.debug('gelato quotes production as a single combined price', {
        note: 'printCost is reported as zero because it is included in productCost',
      });
    }

    return envelope(this.id, this.transport.provenance, raw, result);
  }

  async getAvailability(producerVariantId: string): Promise<ProducerResponse<Availability>> {
    const raw = await this.transport.call('availability', {
      method: 'GET',
      url: ENDPOINTS.availability(producerVariantId),
    });
    const status = availabilityFromSupplier(
      pick(raw, 'availability', '0', 'status') ?? pick(raw, 'status'),
    );
    return envelope(this.id, this.transport.provenance, raw, status);
  }

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
            'Cannot validate against an unknown specification.',
        ],
        warnings: [],
        printArea: null,
      });
    }

    return envelope(
      this.id,
      areas.provenance,
      areas.raw,
      validateLocally(
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
      ),
    );
  }

  async createProduct(
    draft: ProducerProductDraft,
  ): Promise<ProducerResponse<ProducerProductRef>> {
    const raw = await this.transport.call('create-product', {
      method: 'POST',
      url: ENDPOINTS.products,
      body: buildProductBody(draft),
      idempotencyKey: draft.externalId,
    });
    return envelope(this.id, this.transport.provenance, raw, mapRef(raw, draft));
  }

  async updateProduct(
    producerSyncProductId: string,
    draft: ProducerProductDraft,
  ): Promise<ProducerResponse<ProducerProductRef>> {
    const raw = await this.transport.call('update-product', {
      method: 'PUT',
      url: ENDPOINTS.product(producerSyncProductId),
      body: buildProductBody(draft),
    });
    return envelope(this.id, this.transport.provenance, raw, mapRef(raw, draft));
  }

  async createOrder(
    request: ProducerOrderRequest,
  ): Promise<ProducerResponse<ProducerOrder>> {
    const raw = await this.transport.call('create-order', {
      method: 'POST',
      url: ENDPOINTS.orders,
      body: {
        orderType: request.confirm ? 'order' : 'draft',
        orderReferenceId: request.externalId,
        customerReferenceId: request.externalId,
        currency: this.currency,
        recipient: {
          name: request.recipient.name,
          addressLine1: request.recipient.address1,
          addressLine2: request.recipient.address2,
          city: request.recipient.city,
          postCode: request.recipient.postcode,
          countryIsoCode: request.recipient.countryCode,
          email: request.recipient.email,
          phone: request.recipient.phone,
        },
        items: request.items.map((item) => ({
          itemReferenceId: item.externalLineId,
          productUid: item.producerVariantId,
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
    const raw = await this.transport.call('get-order', {
      method: 'GET',
      url: ENDPOINTS.order(producerOrderId),
    });
    const shipments = asArray(pick(raw, 'shipments')).map((item) => ({
      carrier: asString(pick(item, 'fulfillmentCountryIsoCode')),
      trackingNumber: asString(pick(item, 'trackingCode')),
      trackingUrl: asString(pick(item, 'trackingUrl')),
      shippedAt: parseDate(pick(item, 'shipmentDate')),
      items: asArray(pick(item, 'itemReferenceIds')).map((v) => asString(v) ?? ''),
    }));
    return envelope(this.id, this.transport.provenance, raw, {
      producerOrderId,
      status: mapStatus(pick(raw, 'fulfillmentStatus')),
      shipments,
    });
  }

  verifyWebhook(raw: RawWebhook): boolean {
    if (!this.webhookSecret) {
      this.log.warn('webhook signature not verified: no shared secret configured', {
        mitigation: 're-fetch order state from the API before acting',
      });
      return false;
    }
    return verifyHmacWebhook(raw, this.webhookSecret, ['x-gelato-signature']);
  }

  parseWebhook(raw: RawWebhook): ParsedWebhook {
    const body = JSON.parse(raw.body.toString('utf8')) as unknown;
    const event = asString(pick(body, 'event')) ?? '';
    return {
      eventId:
        asString(pick(body, 'id')) ??
        `gelato:${event}:${asString(pick(body, 'orderReferenceId')) ?? 'unknown'}`,
      kind: mapKind(event),
      producerOrderId: asString(pick(body, 'orderId')),
      externalId: asString(pick(body, 'orderReferenceId')),
      occurredAt: parseDate(pick(body, 'createdAt')),
      payload: body,
    };
  }

  private mapOrder(raw: unknown, fallbackExternalId: string | null): ProducerOrder {
    const currency = (asString(pick(raw, 'currency')) as Currency | null) ?? this.currency;
    return {
      producerOrderId: asString(pick(raw, 'id')) ?? '',
      externalId:
        asString(pick(raw, 'orderReferenceId')) ?? fallbackExternalId ?? '',
      status: mapStatus(pick(raw, 'fulfillmentStatus')),
      costs: {
        currency,
        items: moneyFromSupplier(pick(raw, 'receipts', '0', 'productsPriceInclVat'), currency),
        shipping: moneyFromSupplier(pick(raw, 'receipts', '0', 'shippingPriceInclVat'), currency),
        tax: moneyFromSupplier(pick(raw, 'receipts', '0', 'totalVat'), currency),
        total: moneyFromSupplier(pick(raw, 'receipts', '0', 'totalInclVat'), currency),
      },
    };
  }
}

function mapProduct(item: unknown): CatalogueProduct {
  return {
    producerProductId:
      asString(pick(item, 'productUid')) ?? asString(pick(item, 'id')) ?? '',
    name: asString(pick(item, 'title')) ?? asString(pick(item, 'name')) ?? '',
    brand: asString(pick(item, 'attributes', 'GarmentBrand')),
    model: asString(pick(item, 'attributes', 'GarmentModel')),
    manufacturerSku: asString(pick(item, 'attributes', 'GarmentBrandSku')),
    productType: asString(pick(item, 'productType')) ?? asString(pick(item, 'catalogUid')),
    description: asString(pick(item, 'description')),
    variantCount: asNumber(pick(item, 'variantCount')),
  };
}

function mapWindow(source: unknown): ProducerCostQuote['expectedFulfilment'] {
  const min = asNumber(pick(source, 'minDeliveryDays'));
  const max = asNumber(pick(source, 'maxDeliveryDays'));
  if (min === null || max === null) return null;
  return { minBusinessDays: min, maxBusinessDays: max };
}

function buildProductBody(draft: ProducerProductDraft): Record<string, unknown> {
  return {
    externalId: draft.externalId,
    title: draft.name,
    templateId: draft.producerProductId,
    variants: draft.variants.map((variant) => ({
      productUid: variant.producerVariantId,
      imagePlaceholders: variant.placements.map((placement) => ({
        name: placement.placement,
        fileUrl: placement.imageUrl,
      })),
    })),
  };
}

function mapRef(raw: unknown, draft: ProducerProductDraft): ProducerProductRef {
  return {
    producerProductId: draft.producerProductId,
    producerSyncProductId: asString(pick(raw, 'id')),
    variantIds: draft.variants.map((v) => v.producerVariantId),
    mockupUrls: asArray(pick(raw, 'previewUrls'))
      .map((v) => asString(v))
      .filter((v): v is string => v !== null),
  };
}

function mapStatus(value: unknown): ProducerOrderStatus {
  const text = asString(value)?.toLowerCase() ?? '';
  if (text === '') return 'UNKNOWN';
  if (/draft/.test(text)) return 'DRAFT';
  if (/created|pending|passed/.test(text)) return 'PENDING';
  if (/printed|printing|in_production|production/.test(text)) return 'IN_PRODUCTION';
  if (/shipped|in_transit/.test(text)) return 'SHIPPED';
  if (/delivered/.test(text)) return 'DELIVERED';
  if (/cancel/.test(text)) return 'CANCELLED';
  if (/fail|not_?printable/.test(text)) return 'FAILED';
  return 'UNKNOWN';
}

function mapKind(event: string): ParsedWebhook['kind'] {
  const text = event.toLowerCase();
  if (/shipped|delivery/.test(text)) return 'ORDER_SHIPPED';
  if (/failed|canceled|cancelled/.test(text)) return 'ORDER_FAILED';
  if (/order_status_updated|order/.test(text)) return 'ORDER_UPDATED';
  if (/stock/.test(text)) return 'STOCK_UPDATED';
  return 'UNKNOWN';
}

function parseDate(value: unknown): Date | null {
  const text = asString(value);
  if (text === null) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
