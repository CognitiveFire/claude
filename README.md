# Indie Archive

Turn original artwork into commercially viable, automatically fulfilled
merchandise, and use paid advertising to find profitable audiences.

The primary business KPI is **contribution after advertising**. Not revenue,
not ROAS, not impressions.

## What exists today (milestone one)

`Artwork → Producer → Economics → Shopify draft product`

```
ia artwork:add       register an artwork, read its real metadata, scan for
                     protected references
ia product:propose   match the garment in a supplier catalogue, map variants,
                     validate the print file against the real print area
ia product:price     fetch current supplier costs, run the unit-economic
                     model, propose a retail price, write an immutable snapshot
ia product:copy      generate or load product copy and SEO, gated on rights
ia product:publish   create the Shopify DRAFT product, if every gate passes
```

Supporting commands: `config:check`, `artwork:list`, `product:list`,
`product:show`, `rights:set`, `rights:scan`, `producer:compare`, `meta:status`.

Nothing in this codebase can make a product live, create a customer order, or
spend advertising money. Those are later milestones.

## Quick start

```bash
npm install
cp .env.example .env          # then fill it in
createdb indie_archive
psql -d indie_archive -f drizzle/0000_milestone_one.sql

npm run typecheck
npm test

npm run ia -- config:check
```

The commercial numbers in `.env` have **no defaults**. A guessed VAT rate or
payment fee misstates contribution per unit by double digits, so the system
refuses to price until you supply them.

## Running the milestone-one flow

```bash
npm run ia -- artwork:add \
  --file artwork/definitely-maybe.png \
  --title "Definitely Maybe?" --phrase "DEFINITELY MAYBE?"

npm run ia -- product:propose --artwork <id> \
  --name "Definitely Maybe? Tee" --slug definitely-maybe-tee \
  --sku STTU169 --sizes S,M,L,XL --colour Black

npm run ia -- product:price --product <id> --country GB
npm run ia -- product:copy  --product <id> --allow "definitely maybe"
npm run ia -- product:publish --product <id> --print-file-url <url>
```

## Architecture

Four rings, dependencies pointing inward only.

```
CLI ──────────────┐
                  ▼
       ┌────────────────────────┐
       │ services/   use-cases  │
       └───────────┬────────────┘
                   │
  ┌────────────────┼─────────────────┐
  ▼                ▼                 ▼
core/           ports/            adapters/
economics       ProducerPort      printful/  gelato/
money           CommercePort      shopify/   ai/
printfile                         http/
rights                                │
                                      ▼
                                    db/
```

`core/` is pure: no IO, no clock, no supplier knowledge. `core/economics` does
not know that Printful exists, which is what makes the supplier replaceable.

See `docs/architecture.md` for the economic model, the gates, and the
verification status of each integration. See `docs/meta-isolation.md` for the
Meta account isolation requirements.

## Design commitments

- **No hard-coded supplier costs.** Every cost is fetched. A cost the supplier
  omits is `UNKNOWN` and propagates as `UNKNOWN` — never as zero.
- **Provenance is tracked.** Costs are `LIVE_API` or `FIXTURE`. A product
  cannot be published on `FIXTURE` costs.
- **The supplier is replaceable.** Two adapters implement one `ProducerPort`
  and pass one shared contract test. A second adapter is what proves the
  abstraction; one adapter proves nothing.
- **Rights fail closed.** `UNKNOWN` is not consent. Publication and advertising
  block until a human records a decision.
- **Money is integers.** Minor units plus an explicit currency. Mixed-currency
  arithmetic throws rather than producing a plausible wrong number.
- **No autonomous spending.** Campaigns require an explicit `APPROVED` state,
  and `META_WRITE_ENABLED` defaults to false.
- **AI does not invent facts.** It writes copy. It never produces a price, a
  cost, a delivery time or a stock level.
