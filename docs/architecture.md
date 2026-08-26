# Architecture

## Verification status — read this first

This matters more than anything else in this document.

| Integration | Code written | Verified against live API |
|---|---|---|
| Economics engine | yes | **yes** — 41 unit tests, hand-checked worked example |
| Print-file validator | yes | **yes** — 11 unit tests |
| Rights scanner / gate | yes | **yes** — 15 unit tests |
| Image metadata reader | yes | **yes** — against real PNG files |
| Database schema | yes | **yes** — migration applied to PostgreSQL 16 |
| `ProducerPort` contract | yes | **yes** — both adapters pass one shared suite on fixtures |
| Printful adapter | yes | **NO** |
| Gelato adapter | yes | **NO** |
| Shopify adapter | yes | **NO** |
| Anthropic copy service | yes | **NO** |

The environment this was built in blocks `api.printful.com`, `api.gelato.com`
and `graph.facebook.com` at the network policy (the proxy answers `403` to
`CONNECT`), and no Shopify or Anthropic credentials were available. So:

- **Every endpoint path and response field mapping in the three API adapters is
  a stated assumption, not a verified fact.** Each adapter collects its paths in
  one `ENDPOINTS` object and its field mappings in `map*` functions at the
  bottom of the file, so correcting one is a local edit rather than a rewrite.
- **The fixtures under `fixtures/` are synthetic.** They carry
  `"_provenance": "SYNTHETIC"` and a warning field. The numbers in them are
  invented shapes for offline testing. They are not supplier prices, and the
  system will not let them back a published product.
- **No supplier comparison has been performed.** `ia producer:compare` runs and
  produces a table, but on fixtures it labels every figure as a placeholder.

What is genuinely proven is the part that does not need the network: the
commercial model, the validation, the gates, the schema, and that one interface
serves two different suppliers.

## The unit-economic model

Implemented in `src/core/economics/engine.ts`. Pure — no IO, no clock, no
supplier knowledge.

```
  retail price (VAT inclusive)
+ shipping charged to customer
= gross revenue
- VAT                              gross × rate / (100 + rate)
= net revenue
- garment cost                     ┐
- printing cost                    ├ production cost
- fulfilment fee                   ┘
- shipping we pay the producer
- payment fees                     gross × pct + fixed
- platform fees                    gross × pct
- expected returns allowance       see below
= CONTRIBUTION BEFORE ADVERTISING
- advertising cost per unit
= CONTRIBUTION AFTER ADVERTISING   ← the primary KPI
```

Derived figures:

- `gross margin` = (net revenue − production cost) / net revenue
- `contribution margin` = contribution before advertising / net revenue
- `break-even CPA` = contribution before advertising. Spend one penny more to
  acquire the order and the unit loses money.
- `break-even ROAS` = gross revenue / break-even CPA
- `target CPA` = contribution before advertising − target contribution after ads
- `target ROAS` = gross revenue / target CPA

ROAS is expressed against gross revenue because that is what ad platforms
report, so the threshold is directly comparable to what Meta shows.

### Two stated assumptions

**Returns allowance.** Modelled as `return rate × (net revenue + production
cost + outbound shipping)` — a total loss of the returned unit with no resale
recovery. Print-on-demand returns are rarely resaleable, so this is the
conservative reading. If that changes, the assumption is in one place and
documented.

**Fee base.** Payment and platform fees are charged on the gross, VAT-inclusive
amount the customer actually pays, not on net revenue.

### UNKNOWN propagation

A cost the supplier does not return is `null`, meaning UNKNOWN. It is never
defaulted to zero, because a zero garment cost and an unknown garment cost lead
to very different decisions. `calculateEconomics` returns a discriminated
union: `COMPLETE` with the full figures, or `INCOMPLETE` naming every missing
input. Callers cannot accidentally read a partial result as a real one.

Margins whose denominator is zero return `null`, not `0`. An undefined margin
and a zero margin are different statements.

## The price solver

`src/core/economics/pricing.ts` solves for the retail price that hits the
configured target contribution margin before advertising:

```
N = [(production + shipping) × (1 + returnRate) + fixedFee]
    ─────────────────────────────────────────────────────────
    (1 − returnRate) − (1 + vat) × (paymentPct + platformPct) − targetMargin

gross = N × (1 + vat);   retail price = gross − shipping charged
```

A non-positive denominator means the fee and return structure consumes the
target margin at *any* price. That is reported as `UNACHIEVABLE` with the
reason, rather than papered over with a bigger number.

The solved price is then rounded **up** to a configured price point, and the
economics are **re-run at the rounded price**. What the system reports is
always the actual result, never the target.

## The publication gates

`src/services/publishProduct.ts`. All fail closed; none can be bypassed by a
flag.

1. **Rights** — `artwork_rights_status` must be `CLEARED`;
   `brand_reference_status` must not be `UNKNOWN`, `REVIEW_REQUIRED` or
   `BLOCKED`; `licensing_required` must be decided.
2. **Provenance** — the latest economic snapshot must come from a `LIVE_API`
   quote.
3. **Freshness** — the quote must be newer than `COST_QUOTE_TTL_MINUTES`.
4. **Completeness** — no `UNKNOWN` cost lines, and contribution before
   advertising must be positive.
5. **Print file** — the artwork must pass validation against the supplier's
   real print area.
6. **Copy** — description and SEO fields must exist.

Every attempt, blocked or successful, writes an `audit_log` row.

## Print-file validation

`src/core/printfile.ts`. Suppliers generally publish no "validate this file"
endpoint, so this is local and deterministic. It **refuses** rather than warns
on anything that would visibly degrade the garment: a soft warning gets clicked
through and the customer receives a blurry shirt.

Rejects: unprintable format, non-RGB colour space, oversized file, artwork too
small to fill the placement, effective DPI below the floor.
Warns: DPI between the floor and the preferred value, missing alpha channel,
aspect-ratio mismatch, and — importantly — an UNKNOWN effective DPI when the
supplier publishes no print resolution, where it says outright that print
quality cannot be verified from data and a physical sample is needed.

Effective DPI is `artworkPx / (printAreaPx / printAreaDpi)` — how many real
pixels land in each printed inch once the artwork is scaled to fill the area.

## Identity and mapping

Internal UUIDs are the only primary keys. Names are display data.

```
products.id (UUID)
  ├─ producer_products    → (producer_id, producer_product_id)
  │    └─ producer_variants → producer_variant_id
  ├─ commerce_products    → (platform, commerce_product_id)
  │    └─ commerce_variants → commerce_variant_id
  └─ product_variants     → sku
```

Every external identifier has a unique constraint per `(system, id)`, so a
mapping cannot silently duplicate. `artworks.file_hash` is unique: the artwork's
identity is its content, not its filename.

`economic_snapshots` is append-only and stores the commercial config that was
in force, so any historical price remains reproducible and explainable.

## Reliability

- **Retries** — exponential backoff with jitter in one shared HTTP client. An
  explicit `Retry-After` always wins over the computed delay.
- **Rate limits** — `429` and `408` are retryable; other `4xx` are not.
  Shopify's GraphQL cost extension is watched and warns as the budget drops.
- **Idempotency** — an idempotency key is sent on every create. `orders` will
  carry a unique index on `(source, shopify_order_id)` in milestone 2.
- **Webhook signatures** — verified over the raw body bytes with a timing-safe
  comparison. When a supplier provides no signature mechanism,
  `verifyWebhook` returns **false**; it never returns true on the grounds that
  verification was impossible. The correct response to an unverified webhook is
  to treat it as a hint and re-fetch state from the API.
- **Secret redaction** — applied to logs *and* error paths, because
  leaked-credential-in-stack-trace is the common failure. Credentials are
  identified in audit records by a non-reversible fingerprint, so we can prove
  which credential acted without ever writing it down.
- **Audit** — every mutation writes a row, including failures.

## Deferred, deliberately

Not built, and not stubbed as empty tables or unused abstractions:

- **Milestone 2** — customers, orders, order_items, webhook_events, the
  fulfilment pipeline, Shopify order webhooks, tracking sync.
- **Milestone 3** — the Meta adapter, ad_sets, ads, creative_assets,
  performance_metrics. The `campaigns`, `meta_identity`,
  `meta_asset_approvals`, `meta_denied_businesses` and
  `meta_spend_preflight_log` tables exist now because the approval mechanism
  should be a schema-level fact before any code can spend money.
- **No dashboard.** Milestone one is one artwork and one product. A CLI is the
  smallest interface that can prove the commercial model.

## Stack

TypeScript on Node 22, PostgreSQL 16, Drizzle ORM, Zod at every API boundary,
Vitest, Fastify (milestone 2, for webhooks).

Drizzle rather than Prisma: Prisma downloads query-engine binaries from a host
this environment blocks, and Drizzle is pure TypeScript with no engine binary.
Node's native type stripping runs the CLI directly, so `erasableSyntaxOnly` is
enabled to keep the source runnable without a build step.
