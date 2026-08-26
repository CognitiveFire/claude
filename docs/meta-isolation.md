# Meta account isolation

**Status: specification only. There is no Meta adapter in this codebase.**

No code path can reach Meta, so no code path can spend money. That is the
strongest protection available during milestones one and two, and it is the
current state. `META_WRITE_ENABLED` defaults to `false` and must stay false
until the mechanisms below are built and the approvals are pinned.

`ia meta:status` prints the live state of all of this.

## The requirement

The system must interact exclusively with the personal Meta identity whose
expected login label is `Robinson.matthew@gmail.com`.

It must never interact with Apriil, Apriil Digital, N60 GROUP, or any Meta
asset owned by them or by any employer/client account — no Business Manager,
ad account, Page, Instagram account, Pixel or Dataset.

## Two corrections to the naive reading

### 1. The identity is pinned to an ID, not the email

An email address cannot be the runtime identity check. Meta's Graph API does
not reliably return the login email of the authenticated user, and an email is
not a stable authorisation key. Pinning to it would also be exactly the
"identify assets by name alone" failure the requirement itself prohibits.

So the email is a **human label**, used once during setup so the operator can
confirm they are looking at the right consent screen. The **runtime pin** is
the app-scoped user ID that `/me` returns at first authorised setup, stored as
`META_APPROVED_USER_ID` and in `meta_identity.approved_user_id`. Every
subsequent call re-reads `/me` and fails closed on mismatch.

That ID is scoped to the Meta app. If the app is ever recreated the pin must be
deliberately re-established — which is correct behaviour, not an inconvenience.

### 2. Restrict at grant time, not only in code

Guards inside the application are the *second* line of defence. If the personal
identity is an admin on an Apriil Business Manager — likely, if Apriil is the
employer — then a broadly granted `ads_management` token is *technically
capable* of spending Apriil money, and only our code stands between the two.

The first line is Meta's own OAuth consent screen, which lets the granting user
choose **which specific businesses, ad accounts, Pages and Pixels** an app may
access. Granting only the Indie Archive assets makes Apriil assets unreachable
by the token at all: the blast radius becomes zero by construction rather than
by the correctness of our code.

Setup must therefore require confirmation that the grant was restricted, and
must refuse to proceed if enumeration returns any Apriil-owned business — that
would mean the grant was too broad.

## Enforcement, five layers

1. **Grant-time restriction.** Apriil assets absent from the token entirely.
2. **Deny-by-default allowlist.** Only IDs explicitly mapped during setup are
   usable. Any other ID is refused regardless of what it is called, who owns
   it, or whether it is accessible. There is no code path that discovers an
   asset and then uses it.
3. **ID-based business denylist.** At setup the operator marks the Apriil-owned
   businesses; their **IDs** are stored permanently denied
   (`meta_denied_businesses`). Any asset whose owning business resolves to a
   denied ID is refused — so an Apriil asset that is later renamed, or moved,
   still trips the guard.

   Name-matching on "Apriil" / "Apriil Digital" / "N60" is used **only** to
   render the `DO NOT USE — APRIIL ASSET` label and make the row unselectable.
   It is a UX aid, never a security control: a renamed asset would evade it,
   which is precisely why the allowlist and the business-ID denylist carry the
   actual weight.
4. **Single chokepoint in the Meta HTTP client.** Every outbound request passes
   one function that extracts any `act_<id>`, Page ID, Instagram account ID and
   Pixel/Dataset ID from the path, query and body, and rejects the request
   unless each appears in `meta_asset_approvals`. Guards in a service layer are
   bypassable by a future code path; a guard in the only HTTP client is not.
   The same chokepoint rejects mutating methods while `META_WRITE_ENABLED` is
   false.
5. **Spend preflight and audit.** Before any campaign create, activate or
   budget change: re-verify authenticated user ID, business ID, ad account ID
   and Pixel/Dataset against the approvals, then write a
   `meta_spend_preflight_log` row — authenticated user, business, ad account,
   campaign, operation, timestamp, and a **token fingerprint** (a short hash),
   never the token. Any failing check raises and stops. No retry against
   another asset, no fallback, no closest match.

## The setup flow

A one-time CLI command, `ia meta:setup` — not a web dashboard.

- Opens the Meta OAuth consent URL and receives the code on a short-lived
  **loopback** listener on `127.0.0.1`, exchanging it server-side. The token
  never touches a browser context, so "no client-side JavaScript, no local
  storage" holds structurally rather than by discipline.
- Enumerates businesses, ad accounts, Pages, Instagram accounts and
  Pixels/Datasets, printing for each: **asset type, name, Meta ID, owning
  Business Manager, and access relationship** (owned vs. agency/partner).
- Renders Apriil-matching rows as `DO NOT USE — APRIIL ASSET`, unselectable.
- Requires explicit selection of each Indie Archive asset, by ID, one at a
  time. No defaults, no "first available", and no auto-select even when exactly
  one candidate exists — that last case is where an auto-select would
  eventually bite.
- Writes the approvals and prints a summary for confirmation. Nothing is stored
  until the operator confirms.

Likely wrinkle to confirm at enumeration rather than assume: for Conversions
API purposes the web Pixel ID and the dataset ID are generally the same
identifier, so config should accept them resolving to one value rather than
demanding two distinct IDs.

## Credentials

- Never store the Meta password. OAuth only.
- Tokens live in the deployment platform's secret store, **not** in Postgres,
  not in `.env` committed anywhere, not in the repository.
- Postgres stores only asset IDs and the token fingerprint.
- The logger redacts on token value and on `access_token`-style key names, on
  error paths too.
- Long-lived user tokens expire. Expiry fails closed with an instruction to
  re-run `ia meta:setup` — never a silent degradation.

## Campaign state machine

```
DRAFT → APPROVED → LIVE → PAUSED → KILLED
```

No campaign may spend without a stored `APPROVED` state. The `campaigns` table
carries `state`, `approved_at`, `approved_by` and the bound
`meta_ad_account_id`, so approval is a durable fact rather than a runtime
decision.

## Outside the system — only the operator can do these

1. **Create the Indie Archive Meta assets under the personal identity** —
   Business Manager, ad account, Page, Instagram account, Pixel — separate from
   anything Apriil-owned. Reusing an existing personal Page that is linked into
   an Apriil business would defeat the isolation.
2. **Billing.** The Indie Archive ad account needs its **own payment method**.
   If it inherits an Apriil-owned payment method, spend lands on the employer's
   billing regardless of how clean the asset isolation is. Also set an
   **account-level spend limit** on that ad account at or near the test budget:
   a hard backstop enforced by Meta, independent of this code being correct.

## The principle

The system must never reason "this Meta account is available, therefore we can
use it."

It reasons: "this authenticated personal identity has explicitly authorised
this specific Indie Archive asset, therefore we may use it."
