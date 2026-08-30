# Looker Studio Audit — New Exec Dash
**Audit date:** 2026-08-30  
**Auditor:** Claude (Phase 0 read-only)  
**Source:** PDF export of report, edit-mode screenshot, and Resources → Manage data sources panel — all supplied by user (Matthew Robinson, Apriil)  
**Report URL:** https://datastudio.google.com/reporting/4cd67fb9-9529-404c-be2c-cb2abe160e22  
**Report name:** New Exec Dash  
**Status:** READ-ONLY. No edits made. No data sources touched.

---

## 1. Report Structure

| Page # | Page name (from UI) | URL anchor | Purpose |
|--------|---------------------|------------|---------|
| 1 | Overview / Media Cost vs Volume | rVziF | Cross-product cost + booking summary for selected market |
| 2 | Consumer Loan | (page 2) | Weekly Loan volume vs target + CAC/MER trend |
| 3 | Credit Card | (page 3) | Weekly CC bookings vs target + CPA trend |
| 4 | Marketing Cost Summary | (page 4) | Cross-market, cross-vendor media cost breakdown |

---

## 2. Data Sources

**18 data sources are attached to this report.** All are Embedded (not reusable). The Manage data sources panel shows:

| Alias | Name | Connector | Used in report | Status |
|-------|------|-----------|----------------|--------|
| ds0 | `Master_CM360_Report` | BigQuery | **1 chart** | Working |
| ds31 | `all_cost_brand_split` | BigQuery | 0 charts | Working |
| ds32 | `Norway Search Ads 360` | NEW Search Ads 360 | 0 charts | Working |
| ds33 | `all_cost_raw` | BigQuery | 0 charts | Working |
| ds35 | `Fixed Cost - Fixed Cost` | Google Sheets | 0 charts | Working |
| ds39 | `all_cost` | BigQuery | 0 charts | Working |
| ds40 | `agency_cost combined brand to CC and CL` | BigQuery | 0 charts | Working |
| ds10 | `master_ecommerce_funnel` | BigQuery | 0 charts | Working |
| ds29 | `Stephan Test` | BigQuery | **1 chart** | Working |
| ds37 | `t_all_cost_raw` | BigQuery | **6 charts** | Working |
| ds41 | `Finnland Search Ads 360` | NEW Search Ads 360 | 0 charts | Working |
| ds42 | `agency_cost` | BigQuery | 0 charts | Working |
| ds43 | `t_daily_targets` | BigQuery | 0 charts | Working |
| ds44 | `Agency Cost - Sheet2` | Google Sheets | 0 charts | Working |
| ds30 | `CSV Product Export` | BigQuery | 0 charts | Working |
| ds45 | `all_cost_brand_split` | BigQuery | 0 charts | Working |
| ds46 | `NO KPI` | BigQuery | 0 charts | Working |
| ds34 | `t_daily_targets` | BigQuery | **1 chart** | Working |

### Critical findings from this panel

**Only 4 sources are actively driving charts:**

| Alias | Name | Charts driven | Role |
|-------|------|---------------|------|
| ds37 | `t_all_cost_raw` | 6 | **Primary source** — all cost tables and trend charts |
| ds0 | `Master_CM360_Report` | 1 | CM360 data (impressions, clicks, DV360 dims) |
| ds34 | `t_daily_targets` | 1 | Target lines in bullet/progress charts |
| ds29 | `Stephan Test` | 1 | ⚠️ **Named "Stephan Test" — likely a dev/test source in production** |

**14 data sources are orphans (0 charts, 0 variables)** — they are attached but drive nothing. These include both `all_cost_brand_split` entries (ds31, ds45), `all_cost_raw` (ds33), `Norway Search Ads 360` (ds32), `Finnland Search Ads 360` (ds41), and 9 others. These should be reviewed and removed to reduce confusion.

**Duplicates:**
- `all_cost_brand_split` appears twice: ds31 and ds45 — both orphaned
- `t_daily_targets` appears twice: ds43 (0 charts, orphan) and ds34 (1 chart, active)

**Connector types confirmed:**
- 14 × BigQuery (all embedded)
- 2 × NEW Search Ads 360 (Norway ds32, Finland ds41 — both orphaned)
- 2 × Google Sheets (`Fixed Cost - Fixed Cost` ds35, `Agency Cost - Sheet2` ds44 — both orphaned)

> **Critical governance finding:** When clicking Edit on `t_all_cost_raw` (ds37), Looker Studio shows "Failed to fetch projects — please enter the project ID manually." This confirms the source uses **owner credentials from a different Google account** (not the current editor's). The BQ project/dataset/table are not visible to the editor. The report continues to serve data only because the original owner's credentials are still active in the background. If that account is deactivated or loses BQ access, the report will break silently. The owner account identity needs to be identified and documented. **Do not click Reconnect** — doing so would reassign credentials to the editor's account; if that account lacks BQ access, the 6 charts powered by this source will go blank.

### 2a. Fields on Master_CM360_Report (visible in edit panel)

| Field | Type | Notes |
|-------|------|-------|
| `advertiser_currency` | Text | Currency code per advertiser |
| `channel` | Text | Media channel |
| `clicks` | Numeric | CM360 clicks |
| `date` | Date | Raw date |
| `display_date` | Date | Formatted display date |
| `dv360_advertiser` | Text | DV360 advertiser name |
| `dv360_insertion_order` | Text | DV360 IO name |
| `dv360_line_item` | Text | DV360 line item name |
| `funnel_step` | Text | See/Think/Do funnel stage |
| `impressions` | Numeric | CM360 impressions |
| `local_advertiser_cost` | Numeric | Cost in advertiser local currency |
| `local_cost` | Numeric | Cost in local currency (possibly different calc) |
| `platform` | Text | Media platform label |
| `product` | Text | Product (Consumer Loan, Credit Card, etc.) |
| `products_no_brand` | Text | Product excluding Brand |
| `system_currency_cost` | Numeric | Cost in system/account currency |
| `Brand Media Spend` | Numeric | **Calculated field** — formula unknown, needs inspection |
| `Brand per product` | Numeric | **Calculated field** — formula unknown, needs inspection |

---

## 3. Controls (Filters & Date Pickers)

| Control | Type | Scope | Default observed |
|---------|------|-------|-----------------|
| Market | Dropdown filter | Report-level (appears on all pages) | NO - Morrow Bank (1 selected) |
| Platform | Dropdown filter | Page-level or report-level | No default — all platforms |
| Funnel Step | Dropdown filter | Page-level (Page 1 visible) | No default |
| product | Dropdown filter | Appears on Page 1 | No default |
| Date range picker | Date range control | Report-level | Jul 1, 2026 – Jul 31, 2026 |

> **Note:** The active `dv360_advertiser` filter `NO - Morro...` shown in the top filter bar on the edit-mode screenshot appears to be a saved / page-level filter, not a user-facing control. This needs verification — if it is hardcoded it restricts the report to NO Morrow Bank even when the Market dropdown changes.

---

## 4. Pages — Chart Inventory

### Page 1 — Overview

**Active filter at time of audit:** Market = NO - Morrow Bank, Date = Jul 1–31 2026

#### Chart 1 — Daily Cost vs Volume (bar + line combo)
| Property | Value |
|----------|-------|
| Type | Combo chart (bar + line) |
| Dimension | `date` (daily) |
| Metric 1 (bars) | Total Cost — left Y-axis, 0–15K |
| Metric 2 (line) | Paid out Volume — right Y-axis, 0–2M |
| Date range | Jul 1–31, 2026 |
| Data source | `Master_CM360_Report` (assumed) or blend |
| Sort | Date ascending |

Sample values (Jul 2026 daily cost): 4.2K → 14.7K peak, closing at 7.8K on Jul 30.

#### Chart 2 — Media Cost Table (left)
| Property | Value |
|----------|-------|
| Type | Table |
| Dimensions | Advertiser, Product |
| Metrics | Media Sp... (truncated — Media Spend), Agency Cost, Affiliate Cost, actual_sa36... (SA360 cost) |
| Rows | 6 (Consumer Loan, Brand, Credit Card, Refinance, Deposit, Refinance Existing) |
| Sort | Media Spend descending |
| Data source | Blend of `Master_CM360_Report` + `Norway Search Ads 360` + affiliate source |
| Grand total row | Yes |

**July 2026 values (NO - Morrow Bank, filtered):**

| Product | Media Spend | Agency Cost | Affiliate Cost | SA360 Cost |
|---------|------------|-------------|----------------|------------|
| Consumer Loan | 94,953.75 | 2,100 | 0 | 495.83 |
| Brand | 84,706.3 | 3,100 | 0 | 1,270.59 |
| Credit Card | 72,474.81 | 2,100 | 97,500 | 502.72 |
| Refinance | 32,524.96 | 2,100 | 0 | 429.16 |
| Deposit | 0 | 0 | 0 | 0 |
| Refinance Existing | 0 | 0 | 0 | 0 |
| **Grand total** | **284,659.83** | **9,300** | **97,500** | **2,698.3** |

> **Issue to investigate:** Column names are truncated in the PDF ("Media Sp...", "actual_sa36..."). Full column header labels need to be confirmed against the data source field names.

#### Chart 3 — Bookings Table (top right)
| Property | Value |
|----------|-------|
| Type | Table |
| Dimension | Product |
| Metrics | Booked (applications/bookings count), Credit Limit (NOK) |
| Sort | Booked descending |
| Data source | Unknown — likely CRM/booking source. Not CM360. Needs confirmation. |

**July 2026 values:**

| Product | Booked | Credit Limit |
|---------|--------|-------------|
| Credit Card | 219 | 8.4M |
| Deposit | 173 | 0 |
| Refinance | 59 | 8M |
| Consumer Loan | 52 | 5M |
| Refinance Existing | 2 | 65.8K |

#### Chart 4 — CPA / CAC Table (bottom right)
| Property | Value |
|----------|-------|
| Type | Table |
| Dimension | product |
| Metrics | CPA (cost per acquisition, NOK), CAC (%) |
| Sort | product ascending |
| Data source | Derived/calculated — blend of cost + booking sources |

**July 2026 values:**

| Product | CPA | CAC |
|---------|-----|-----|
| Consumer Loan | 1,937 | 2.03% |
| Credit Card | 609 | 1.59% |
| Deposit | 0 | null |
| Refinance | 1,197 | 0.88% |

---

### Page 2 — Consumer Loan

**Active filter:** Market = NO - Morrow Bank, Date = Jul 1–31 2026

#### Chart 1 — Volume vs Target (bullet / progress bar)
| Property | Value |
|----------|-------|
| Type | Bullet chart / scorecard pair |
| Actual | 13M (Consumer Loan paid-out volume) |
| Target | 13.8M |
| Data source | Unknown — booking/CRM source |

#### Chart 2 — Weekly Cost vs CAC (combo)
| Property | Value |
|----------|-------|
| Type | Combo chart (bar + line) |
| Dimension | Week (ISO week, grouped Mon–Sun) |
| Metric 1 (bars) | Marketing Cost for Loan — left Y-axis, 0–50K |
| Metric 2 (line) | CAC (MER) % — right Y-axis, 0–2.5% |
| Period shown | Weeks 27–31 (Jun 29 – Aug 2, 2026) |
| Average line | Avg. CAC = 1.32% |

**Weekly values:**

| Week | Marketing Cost | CAC % |
|------|---------------|-------|
| W27 (Jun 29–Jul 5) | — | 1.12% |
| W28 (Jul 6–12) | — | 2.17% |
| W29 (Jul 13–19) | — | 2.22% |
| W30 (Jul 20–26) | — | 1.24% |
| W31 (Jul 27–Aug 2) | — | 0.55% |

> **Note:** Page 2 contains a large text box explaining the difference between CAC and MER. This is informational copy, not a chart or control.

---

### Page 3 — Credit Card

**Active filter:** Market = NO - Morrow Bank, Date = Jul 1–31 2026

#### Chart 1 — Bookings vs Target (bullet / progress bar)
| Property | Value |
|----------|-------|
| Type | Bullet chart / scorecard pair |
| Actual | 219 |
| Target | 713 |
| Data source | CRM/booking source |

#### Chart 2 — Weekly Cost vs CPA (combo)
| Property | Value |
|----------|-------|
| Type | Combo chart (bar + line) |
| Dimension | Week |
| Metric 1 (bars) | Marketing Cost for Credit Card — left Y-axis, 0–40K |
| Metric 2 (line) | CPA — right Y-axis, 0–1K |
| Period shown | Weeks 27–31 |
| Average line | Avg. CPA = 608.81 |

**Weekly values:**

| Week | CPA |
|------|-----|
| W27 | 778.56 |
| W28 | 813.55 |
| W29 | 498.54 |
| W30 | 809.58 |
| W31 | 328.81 |

---

### Page 4 — Marketing Cost Summary

**No market filter active — shows all three markets.**

#### Chart 1 — Media Cost by Market / Vendor (table)
| Property | Value |
|----------|-------|
| Type | Table |
| Dimensions | Market, Currency, Product |
| Metrics | Apriil, Google Ads, Bing Ads/AllDigital, DV360/JellyFish, SA360/JellyFish, Affiliate/Adtraction, Total Product Cost |
| Data source | `all_cost_raw` or `all_cost_brand_split` blend |
| Sort | Unknown |

**July 2026 values (local currency):**

| Market | CCY | Product | Apriil | Google Ads | Bing/AllDig | DV360/JF | SA360/JF | Affiliate | Total |
|--------|-----|---------|--------|-----------|------------|---------|---------|-----------|-------|
| SE | SEK | Deposit | 0 | 1,943 | 0 | 0 | 28.72 | 0 | 1,972 |
| SE | SEK | Consumer Loan | 8,681 | 152,577 | 0 | 82,969 | 2,255 | 0 | 246,482 |
| NO | NOK | Deposit | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| NO | NOK | Credit Card | 6,265 | 85,604 | 0 | 38,960 | 1,265 | 2,500 | 134,594 |
| NO | NOK | Consumer Loan | 8,573 | 96,981 | 0 | 65,813 | 1,433 | 0 | 172,801 |
| FI | EUR | Consumer Loan | 366 | 5,626 | 0 | 8,581 | 83 | 0 | 14,657 |
| FI | EUR | Credit Card | 288 | 8,608 | 0 | 3,191 | 127 | 0 | 12,214 |

> **Issue:** SE Credit Cards and FI Agent products show zero spend. NO Refinance and Deposit show zero — Deposit is intentionally paused; Refinance absence needs explanation.

#### Chart 2 — Cost by Product/Market (bar chart)
| Property | Value |
|----------|-------|
| Type | Bar chart |
| Dimension | Product × Market combination (e.g. ConsumerLoansDirectNorway) |
| Metric | Total cost |
| Data source | `all_cost_brand_split` or `all_cost_raw` |

**Values (July 2026, local currency):**

| Segment | Value |
|---------|-------|
| ConsumerLoansDirectNorway | 172,801 |
| CreditCardsDirectNorway | 134,594 |
| ConsumerLoansAgentNorway | 0 |
| ConsumerLoansDirectFinland | 14,657 |
| CreditCardsDirectFinland | 12,214 |
| ConsumerLoansAgentFinland | 0 |
| ConsumerLoansDirectSweden | 246,482 |
| CreditCardsDirectSweden | 0 |
| ConsumerLoansAgentSweden | 0 |
| DepositNorway | 0 |
| DepositSweden | 1,972 |

---

## 5. Known Gaps / Open Questions for Phase 1

| # | Gap | Status | Where it matters |
|---|-----|--------|-----------------|
| G1 | Connector type for `all_cost_brand_split` and `all_cost_raw` | ✅ Resolved — both BigQuery, both orphaned (0 charts). Active cost source is `t_all_cost_raw` (ds37, BigQuery). | — |
| G2 | Full formula for calculated fields `Brand Media Spend` and `Brand per product` on `Master_CM360_Report` | ⚠️ Open | Phase 1 spec — must replicate exactly |
| G3 | BigQuery project/dataset/table behind `t_all_cost_raw` (ds37) | ⚠️ Open — most important gap | Phase 1 spec — it drives 6 charts |
| G4 | What chart does `Stephan Test` (ds29) drive? Is it safe to rely on? | ⚠️ Open — name suggests dev/test | Production stability risk |
| G5 | Owner credentials on BigQuery data sources — who owns the BQ connection? | ⚠️ Open | Access management if ownership changes |
| G6 | `dv360_advertiser` filter on Page 1 — hardcoded page filter or control? | ⚠️ Open | If hardcoded, FI/SE data is hidden even when Market = FI/SE |
| G7 | Data source for Bookings (Booked column, Credit Limit, paid-out volume) — likely `master_ecommerce_funnel` (ds10) or `t_all_cost_raw`? | ⚠️ Open | Phase 1 — connector and field mapping |
| G8 | Full column header text for truncated labels on Page 1 table ("Media Sp...", "actual_sa36...") | ⚠️ Open | Phase 1 spec accuracy |
| G9 | Target values for bullet charts (13.8M loan, 713 CC) — `t_daily_targets` (ds34) or hardcoded? | ⚠️ Open — likely ds34 | Phase 1 — monthly update process |
| G10 | 14 orphaned data sources — should they be removed before copy is taken? | ⚠️ Open | Clean copy for Phase 2 |
| G11 | NO Refinance — zero spend in July despite campaign history | ⚠️ Open | Reporting accuracy |
| G12 | SE Credit Cards — zero spend July in Page 4 table | ⚠️ Open | Reporting accuracy |

---

## 6. Observations for Phase 1 Spec

1. **Currency mixing on Page 4** — all three markets shown in local currency (NOK/SEK/EUR) in the same table with no conversion. A EUR-equivalent column would make cross-market comparison meaningful.
2. **Page 2/3 scope** — both pages are filtered to NO - Morrow Bank only. SE and FI have no equivalent product-level performance pages. The spec should decide whether to add them or keep NO-only.
3. **Agent vs Direct split** — the Page 4 bar chart segments by `ConsumerLoansDirectNorway` vs `ConsumerLoansAgentNorway` but Agent rows are all zero. If Agent channel is not active, these dimension values add visual clutter.
4. **Deposit treatment** — Deposit appears in Page 1 table (0 spend, 173 bookings in NO) and Page 4 bar chart. Client confirmed they are not interested in deposit campaigns. Consider whether Deposit should be filtered out or kept as a zero row for completeness.
5. **CAC vs MER labelling** — Page 2 includes a large explanatory text box distinguishing CAC from MER. This is valuable context but takes significant canvas space. Phase 1 spec should decide placement.
6. **Truncated column headers** — "Media Sp...", "actual_sa36..." — full names needed from the data source before building the spec.

---

*End of Phase 0 audit. Awaiting review before proceeding to Phase 1.*
