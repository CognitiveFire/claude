/**
 * ProducerPort — the supplier abstraction.
 *
 * The commercial engine talks only to this interface. It has no knowledge that
 * Printful, Gelato or any other supplier exists, and no supplier cost, SKU or
 * endpoint appears anywhere above this line. Swapping producers means writing
 * one adapter, not touching business logic.
 *
 * Every cost-bearing response carries its own provenance and timestamp so the
 * system can refuse to publish on stale or fixture data.
 */

import type { Currency, Money } from '../core/money.ts';

export type ProducerId = 'printful' | 'gelato';

/** Where a value came from. FIXTURE data can never reach a real product. */
export type DataProvenance = 'LIVE_API' | 'FIXTURE';

export type Availability =
  | 'IN_STOCK'
  | 'LOW_STOCK'
  | 'OUT_OF_STOCK'
  | 'DISCONTINUED'
  | 'UNKNOWN';

export interface FulfilmentWindow {
  readonly minBusinessDays: number;
  readonly maxBusinessDays: number;
}

/** Every response from a producer carries this envelope. */
export interface ProducerResponse<T> {
  readonly data: T;
  readonly provenance: DataProvenance;
  readonly retrievedAt: Date;
  readonly producerId: ProducerId;
  /** Untouched supplier payload, persisted for audit and dispute evidence. */
  readonly raw: unknown;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export interface CatalogueSearchQuery {
  /** Free text, e.g. "Stanley Stella Creator". */
  readonly text?: string;
  /** Supplier-neutral hint, e.g. "t-shirt". */
  readonly productType?: string;
  /** Manufacturer SKU to match exactly, e.g. "STTU169". */
  readonly manufacturerSku?: string;
  /** ISO country the product must be fulfillable from/to, e.g. "GB". */
  readonly destinationCountry?: string;
  readonly limit?: number;
}

export interface CatalogueProduct {
  readonly producerProductId: string;
  readonly name: string;
  readonly brand: string | null;
  readonly model: string | null;
  /** Manufacturer SKU when the supplier exposes it; null when it does not. */
  readonly manufacturerSku: string | null;
  readonly productType: string | null;
  readonly description: string | null;
  readonly variantCount: number | null;
}

export interface CatalogueVariant {
  readonly producerVariantId: string;
  readonly producerProductId: string;
  readonly name: string;
  readonly size: string | null;
  readonly colour: string | null;
  readonly colourHex: string | null;
  /** Supplier SKU for this specific variant. */
  readonly sku: string | null;
  readonly availability: Availability;
}

/** The printable region for one placement on one product. */
export interface PrintAreaSpec {
  readonly placement: string;
  readonly widthPx: number;
  readonly heightPx: number;
  /** DPI the supplier prints at, when stated. Null when not published. */
  readonly dpi: number | null;
  readonly widthMm: number | null;
  readonly heightMm: number | null;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface CostQuoteRequest {
  readonly producerVariantId: string;
  readonly placements: readonly string[];
  readonly destinationCountry: string;
  readonly destinationPostcode?: string;
  readonly quantity: number;
}

/**
 * A supplier cost quote. Any field the supplier does not return stays null and
 * propagates as UNKNOWN through the economics engine. It is never defaulted to
 * zero: a silent zero cost is how a product gets published below cost.
 */
export interface ProducerCostQuote {
  readonly producerVariantId: string;
  readonly currency: Currency;
  /** Blank garment cost. */
  readonly productCost: Money | null;
  /** Decoration/printing cost across the requested placements. */
  readonly printCost: Money | null;
  /** Per-order handling or fulfilment fee. */
  readonly fulfilmentCost: Money | null;
  /** Cost to ship to the requested destination. */
  readonly shippingCost: Money | null;
  readonly availability: Availability;
  readonly expectedFulfilment: FulfilmentWindow | null;
  /** Where the order would be produced, when the supplier discloses it. */
  readonly fulfilmentCountry: string | null;
}

// ---------------------------------------------------------------------------
// Print files
// ---------------------------------------------------------------------------

export interface PrintFileValidationRequest {
  readonly producerVariantId: string;
  readonly placement: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly colourSpace: string | null;
  readonly hasAlpha: boolean | null;
  readonly fileSizeBytes: number | null;
  readonly format: string;
}

export interface PrintFileValidationResult {
  readonly acceptable: boolean;
  readonly effectiveDpi: number | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly printArea: PrintAreaSpec | null;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProducerProductDraft {
  readonly name: string;
  readonly producerProductId: string;
  readonly variants: readonly {
    readonly producerVariantId: string;
    readonly placements: readonly {
      readonly placement: string;
      /** Publicly reachable URL of the print file. */
      readonly imageUrl: string;
    }[];
  }[];
  /** Our internal product ID, echoed back by the supplier where supported. */
  readonly externalId: string;
}

export interface ProducerProductRef {
  readonly producerProductId: string;
  readonly producerSyncProductId: string | null;
  readonly variantIds: readonly string[];
  readonly mockupUrls: readonly string[];
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type ProducerOrderStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'IN_PRODUCTION'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'UNKNOWN';

export interface ProducerOrderRequest {
  /** Our order ID. Also the idempotency key where the supplier honours one. */
  readonly externalId: string;
  readonly idempotencyKey: string;
  readonly recipient: {
    readonly name: string;
    readonly address1: string;
    readonly address2: string | null;
    readonly city: string;
    readonly postcode: string;
    readonly countryCode: string;
    readonly email: string | null;
    readonly phone: string | null;
  };
  readonly items: readonly {
    readonly producerVariantId: string;
    readonly quantity: number;
    readonly externalLineId: string;
  }[];
  /** Never submit an order for real production from a non-live environment. */
  readonly confirm: boolean;
}

export interface ProducerOrder {
  readonly producerOrderId: string;
  readonly externalId: string;
  readonly status: ProducerOrderStatus;
  readonly costs: {
    readonly currency: Currency;
    readonly items: Money | null;
    readonly shipping: Money | null;
    readonly tax: Money | null;
    readonly total: Money | null;
  };
}

export interface ShipmentStatus {
  readonly producerOrderId: string;
  readonly status: ProducerOrderStatus;
  readonly shipments: readonly {
    readonly carrier: string | null;
    readonly trackingNumber: string | null;
    readonly trackingUrl: string | null;
    readonly shippedAt: Date | null;
    readonly items: readonly string[];
  }[];
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface RawWebhook {
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** Raw body bytes. Signature verification must not use a re-serialised body. */
  readonly body: Buffer;
}

export type ProducerWebhookKind =
  | 'ORDER_UPDATED'
  | 'ORDER_SHIPPED'
  | 'ORDER_FAILED'
  | 'STOCK_UPDATED'
  | 'UNKNOWN';

export interface ParsedWebhook {
  /** Supplier's own event ID, used to make replay handling idempotent. */
  readonly eventId: string;
  readonly kind: ProducerWebhookKind;
  readonly producerOrderId: string | null;
  readonly externalId: string | null;
  readonly occurredAt: Date | null;
  readonly payload: unknown;
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

export interface ProducerPort {
  readonly id: ProducerId;
  readonly displayName: string;

  /** True when this adapter is serving recorded fixtures. */
  readonly usingFixtures: boolean;

  // Catalogue
  searchCatalogue(
    query: CatalogueSearchQuery,
  ): Promise<ProducerResponse<readonly CatalogueProduct[]>>;
  getProduct(producerProductId: string): Promise<ProducerResponse<CatalogueProduct>>;
  getVariants(
    producerProductId: string,
  ): Promise<ProducerResponse<readonly CatalogueVariant[]>>;
  getPrintAreas(
    producerProductId: string,
  ): Promise<ProducerResponse<readonly PrintAreaSpec[]>>;

  // Pricing and availability
  getCostQuote(request: CostQuoteRequest): Promise<ProducerResponse<ProducerCostQuote>>;
  getAvailability(producerVariantId: string): Promise<ProducerResponse<Availability>>;

  // Print files
  validatePrintFile(
    request: PrintFileValidationRequest,
  ): Promise<ProducerResponse<PrintFileValidationResult>>;

  // Products
  createProduct(draft: ProducerProductDraft): Promise<ProducerResponse<ProducerProductRef>>;
  updateProduct(
    producerSyncProductId: string,
    draft: ProducerProductDraft,
  ): Promise<ProducerResponse<ProducerProductRef>>;

  // Orders
  createOrder(request: ProducerOrderRequest): Promise<ProducerResponse<ProducerOrder>>;
  getOrder(producerOrderId: string): Promise<ProducerResponse<ProducerOrder>>;
  getShipmentStatus(producerOrderId: string): Promise<ProducerResponse<ShipmentStatus>>;

  // Webhooks
  verifyWebhook(raw: RawWebhook): boolean;
  parseWebhook(raw: RawWebhook): ParsedWebhook;
}
