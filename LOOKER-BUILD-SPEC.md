# Looker Studio Build Specification — Morrow Bank Executive Screens
**Version:** 0.1 (Phase 1 draft — awaiting approval)  
**Date:** 2026-08-30  
**Author:** Apriil (Matthew Robinson) assisted by Claude  
**Status:** DRAFT — stop and wait for approval before Phase 2 begins  

---

## Pre-build decisions

These must be agreed before a single chart is placed. They are not implementation details — they change the data model.

### D1 — Product dimension (canonical values)

Product must resolve to the same string in every data source or a page-level product filter will silently drop rows on some charts and not others.

**Canonical product list (exact strings):**
```
Consumer Loan      ← includes Flex Credit / Flex Loan (same product, different label)
Credit Card
Refinance
Deposit
Refinance Existing
Unmapped
```

**Product availability by market (confirmed via Google Ads campaigns + CM360 Floodlight activities):**

| Product | NO | FI | SE |
|---------|----|----|-----|
| Consumer Loan | ✓ | ✓ | ✓ |
| Credit Card | ✓ | ✓ | — |
| Refinance | ✓ | — | — |
| Deposit / Savings | ✓ | — | ✓ |
| Refinance Existing | ✓ | — | — |
| Flex Loan / Flex Credit | ✓ | ✓ | ✓ |

Sources: Google Ads active/paused campaigns per account, CM360 Floodlight activity names, morrowbank.se product pages (2026-08-31 — no Credit Card listed).
"Flex Credit" on the website = "Flex Loan" in data = maps to **Consumer Loan** in the canonical product list. Do not create a separate canonical value — roll into Consumer Loan.
Rows with `—` will not appear in Floodlight data for that market — this is expected; not an Unmapped gap.

`Unmapped` is always present and is never filtered out. It is the bucket for rows where the derivation logic below does not match. If `Unmapped` is non-zero in production, something changed upstream that must be investigated.

**Derivation per source:**

| Source | How product is derived |
|--------|----------------------|
| `cost_data.t_all_cost_raw` (BQ) | `product` field already present — confirmed values: Consumer Loan, Credit Card, Refinance, Deposit, Refinance Existing. Validate against canonical list; add `Unmapped` as ELSE. |
| `cost_data.t_all_cost_brand_split` (BQ) | Same `product` field. |
| SA360 (`Norway Search Ads 360`) | Not yet confirmed — likely derived from campaign name. **Action required:** confirm whether SA360 connector exposes a product field or whether campaign name parsing is needed. Spec cannot be finalised for SA360 page until confirmed. |
| `master_ecommerce_funnel` (BQ, GA4-based) | Not yet confirmed. **Action required:** inspect schema — likely from a GA4 event parameter or item_name. |
| Search Console | No product dimension natively. Must be derived from keyword-to-product mapping table. **Action required:** mapping table must exist or be created in BQ before organic page can be built. |

**Business definition lives in BigQuery, not in Looker Studio.** Each source should expose a `product_canonical` field from a warehouse view or Dataform model. The Looker Studio calculated field is display-only formatting at most.

---

### D2 — Cost-to-booking join

**Current state:** the existing report uses a Blend on `t_all_cost_brand_split` (the PIVOT table) which already contains both cost and booking fields (`Booked`, `Credit Limit`) in a single source. Confirmed 2026-08-31 from edit-mode screenshot — bookings table uses this blend with filter "Exclude Brand and Others".

**Specified join for Home page (product-level only):**
- Source: `t_all_cost_brand_split` (BQ PIVOT) — already contains cost + `Booked` + `Credit Limit` by market, product
- No separate join needed if all required fields are present in this table
- **Action required:** inspect `t_all_cost_brand_split` schema to confirm all cost component fields (google_ads_cost, jellyfish_cost, sa360_fees, etc.) and booking fields are present. If cost components are missing, blend with `t_all_cost_raw` on market + product + date.
- Silent drop risk: Brand rows excluded by filter — confirm this is intentional for the new report.

**Channel-level CPA is not yet buildable.** The DV360 attribution problem (see D3) means channel-level bookings cannot be summed without double-counting. The SA360 page shows cost-side metrics reliably; the booking metric on that page is the Floodlight `Send` count (form submission), not bank-confirmed booked customers. This must be labelled explicitly.

**Fallback until join is resolved:** Home page shows product-level blended CPA (total marketing cost ÷ booked customers). SA360 and DV360 pages show their own cost and their own conversion proxy separately — they are never divided into each other's bookings.

---

### D3 — DV360 attribution

**Two separate fields — never one field with a filter.**

| Field name | Definition | Display label |
|-----------|-----------|---------------|
| `bookings_click_attributed` | Conversions where the attributed interaction is a click from a DV360-served ad | Bookings (click) |
| `bookings_any_touch` | Conversions where any touchpoint in the 30-day path included a DV360 impression or click | In-path bookings (any touch) |

`bookings_any_touch` is:
- Never summed with any other channel's bookings metric
- Never used in a CPA or CAC calculation
- Always shown with a visible flag: "Path statistic — not a channel total. Includes view-through touchpoints."
- Displayed in a side panel on the DV360 page only, separate from the main KPI row

**Resolution:** add a CM360 native Looker Studio connector (separate from the BQ export) for the DV360 page. The CM360 connector exposes click-through and view-through conversions as distinct fields — no BQ pipeline change required. Connect using CM360 profile 10999615, advertiser IDs NO=14356170, FI=14356173, SE=14399044.

---

### D4 — Metric naming and definitions

| Report label | Definition | Source | Notes |
|-------------|-----------|--------|-------|
| Form sends | Floodlight `Send` activity — form submitted | CM360 Floodlight | NOT GA4 `begin_checkout`. Must use explicit Floodlight activity IDs, not substring match on "send". |
| Booked customers | Bank-confirmed applications — product-specific Floodlight `Approved` or `Paid Out` activity | CM360 Floodlight | Must use explicit activity IDs. Deposit currently shows 173 booked at zero cost — flag in data quality panel. |
| Paid-out volume | NOK/SEK/EUR value of loans paid out | `t_all_cost_brand_split`.`Paid out Volume` | Confirmed 2026-08-31 — field exists in PIVOT table alongside Booked and Credit Limit. |
| Marketing cost | Sum of: `Media Spend` + `Agency Cost` + `Affiliate Cost` + `actual_sa360_fee` | `cost_data.t_all_cost_raw` | Field names confirmed from report editor 2026-08-31. All in local currency. No EUR conversion in report — show currency label per row. |
| Marketing cost per product | `Marketing Cost for Loan`, `Marketing Cost for Credit Card` etc. | `t_all_cost_brand_split` | Per-product cost fields confirmed — the PIVOT table has separate named cost fields per product, not a single cost column filtered by product. |
| MER | Marketing cost ÷ paid-out volume | Calculated | Labelled as MER throughout. The existing report calls this "CAC" — that label must not appear on the new screens. |
| Cost per booked | Marketing cost ÷ booked customers (click-attributed, product level) | Calculated | Blended across channels at product level on Home page. Channel-specific on SA360/DV360 pages with attribution basis in tooltip. |
| Conversions YoY | `total_conversions` from same period prior year | `CC last year` (ds36 — custom SQL on `t_all_cost_brand_split`) | Blend on product + advertiser + display_date. Show as comparison column or delta %. |
| SA360 leads / sends | Floodlight `Send` count as reported by SA360 | SA360 connector | Not comparable to booked customers. 2,698 SA360 conversions vs 330 bank-booked in July NO — different stages, different windows. Never presented in the same column. |
| Organic form sends | GA4 `begin_checkout` | GA4 / `master_ecommerce_funnel` | Form started, not submitted. Flagged until confirmed that this event reliably means the same thing across markets. Labelled: "Form starts (GA4) — not confirmed submissions." |

**Attribution window:** CM360 30-day click / 7-day view. SA360 attribution is also 30-day click — confirmed 2026-08-31 via CM360 Floodlight Configuration API (all three markets: NO config 14356170, FI config 14356173, SE config 14399044 all show `clickDuration: 30`). Update D7 item 2 accordingly.

---

### D5 — Floodlight activity IDs

Floodlight matching currently uses substring (`"paid out"`, `"send"`, `"approved"`). This is fragile and catches unintended activities including one at zero rows that would double-count if it fires.

**Floodlight activity IDs — resolved 2026-08-31 via CM360 API (profile 10999615, account 2318929).**

Spec the warehouse view to filter on `activity_id IN (...)` with a comment listing the IDs. Any new activity ID added by the client will be invisible until the list is updated — this is preferable to a substring match that auto-includes unknown activities.

#### Form Send activities (ACTIVE)

| Market | Product | Activity name | ID |
|--------|---------|---------------|----|
| NO | Consumer Loan | FL - Counter Send Consumer Loan | 433332677 |
| NO | Credit Card | FL - Counter Send Credit Card | 433840549 |
| NO | Refinance | FL - Counter Send External Refinance | 433431948 |
| FI | Consumer Loan | FL - Counter Send Consumer Loan | 434514460 |
| FI | Credit Card | FL - Counter Send Credit Card | 433424955 |
| SE | Consumer Loan | FL - Counter Send Consumer Loan | 433332683 |

Note: FI does not offer Refinance. SE does not offer Credit Card or Refinance. No Send activities for those product/market combinations — confirmed correct.

#### Approved activities (ACTIVE)

| Market | Product | Activity name | ID |
|--------|---------|---------------|----|
| NO | Consumer Loan | FL - Counter Approved Consumer Loan | 145564878 |
| NO | Credit Card | FL - Counter Approved Credit Card | 145561519 |
| NO | Refinance | FL - Counter Approved External Refinance | 186362175 |
| FI | Consumer Loan | FL - Counter Approved Consumer Loan | 139635736 |
| FI | Credit Card | FL - Counter Approved Credit Card | 138904321 |
| SE | Consumer Loan | FL - Counter Approved Consumer Loan | 139767276 |

Note: SE has no Approved Credit Card or Refinance activity — confirmed correct (products not offered in SE).

#### Paid Out activities (ACTIVE)

| Market | Product | Activity name | ID |
|--------|---------|---------------|----|
| NO | Consumer Loan | Consumer Loan Paid Out | 177867827 |
| NO | Credit Card | Credit Card Paid Out | 177868448 |
| NO | Refinance | External Refinance Paid Out | 186362181 |
| NO | (generic) | Conversion Paid Out - NO | 84445506 |
| FI | Consumer Loan | Consumer Loan Paid Out | 177870140 |
| FI | Credit Card | Credit Card Paid Out | 178000573 |
| FI | (generic) | Conversion Paid Out | 105890573 |
| SE | Consumer Loan | Consumer Loan Paid Out | 185591222 |
| SE | (generic) | Conversion Paid Out | 105866773 |

Note: NO has both product-specific and a generic "Conversion Paid Out - NO" (84445506). Use product-specific IDs where available; treat the generic ID as legacy unless confirmed otherwise.

#### Begin Checkout activities (for reference — GA4 equivalent in CM360)

| Market | Product | Activity name | ID |
|--------|---------|---------------|----|
| NO | Consumer Loan | Begin Checkout - Consumer Loan | 325718590 |
| NO | Credit Card | Begin Checkout - Credit Card | 322432474 |
| NO | Refinance | Begin Checkout - Refinance | 322371743 |
| FI | Consumer Loan | Begin Checkout - Consumer Loan | 327706297 |
| FI | Credit Card | Begin Checkout - Credit Card | 327618445 |
| SE | Consumer Loan | Begin Checkout - Consumer Loan | 322296034 |

---

### D6 — Currency

All three markets report in local currency (NOK / SEK / EUR). The new report does **not** convert to a single currency — cross-market comparison tables must show currency as a column and make no implicit conversion. MER is a ratio and is currency-neutral. CPA is in local currency and must be labelled as such.

---

### D7 — Data quality panel (Home page, permanent)

A fixed side panel on the Home page lists known caveats. It is always visible and never filterable. Contents:

1. DV360 bookings any-touch path statistic — do not sum with SA360 or organic
2. SA360 attribution window: **30-day click** (confirmed 2026-08-31 — CM360 Floodlight config)
3. CM360/SA360 windows differ — cross-channel comparison is directional only
4. Organic form sends = GA4 begin_checkout (form start, not submission)
5. SA360 leads = Floodlight Send (form submission) — different funnel stage from GA4
6. SA360 conversions (~2,698 July NO) vs bank-booked (~330 July NO) — different stages
7. Deposit: 173 booked at zero marketing cost — acquisition channel unknown
8. Floodlight activities matched by explicit ID — any new activity not in the list is excluded
9. `Unmapped` product bucket: if non-zero, a product has appeared that is not in the canonical list

---

## Report structure

**Report-level controls (persist across all 4 pages):**
- Market: dropdown filter on `market` dimension — values: NO - Morrow Bank, SE - Morrow Bank, FI - Morrow Bank. Default: ALL.
- Date range: date picker. Default: current month to date.

**Page-level controls:**
- Product: dropdown filter on `product_canonical`. Present on SA360, DV360, Organic pages. Default: ALL. Always includes `Unmapped`.

**Theme:** Light only. No dark/light toggle — not achievable in Looker Studio.

---

## Page 1 — Home (Executive)

### Layout

```
[ Market: ▼ ]  [ Date: ▼ ]

[ Hero row: 5 scorecards ]

[ Main table: product × channel ]   [ Side panel A: vs target by product ]

                                     [ Side panel B: data quality ]
```

### Hero row — 5 scorecards

| Position | Label | Metric | Source | Attribution note |
|----------|-------|--------|--------|-----------------|
| 1 | Form sends | Floodlight Send count | CM360 / Floodlight | Explicit activity IDs only |
| 2 | Booked customers | Floodlight Approved/Paid-Out count | CM360 / Floodlight | Click-attributed; excludes Deposit (see D7 item 7) |
| 3 | Paid-out volume | NOK/SEK/EUR sum | BQ booking table | Local currency; label market below value |
| 4 | Marketing cost | Sum of all cost fields | `t_all_cost_raw` | Local currency |
| 5 | MER | Marketing cost ÷ paid-out volume | Calculated | Tooltip: "Marketing Efficiency Ratio = total marketing cost / paid-out loan volume. Not cost per customer." |

All scorecards: no comparison period by default (avoids misleading delta on MER which is ratio-based). Comparison period can be added later.

### Main table — product × channel

| Property | Value |
|----------|-------|
| Type | Table with row groups |
| Primary dimension | `product_canonical` |
| Secondary dimension | Channel (Paid Search / Paid Display / Organic) — derived field, not a filter |
| Metrics | Form sends · Booked customers · Loan value / credit limit · Cost per booked · Marketing cost |
| Sort | Product ascending; channel within product |
| Row limit | No limit — canonical list is small (7 products × 3 channels = 21 rows max) |
| Conditional formatting | Cost per booked: red/amber/green against product target (requires `t_daily_targets`) |
| Footer | Grand total row |

**Cost per booked** on this table = blended marketing cost ÷ booked customers at product level. Channel is contextual grouping only — there is no channel-attributed booking number on this page (see D2).

**Note:** The existing report's CPA/CAC table filters out Refinance and Brand. The new report must show all products including Refinance — do not carry over the "exclude refinance" filter. If Refinance CPA looks anomalous, flag it in the data quality panel rather than hiding it.

**Unmapped product** always appears as a row. If non-zero, it appears in red.

### Side panel A — Performance vs target (by product)

| Property | Value |
|----------|-------|
| Type | Bullet chart or scorecard grid (one per product) |
| Products shown | Consumer Loan, Credit Card, Refinance (Deposit excluded — see D7 item 7) |
| Actual metric | Booked customers (Floodlight Approved) |
| Target metric | From `t_daily_targets` (BQ, ds34) — confirm field name |
| Data source | Blend of bookings source + `t_daily_targets` on market + product + month |

### Side panel B — Data quality

Static text box (not a chart). Lists D7 items 1–9 verbatim. Font: smaller than body. Heading: "Data quality notes." Always visible.

---

## Page 2 — SA360

### Layout

```
[ Product: ▼ ]   (Market and Date inherited from report level)

[ Hero row: 5 scorecards ]

[ Main table: product → campaign ]
```

### Hero row — 5 scorecards

| Position | Label | Metric | Source | Note |
|----------|-------|--------|--------|------|
| 1 | Form sends | SA360 Floodlight Send | SA360 connector | Explicit activity IDs |
| 2 | Booked | SA360 Floodlight Approved | SA360 connector | Click-attributed, SA360 attribution window (footnote if still 90-day) |
| 3 | Loan value | — | TBC | Confirm if SA360 exposes revenue/value or if must come from BQ join |
| 4 | Media spend | SA360 cost | SA360 connector | Excludes agency fees |
| 5 | Cost per booked | Media spend ÷ SA360 Floodlight Approved | Calculated | Tooltip: "SA360 media spend ÷ SA360-attributed approved applications. Attribution window: [X] days click." |

### Main table

| Property | Value |
|----------|-------|
| Type | Table with row groups |
| Primary dimension | `product_canonical` |
| Secondary dimension | Campaign name |
| Metrics | Form sends · Booked · Approval rate (Booked ÷ Form sends) · Loan value · Cost per booked · Media spend |
| Sort | Product ascending, cost per booked ascending within product |
| Row limit | 50 (campaigns are finite; no truncation expected — verify) |
| Unmapped | Campaigns that do not map to canonical product appear under `Unmapped` |

**Approval rate** = SA360 Floodlight Approved ÷ SA360 Floodlight Send. Both from SA360 connector using explicit activity IDs. Tooltip explains this is within-SA360 only.

**Action required before building:** confirm SA360 connector (`Norway Search Ads 360`, ds32) field names for: cost, Send conversion count, Approved conversion count, campaign name, date. Currently ds32 is orphaned (0 charts) — it may need to be reconnected or a new SA360 connector created for each market.

---

## Page 3 — DV360

### Layout

```
[ Product: ▼ ]   (Market and Date inherited)

[ Hero row: 6 scorecards — two booking figures clearly separated ]

[ Main table: product → IO → line item ]    [ Side panel: path-to-conversion ]
```

### Hero row — 6 scorecards

| Position | Label | Metric | Source | Note |
|----------|-------|--------|--------|------|
| 1 | Reach | Unique reach | CM360 / DV360 | Impressions proxy if unique reach not available |
| 2 | Impressions | DV360 impressions | CM360 |  |
| 3 | Media spend | DV360 cost | `t_all_cost_raw`.`jellyfish_cost` | Local currency |
| 4 | **Bookings — click** | `bookings_click_attributed` | CM360 Floodlight (filtered to click interaction) | Bold border. Tooltip: "DV360-attributed bookings where the attributed interaction was a click. This is the comparable channel metric." |
| 5 | Cost per booked (click) | Media spend ÷ `bookings_click_attributed` | Calculated | Tooltip: "DV360 media spend ÷ click-attributed bookings only." |
| 6 | **In-path bookings** | `bookings_any_touch` | CM360 Floodlight (any DV360 touchpoint in path) | Grey background. Tooltip: "Path statistic — not a channel total. Counts bookings where any touchpoint in the 30-day path included a DV360 impression or click. Includes view-through. Do not sum with other channels." |

Scorecards 4 and 6 must be visually distinct. Scorecard 6 uses a secondary colour and a visible warning icon.

### Main table

| Property | Value |
|----------|-------|
| Type | Table with drill-down or row groups |
| Primary dimension | `product_canonical` |
| Secondary dimension | `dv360_insertion_order` |
| Tertiary dimension | `dv360_line_item` |
| Metrics | Impressions · Clicks · `bookings_click_attributed` · Media spend · Cost per booked (click) |
| Sort | Product ascending, media spend descending within product |
| Exclude | `bookings_any_touch` not shown in this table — path panel only |
| Row limit | 100 (verify no truncation) |

**Action required:** `bookings_click_attributed` requires a CM360 data pull filtered to `interaction_type = CLICK`. Confirm this field is isolatable in `Master_CM360_Report` (ds0) or a new BQ view is needed.

### Side panel — path-to-conversion

| Property | Value |
|----------|-------|
| Type | Table or scorecard grid |
| Metrics | `bookings_any_touch`, share of paths containing DV360 touch, avg touchpoints per path |
| Label | "Path statistics — how often DV360 appears in conversion paths. These are path shares, not channel bookings. Do not compare to SA360 or organic booking numbers." |
| Data source | CM360 path data — confirm available in `Master_CM360_Report` or separate BQ view needed |

---

## Page 4 — Organic

### Layout

```
[ Product: ▼ ]   (Market and Date inherited)

[ Hero row: 4 scorecards ]

[ Main table: product → keyword → ranking page ]    [ Side panel: topic coverage ]
```

### Hero row — 4 scorecards

| Position | Label | Metric | Source | Note |
|----------|-------|--------|--------|------|
| 1 | Form starts | GA4 `begin_checkout` | `master_ecommerce_funnel` / GA4 | Visible flag: "Form starts (GA4) — not confirmed submissions. Definition unconfirmed across markets." |
| 2 | Search Console clicks | Clicks from GSC | Google Search Console connector | Organic only — confirm no brand filter active |
| 3 | Keywords in top 10 | Count of tracked keywords with avg position ≤ 10 | GSC | Requires keyword tracking list — confirm source |
| 4 | Visibility | Share of tracked keywords ranking in top 10 | GSC | Calculated: keywords in top 10 ÷ total tracked keywords |

**Action required:** Google Search Console connector must be added. Stephan confirmed Matthew should have access to Search Console. Property URL(s) needed per market — confirm with Stephan.

### Main table

| Property | Value |
|----------|-------|
| Type | Table with row groups |
| Primary dimension | `product_canonical` |
| Secondary dimension | Keyword |
| Tertiary dimension | Ranking page (URL) |
| Metrics | Avg position · Clicks · Impressions · CTR |
| Sort | Product ascending, avg position ascending within product |
| Row limit | 100 — verify no truncation; keyword lists can be large |

**Product derivation for organic:** keywords must be mapped to canonical products. This mapping does not exist in Search Console — it must be a BQ lookup table keyed on keyword. **Action required before organic page can be built.**

### Side panel — topic coverage

| Property | Value |
|----------|-------|
| Type | Table or scorecard grid |
| Dimensions | Topic area, competitor |
| Metrics | Share of keywords ranking vs fixed competitor set |
| Data source | Not yet established — requires competitor keyword list in BQ |
| Status | **Cannot be built without competitor keyword data.** Placeholder panel with explanation until data is available. |

---

## Data sources for the new report

All sources below are BigQuery (embedded, owner credentials from Stephan's Google account). The new report is a copy — do not edit sources in Morrow's original.

| Role | BQ reference | Current Looker Studio name | Status |
|------|-------------|--------------------------|--------|
| Primary cost table | `gtm-p2k7nfgh-odvmo.cost_data.t_all_cost_raw` | `t_all_cost_raw` (ds37) | Active — 6 charts |
| Cost pivot (Page 4 bar) | `gtm-p2k7nfgh-odvmo.cost_data.t_all_cost_brand_split` | `Stephan Test` (ds29) — rename to `cost_by_product_market_pivot` | Active — 1 chart |
| CM360 dimensions (cost) | `gtm-p2k7nfgh-odvmo.cost_data.Master_CM360_Report` | `Master_CM360_Report` (ds0) | Active — 1 chart |
| CM360 conversions (DV360 page) | CM360 native Looker Studio connector | Not yet added | Add new — profile 10999615, advertisers NO/FI/SE. Exposes click-through vs view-through conversions separately. |
| Targets | `gtm-p2k7nfgh-odvmo` (table TBC) | `t_daily_targets` (ds34) | Active — 1 chart |
| Bookings / ecommerce funnel | `gtm-p2k7nfgh-odvmo` (table TBC) | `master_ecommerce_funnel` (ds10) — orphaned | Must reconnect |
| SA360 — Norway | SA360 connector | `Norway Search Ads 360` (ds32) — orphaned | Must reconnect or create new |
| SA360 — Finland | SA360 connector | `Finnland Search Ads 360` (ds41) — orphaned | Must reconnect or create new |
| SA360 — Sweden | SA360 connector | Not present — must create | Create new |
| Search Console — NO | Google Search Console connector | `sc-domain:morrowbank.no` | Create new |
| Search Console — FI | Google Search Console connector | `sc-domain:morrowbank.fi` | Create new |
| Search Console — SE | Google Search Console connector | `sc-domain:morrowbank.se` | Create new |
| Fixed/agency cost | Google Sheets — `Agency Cost - Sheet2` (ds44) | Orphaned | Assess whether to keep or migrate to BQ |
| YoY comparison | Custom SQL on `t_all_cost_brand_split` — shifts date +1 year, pulls `total_conversions` for prior year period | `CC last year` (ds36) | **Keep.** Used for year-on-year conversion comparison. Fields: `display_date` (date +1yr), `dv360_advertiser`, `product`, `total_conversions`. Blend with current period on `product` + `dv360_advertiser` + `display_date`. |

**14 orphaned sources** should be removed from the copy before Phase 2 begins. Only the 4 active sources (ds0, ds29, ds34, ds37) are carried forward, renamed cleanly, and supplemented with the new connectors above.

---

## Blends required

### Blend 1 — Home page main table

| Property | Value |
|----------|-------|
| Left source | `t_all_cost_raw` (cost by market, product, date) |
| Right source | Bookings source (`master_ecommerce_funnel` or Floodlight pull) |
| Join key | market + product_canonical + date |
| Join type | Left join (retain all cost rows) |
| Risk | Booking rows with no cost will be silently dropped — acceptable for cost-anchored table; note in data quality panel |
| Aggregation | SUM cost fields; SUM booked count; SUM paid-out volume |

### Blend 2 — Home side panel A (vs target)

| Property | Value |
|----------|-------|
| Left source | Bookings source |
| Right source | `t_daily_targets` |
| Join key | market + product_canonical + month |
| Join type | Left join |
| Risk | Products in targets with no bookings that month: silently dropped. Use right join or outer join if target should always show. |

---

## Open items — must resolve before Phase 2

| # | Item | Owner | Blocking |
|---|------|-------|---------|
| O1 | ~~SA360 attribution window: confirm 30-day click is live~~ **RESOLVED 2026-08-31** — CM360 Floodlight configs confirm 30-day click for NO/FI/SE | Stephan | SA360 page footnote |
| O2 | ~~Floodlight activity IDs~~ **RESOLVED 2026-08-31** — all Send/Approved/Paid Out IDs extracted from CM360 API (see D5 tables). Gaps: FI/SE missing Refinance/CC Send and Approved — confirm with Stephan | Stephan | All booking metrics |
| O3 | ~~`bookings_click_attributed` isolation~~ **RESOLVED 2026-08-31** — Add CM360 native Looker Studio connector (not BQ) for the DV360 page. The CM360 connector exposes click-through and view-through conversions as separate fields natively. No BQ pipeline change needed. Matthew has CM360 access (profile 10999615, account 2318929). | Stephan / trafficking | DV360 hero row |
| O4 | ~~SA360 connector field names~~ **RESOLVED 2026-08-31** — Standard SA360 Looker Studio connector fields confirmed: `Campaign` (dim), `Date` (dim), `Cost` (metric), `Clicks`, `Impressions`, `Conversions` (all Floodlight combined). Per-activity counts appear as separate named metrics matching Floodlight activity names (e.g. "FL - Counter Send Consumer Loan"). Confirm exact metric names once connector is added to the report copy. | Apriil | SA360 page |
| O5 | ~~`master_ecommerce_funnel` schema~~ **RESOLVED 2026-08-31** — Bookings table on Page 1 uses a Blend on `t_all_cost_brand_split` (ds29). Fields confirmed: `Product` (dim), `Booked` (metric), `Credit Limit` (metric). Filter: "Exclude Brand and Others". `master_ecommerce_funnel` is NOT the bookings source in the existing report. | Stephan | Home table join |
| O6 | ~~Search Console property URLs~~ **RESOLVED 2026-08-31** — `sc-domain:morrowbank.no`, `sc-domain:morrowbank.se`, `sc-domain:morrowbank.fi` (all siteFullUser, confirmed via API) | Stephan | Organic page |
| O7 | Keyword-to-product mapping table | Apriil + Stephan | **DEFERRED** — Organic page main table will show placeholder until mapping table exists. |
| O8 | Competitor keyword list for topic coverage side panel | Stephan / SEO agency | **DEFERRED** — Organic side panel shows placeholder panel with explanation. |
| O9 | ~~Paid-out volume source~~ **RESOLVED 2026-08-31** — `Paid out Volume` is a field in `t_all_cost_brand_split` (confirmed from combo chart properties). Same source as `Booked` and `Credit Limit`. Not a separate Floodlight pull. | Stephan | Home hero row 3 |
| O10 | ~~`t_daily_targets` field names~~ **RESOLVED 2026-08-31** — Page 2 bar chart uses a blend named `Loan vs Target`. Dimension: `Consumer Loan Combined`. Metrics: `Actual Volume` (SUM from cost/booking source), `Target` (AUT calculated from `t_daily_targets`). The new Home page side panel A should replicate this blend pattern per product. Note: existing report has one blend per product page — the new report needs a single blend covering all products at once (filter by product_canonical). | Apriil (can inspect in Looker Studio) | Home side panel A |
| O11 | Rename `Stephan Test` (ds29) to `cost_by_product_market_pivot` in the copy | Apriil | Hygiene before Phase 2 |
| O12 | Remove 14 orphaned data sources from copy | Apriil | Hygiene before Phase 2 |
| O13 | ~~SE Credit Cards: zero spend~~ **RESOLVED 2026-08-31** — expected. Credit Card not yet launched in SE, confirmed by Matthew. | Stephan | Page 1 table accuracy |
| O14 | ~~NO Refinance: zero spend~~ **RESOLVED 2026-08-31** — confirmed data gap, NOT paused. Google Ads shows 29,693 NOK spend on "NO - Search - Refinance" in July (PAUSED now but active in July). Three Display/YouTube Refinance campaigns are REMOVED and show zero — those are genuine zeros. The 29,693 NOK is missing from `t_all_cost_brand_split` — likely excluded by the "Exclude Brand and Others" filter or dropped by the brand split PIVOT logic. **Flag in data quality panel; investigate PIVOT query for Refinance exclusion.** | Apriil (SA360 check) | Page 1 table accuracy |

---

## What the new report does NOT contain (explicit exclusions)

- Revenue column (client confirmed not relevant)
- "CAC" label anywhere — it is MER and must be labelled as such
- Affiliate bookings as a separate channel (affiliate spend is included in marketing cost total only)
- DV360 any-touch bookings in any summable position
- SA360 conversions divided by bank-booked customers in the same formula
- Dark mode (not achievable in Looker Studio)
- Decline / disqualification reasons (in Stephan's DWH — not available for this build)
- Bing Ads as a separate page (Bing cost included in total; spend is zero in July for all markets)

---

*Phase 1 complete. Stop and wait for approval before Phase 2 begins.*
