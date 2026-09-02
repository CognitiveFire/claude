# Conversion Paths — Data Model Assessment
**Date:** 2026-09-02  
**Author:** Apriil (Matthew Robinson) assisted by Claude  
**Status:** PHASE 0 — awaiting approval before any BigQuery or Looker Studio work

---

## Source file

`August26-ConversionPath_Loan.xlsx` — 92 loans, Norway, August 2026.  
One row per paid-out loan. Provided by Morrow Bank.

## Data origin (open question)

The file originates from a BigQuery table inside Morrow's warehouse, but the specific table/view name is not yet confirmed. **Action required:** confirm the source BQ table before Phase 1 so the view is built on top of it rather than on the uploaded spreadsheet.

## Current approach (Phase 0 decision)

For the initial Looker Studio build, the xlsx is used as a direct data source (uploaded file or Google Sheets). This makes the screen a snapshot of August 2026 only. No refresh until the BQ pipeline is connected.

**Implication:** every chart must carry a visible note that the data covers August 2026 only and does not update automatically.

---

## Proposed BigQuery landing model

### Raw table: `conversion_paths.conversion_path_loans_raw`

One row per paid-out loan. Direct ingest of the xlsx columns with no transformation. Types:

| Column | BQ type | Notes |
|---|---|---|
| `user_pseudo_id` | STRING | |
| `purchase_time_oslo` | TIMESTAMP | |
| `transaction_id` | STRING | Primary key |
| `product_id` | STRING | Renamed from `ID` |
| `product_name` | STRING | Renamed from `Name` |
| `loan_volume` | NUMERIC | Renamed from `LoanVolume` |
| `user_id` | STRING | |
| `application_status` | STRING | Empty in August data |
| `agent_application` | BOOL | |
| `full_conversion_path` | STRING | Raw path string |
| `campaign` | STRING | Last-touch campaign |
| `source` | STRING | Last-touch source |
| `medium` | STRING | Last-touch medium |
| `ingested_at` | TIMESTAMP | Load timestamp, added at ingest |

### View: `conversion_paths.v_conversion_path_loans`

All columns from raw table plus derived fields:

#### `first_touch` — STRING
Split `full_conversion_path` on ` > `, take first element.  
Where `full_conversion_path` is null or empty: `'Unattributed'`.  
Never null, never blank.

#### `last_touch` — STRING  
Split `full_conversion_path` on ` > `, take last element.  
Where `full_conversion_path` is null or empty: `'Unattributed'`.  
Never null, never blank.

#### `path_length` — INT64  
Count of ` > ` separators + 1 where path is non-empty.  
Where unattributed: `0`.

#### `is_multi_touch` — BOOL  
`path_length > 1`.

#### `channel_group` — STRING  
Derived from last-touch `source` and `medium`:

| Condition | Value |
|---|---|
| `source` contains `morrowbank.com` | `'Self-referral'` |
| `medium` = `'cpc'` | `'Paid search'` |
| `medium` = `'display'` OR source contains `dv360` | `'Display'` |
| `medium` = `'organic'` AND source contains `google` | `'Organic search'` |
| `medium` = `'organic'` | `'Organic search'` |
| `medium` = `'(none)'` AND source = `'(direct)'` | `'Direct'` |
| `medium` = `'email'` | `'Email'` |
| `medium` = `'referral'` | `'Referral'` |
| Path is blank/null | `'Unattributed'` |
| All other | `'Other'` |

Self-referral is checked first (before referral) so `morrowbank.com` sources never fall into Referral.

#### `is_paid_path` — BOOL  
`TRUE` if any element in `full_conversion_path` contains `'cpc'` or `'display'`.  
Uses REGEXP_CONTAINS on the full path string.

#### `product` — STRING  
Normalised from `product_name`:

| `product_name` value | `product` value |
|---|---|
| `'Annuity Loan'` | `'Consumer Loan'` |
| `'Refinance External'` | `'Refinance'` |
| anything else | `'Unmapped'` |

#### `volume_band` — STRING  

| Condition | Value |
|---|---|
| `loan_volume` < 10000 | `'Under 10k'` |
| `loan_volume` < 50000 | `'10–50k'` |
| `loan_volume` < 150000 | `'50–150k'` |
| `loan_volume` < 300000 | `'150–300k'` |
| `loan_volume` >= 300000 | `'300k+'` |

---

## Correctness checks (Phase 1 must pass all)

| Check | Expected |
|---|---|
| Total row count | 92 |
| SUM(loan_volume) | 7,658,197 NOK |
| Unattributed rows | 9 loans, 891,895 NOK |
| product = 'Consumer Loan' | 50 loans, 2,373,000 NOK |
| product = 'Refinance' | 42 loans, 5,285,197 NOK |
| last_touch = 'google / cpc' | 30 loans |
| last_touch = 'direct' | 23 loans |
| last_touch = 'google / organic' | 19 loans |
| is_multi_touch = TRUE | 22 loans |
| channel_group = 'Self-referral' | 3 loans |
| agent_application = TRUE | 14 loans |

---

## Open questions

1. **Source BQ table name** — what table does the bank export this from? Needed before Phase 1.
2. **Refresh cadence** — monthly manual pull or automated? Determines whether raw table needs a `month` partition key.
3. **`application_status` column** — empty in August. Will it populate in future months? If so, what values?
4. **`(not set)` product ID** — all 42 Refinance rows have `ID = '(not set)'`. Is this expected upstream or a tracking gap?

---

## Phase 0 decision required

Approve this model before Phase 1 begins. Changes to derived field logic after the view is built require a view rebuild and a re-run of all QA checks.
