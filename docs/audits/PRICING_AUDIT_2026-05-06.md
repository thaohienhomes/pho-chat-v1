# Pricing System Audit — 2026-05-06

> **Mode:** Read-only audit, no code changes.
> **Branch:** `audit/bypass-payment-exploit` (audit session, no commits expected).
> **Scope:** v1 monorepo, plan_id literals across `src/` + `packages/`, payment integrations (Sepay, Polar), DB findings supplied by founder.
> **Author note:** This document is the input for a future cleanup sprint, not a remediation plan.

---

## A. Executive Summary

Phở Chat v1 has **three parallel pricing tables** that have drifted (`src/config/pricing.ts`, `src/server/services/billing/proration.ts`, `src/app/[variants]/(main)/subscription/checkout/Client.tsx`) plus a fourth one inside the wallet schema using a totally different naming scheme. Two plan IDs (`vn_standard`, `vn_ultra`) exist only inside the upgrade/proration code and are unreachable from any UI; one plan ID (`vn_team`) exists in pricing config + DB-default comments but at two different prices. Three lifetime tiers (`lifetime_early_bird`, `lifetime_standard`, `lifetime_last_call`) are wired in the Polar webhook + `VN_PLANS` UI features but **cannot be created through the documented checkout flow** — they only enter the DB through Polar product IDs that bypass `/subscription/checkout`. There is no auto-downgrade job: at least one expired `vn_ultimate` row is still `status='active'` past `currentPeriodEnd`. The `pho_wallet` table is fully unused, but its tier vocabulary (`vn_creator`, `global_standard`) leaked into a public schema and contradicts every other source of truth.

---

## B. Plan Inventory

Sources used in this table:

- **code (pricing.ts):** `src/config/pricing.ts` — `VN_PLANS`, `GLOBAL_PLANS`, `POLAR_PRODUCT_IDS`, `LEGACY_PLAN_MAPPING`.
- **code (proration.ts):** `src/server/services/billing/proration.ts` — `PLAN_PRICING`, `PLAN_TIERS`. Used by `/api/subscription/upgrade` and `/api/subscription/preview-upgrade`.
- **code (checkout client):** `src/app/[variants]/(main)/subscription/checkout/Client.tsx` — duplicate `plans` object hardcoded.
- **UI public:** `src/features/PricingCards/VietnamPricingCards.tsx`, `src/features/PricingCards/GlobalPricingCards.tsx`.
- **DB:** founder-supplied counts (16 paid users, 274 total, audit date 2026-05-06).

| plan_id                 | defined_in_file                                                                                                 | price_in_code                                                                        | price_in_DB tx (subscription rows)                       | price_in_UI (public)                                                                               | user_count                             | last_purchase_date | status                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vn_free`               | pricing.ts (VN_PLANS), proration.ts, checkout.Client.tsx                                                        | 0đ                                                                                   | n/a                                                      | not on monthly/yearly cards                                                                        | majority of 274 (default)              | —                  | **active** (default in `users.currentPlanId`)                                                                                                                                          |
| `vn_basic`              | pricing.ts, proration.ts, checkout.Client.tsx (also legacy `premium`→vn_basic)                                  | 69k mo / 690k yr                                                                     | matches                                                  | **NOT shown** in `VietnamPricingCards.monthlyPlans` or `yearlyPlans`                               | 1 (sepay)                              | (DB)               | **legacy active** — purchasable via legacy URL `?plan=premium`, hidden from main pricing grid                                                                                          |
| `vn_premium`            | pricing.ts, checkout.Client.tsx                                                                                 | 129k mo / 1.29M yr                                                                   | matches DB row                                           | shown as "Phở Bò Viên (Standard)" — popular badge                                                  | 1 (sepay)                              | (DB)               | **active** — UI advertises but **NOT in proration.ts**, so upgrades from/to vn_premium fall back to `\|\| 0` ⇒ proration math broken                                                   |
| `vn_pro`                | pricing.ts, proration.ts, checkout.Client.tsx                                                                   | 199k mo / 1.99M yr                                                                   | (no users in supplied data)                              | "Phở Đặc Biệt"                                                                                     | unknown (≤9 of 16 paid)                | —                  | **active**                                                                                                                                                                             |
| `vn_team`               | pricing.ts only                                                                                                 | **299k** (pricing.ts) vs **149k mo / 1.49M yr** (proration.ts)                       | none                                                     | NOT in any pricing card                                                                            | 0 (assumed)                            | —                  | **price-conflict / unsold** — two different prices in two files; no UI surface                                                                                                         |
| `vn_ultimate`           | pricing.ts, checkout.Client.tsx                                                                                 | 499k mo / 4.99M yr                                                                   | matches                                                  | "Phở Siêu Đặc Biệt" / "Phở Pro (Ultimate)" — naming differs between pricing.ts and checkout client | 2 (1 expired 2026-04-14, still ACTIVE) | (DB)               | **active but inconsistent** — not in proration.ts; expired row not auto-downgraded                                                                                                     |
| `vn_standard`           | proration.ts ONLY                                                                                               | 107.5k mo / 1.29M yr                                                                 | none                                                     | none                                                                                               | 0                                      | —                  | **orphan / phantom** — accepted by `/api/subscription/upgrade` (in `VALID_PLAN_IDS`) but cannot be checked out anywhere                                                                |
| `vn_ultra`              | proration.ts ONLY                                                                                               | 415.8k mo / 4.99M yr                                                                 | none                                                     | none                                                                                               | 0                                      | —                  | **orphan / phantom** — same as vn_standard; possibly a renamed pre-launch ID for vn_ultimate that was never deleted                                                                    |
| `medical_beta`          | pricing.ts (yearly-only 999k), proration.ts (adds fictional 83k monthly), checkout.Client.tsx, promo activation | 999k/yr (pricing.ts) vs 83k/mo + 999k/yr (proration.ts)                              | (excluded from "16 paid" count per founder)              | yellow medical badge in yearly tab only                                                            | unknown (excluded from paid count)     | —                  | **active** — promo-code activated, monthly price is **fictional** in proration.ts                                                                                                      |
| `gl_starter`            | pricing.ts, polar webhook (used as refund fallback)                                                             | $0                                                                                   | 1 user has `payment_provider='free'` (open question E.3) | "Free"                                                                                             | 1+                                     | —                  | **active**                                                                                                                                                                             |
| `gl_standard`           | pricing.ts, polar create + webhook                                                                              | $9.99/mo, $99.99/yr                                                                  | (no users in supplied data)                              | "Standard"                                                                                         | unknown                                | —                  | **active** (Polar)                                                                                                                                                                     |
| `gl_premium`            | pricing.ts, polar create + webhook                                                                              | $19.99/mo, $199.99/yr                                                                | (no users in supplied data)                              | "Premium"                                                                                          | unknown                                | —                  | **active** (Polar)                                                                                                                                                                     |
| `gl_lifetime`           | pricing.ts, polar create maps to legacy `ultimate` code                                                         | $149.99 one-time                                                                     | (no users in supplied data)                              | "Lifetime Deal"                                                                                    | unknown                                | —                  | **active but indirect** — Polar create route maps `gl_lifetime` → `ultimate` legacy code → `POLAR_PRODUCT_ULTIMATE_ID` env var. This is a different code path than `lifetime_*` plans. |
| `lifetime_early_bird`   | pricing.ts, polar webhook (env + hardcoded UUID `85158f39-…`)                                                   | $89 one-time                                                                         | 3 rows for ONE user (duplicate subs)                     | NOT in standard pricing cards; only `NewYearLifetimeBanner.tsx` references                         | 1 user × 3 rows                        | (DB)               | **active but unreachable via /subscription/checkout** — only enters via direct Polar product link                                                                                      |
| `lifetime_standard`     | pricing.ts, polar webhook (env + hardcoded UUID `01faa30d-…`)                                                   | $119 one-time                                                                        | matches                                                  | NOT in standard pricing cards                                                                      | 1 (DB)                                 | (DB)               | **active but unreachable via /subscription/checkout**                                                                                                                                  |
| `lifetime_last_call`    | pricing.ts, polar webhook (env + hardcoded UUID `646af452-…`)                                                   | $149.99 one-time                                                                     | matches                                                  | NOT in standard pricing cards                                                                      | 1 (DB)                                 | (DB)               | **active but unreachable via /subscription/checkout** — also receives `POLAR_PRODUCT_ULTIMATE_ID` traffic per webhook map                                                              |
| `free` (legacy)         | proration.ts only (alias)                                                                                       | 0đ                                                                                   | n/a                                                      | n/a                                                                                                | n/a                                    | —                  | **legacy** — only used in `LEGACY_PLAN_MAPPING`                                                                                                                                        |
| `premium` (legacy URL)  | checkout.Client.tsx, proration.ts, polar create                                                                 | maps to vn_basic in checkout, 69k in proration, "premium" in Polar                   | n/a                                                      | n/a                                                                                                | n/a                                    | —                  | **legacy alias** — `?plan=premium` resolves to vn_basic                                                                                                                                |
| `starter` (legacy URL)  | checkout.Client.tsx, proration.ts, polar create                                                                 | maps to vn_free in checkout, 0đ in proration                                         | n/a                                                      | n/a                                                                                                | n/a                                    | —                  | **legacy alias**                                                                                                                                                                       |
| `ultimate` (legacy URL) | checkout.Client.tsx, proration.ts, polar create                                                                 | maps to vn_pro in checkout, 199k in proration, `POLAR_PRODUCT_ULTIMATE_ID` for Polar | n/a                                                      | n/a                                                                                                | n/a                                    | —                  | **legacy alias** but **collides with `gl_lifetime`** in Polar — both go to `POLAR_PRODUCT_ULTIMATE_ID`                                                                                 |

### DB transactional totals (founder-supplied)

- **274** users total.
- **16** paid (non-free, non-medical_beta).
- Confirmed paid distribution in supplied data: 2 × vn_ultimate (1 expired 2026-04-14, still `status=active`), 1 × vn_premium, 1 × vn_basic, 3 × lifetime\_\* (one of which has 3 duplicate subscription rows for `lifetime_early_bird`).
- Remainder (≈9 paid) not categorized in the supplied data — likely a mix of `vn_pro` and `gl_*`.

---

## C. Naming Inconsistency

For each row: name as it appears in DB / UI / URL / Polar / SePay.

### C.1 Display name drift

| plan_id        | DB / `currentPlanId`                         | pricing.ts displayName       | Pricing card UI             | Checkout client name                       | Comment                                                                                                           |
| -------------- | -------------------------------------------- | ---------------------------- | --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `vn_basic`     | `vn_basic`                                   | "Phở Tái (Starter)"          | not displayed               | "Phở Tái" (also shown as legacy `premium`) | Three different forms of "Phở Tái".                                                                               |
| `vn_premium`   | `vn_premium`                                 | "Phở Bò Viên (Standard)"     | "Phở Bò Viên (Standard)"    | "Phở Bò Viên"                              | Public pricing labels this **Standard tier** while the URL slug is `vn_premium` — slug ≠ displayed tier semantic. |
| `vn_pro`       | `vn_pro`                                     | "Phở Đặc Biệt (Pro)"         | "Phở Đặc Biệt (Pro)"        | "Phở Đặc Biệt"                             | Adds USD price (`9.9`/mo, `99`/yr) ONLY in checkout client — does not match Polar pricing.                        |
| `vn_ultimate`  | `vn_ultimate`                                | "Phở Siêu Đặc Biệt (Ultra)"  | "Phở Siêu Đặc Biệt (Ultra)" | **"Phở Pro (Ultimate)"**                   | Cards say "Siêu Đặc Biệt", checkout says "Phở Pro" — same plan, two brand names.                                  |
| `vn_team`      | `vn_team`                                    | "Lẩu Phở (Team)"             | not displayed               | not displayed                              | Plan exists in code but no path for a customer to find it.                                                        |
| `medical_beta` | `medical_beta`                               | "Phở Medical Beta 🏥"        | "Phở Medical Beta 🏥"       | "Phở Medical"                              | Three slightly different names.                                                                                   |
| `gl_lifetime`  | n/a (handled as `lifetime_*` in DB? unclear) | "Founding Member (Lifetime)" | "Lifetime Deal"             | "Lifetime Deal"                            | "Founding Member" appears nowhere customer-facing.                                                                |

### C.2 Slug vs. tier-semantic mismatch

- `vn_premium` is internally **Standard tier** (1M points, "Phở Bò Viên" Standard) — but the slug suggests it's premium-tier.
- `vn_basic` is internally **Starter tier** (300k points, "Phở Tái Starter") — but the slug suggests basic-tier (which should map to free).
- `vn_pro` and `vn_ultimate` are correctly named relative to tier hierarchy, but `vn_team` (Team) is at the same tier (3) as `vn_pro` (Pro) in `PLAN_TIERS`, not above — a billing-only differentiator with zero marketing surface.

### C.3 Price display rounding mismatch

- `VN_PLANS.vn_ultimate`: monthly = 499,000đ; yearly = 4,990,000đ.
- `VietnamPricingCards.tsx` defaults to **monthly tab** ⇒ shows 499,000đ.
- `subscription/checkout/Client.tsx` defaults to **yearly cycle** (line 442: `useState('yearly')`) ⇒ first render shows 4,990,000đ.
- Result: customer clicks 499k card, lands on a 4,990k checkout page. This is the "10× discrepancy" the founder spotted; mathematically yearly = 10× monthly (no annual discount) but the UX flips the default cycle without warning.

### C.4 Polar / SePay product mapping inconsistency

- `src/app/api/payment/polar/create/route.ts` `VALID_POLAR_PLAN_IDS` accepts: `starter`, `premium`, `ultimate`, `gl_standard`, `gl_premium`, `gl_lifetime`. Map: `gl_lifetime` → `ultimate` legacy code → `POLAR_PRODUCT_ULTIMATE_ID`.
- `src/app/api/payment/polar/webhook/route.ts` accepts product IDs for: `gl_standard`, `gl_premium`, `lifetime_early_bird`, `lifetime_standard`, `lifetime_last_call`. **Plus a fourth env var** `POLAR_PRODUCT_ULTIMATE_ID` that is **also** mapped to `lifetime_last_call` in the webhook. So the same env var means "lifetime_last_call" on the webhook side and "ultimate (legacy `gl_lifetime`)" on the create side.
- Webhook also has **3 hardcoded UUID fallbacks** (`85158f39-…`, `01faa30d-…`, `646af452-…`) for existing lifetime customers. These bypass env vars entirely.
- `POLAR_PRODUCT_IDS` constant in `src/config/pricing.ts:998` exports placeholder strings (`'polar_prod_ltd_id'`, `'polar_prod_prem_id'`, `'polar_prod_std_id'`). Nothing imports it — dead export.
- `src/app/api/payment/sepay/create/route.ts` `planNames` accepts: `medical_beta`, `premium`, `starter`, `ultimate`, `vn_basic`, `vn_premium`, `vn_pro`, `vn_ultimate`. **Missing `vn_team`** — if anybody ever picked vn_team, the description would silently fall back to "Subscription Plan".
- `src/app/api/subscription/upgrade/route.ts` `VALID_PLAN_IDS` accepts: `vn_free`, `vn_basic`, `vn_standard`, `vn_pro`, `vn_team`, `vn_ultra`, `medical_beta`, plus legacy. **Missing `vn_premium` and `vn_ultimate`** — the two plan IDs actually sold via Sepay can't be used as upgrade targets through this endpoint.

### C.5 Tier-code vocabulary leak (wallet)

`packages/database/src/schemas/wallet.ts` `WALLET_TIER_CODES` = `['free', 'vn_basic', 'vn_creator', 'vn_pro', 'global_standard']`. Of those:

- `vn_creator` and `global_standard` exist nowhere else in the codebase.
- Comment on line 8 references "Tier Access Rules: 'free', 'vn_basic': Chat only, NO studio access; 'vn_creator', 'vn_pro', 'global_standard': Full studio access" — but the `VN_PLANS` Studio access flag is on `vn_pro` and `vn_ultimate`, not `vn_creator`/`global_standard`.
- The table itself (`pho_wallet`) is dead per founder DB findings (100% balance = 0).

---

## D. Architectural Issues

### D.1 Three wallet-like tables, only one alive

| Table / Column                                                         | Status                                      | Used by                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| `pho_wallet`                                                           | **dead** (100% balance = 0 per DB findings) | Schema imports + `syncWalletTier` references — but nothing reads `balance`     |
| `users.pho_points_balance`                                             | **active source of truth**                  | Sepay webhook sets this; chat consumption deducts here                         |
| `phoPointsBalances` (separate table, used by Polar lifetime allocator) | **active for lifetime users only**          | `src/app/api/payment/polar/webhook/route.ts:74-118` (`allocateLifetimePoints`) |
| `user_cost_settings.monthly_budget_points`                             | **unused** per founder                      | —                                                                              |

The Polar webhook writes to `phoPointsBalances` while the Sepay webhook writes to `users.phoPointsBalance` — two different storage paths for the same domain concept depending on how the user paid.

### D.2 Four sources of plan-tier authority

When server code asks "what plan does this user have?", it can read any of:

1. `users.currentPlanId` (column default `'vn_free'`).
2. `subscriptions.planId` (joined by `userId`).
3. Clerk `publicMetadata.planId` (synced by both webhooks, non-blocking — failures don't roll back).
4. `pho_wallet.tier_code` (dead but still written on `syncWalletTier`).

`getUserPlanFromDB()` — per memory `feedback_db_is_source_of_truth` — is the only authorized server-side path. But the existence of four writable surfaces means a partial sync failure (e.g. Clerk PATCH timeouts) leaves them divergent without any reconciliation job.

### D.3 No auto-downgrade job

DB finding: 1 user with `vn_ultimate` whose `currentPeriodEnd` is 2026-04-14 still has `status='active'` on 2026-05-06. There is no cron / scheduled job that:

- Flips `subscriptions.status` to `expired` when `currentPeriodEnd` < `now()`.
- Resets `users.currentPlanId` to `vn_free` / `gl_starter`.
- Re-runs `syncWalletTier`.
- Clears Clerk `publicMetadata.planId`.

The Polar refund handler does flip to `gl_starter`, but only when Polar emits an `order.refunded` event — not on natural expiry.

### D.4 Plan duplication across files

`vn_premium`, `vn_pro`, `vn_ultimate` are redefined as plain objects in `subscription/checkout/Client.tsx` lines 192–414, separate from `VN_PLANS` in pricing.ts. A founder could update pricing.ts and the checkout page would silently keep showing the old number. Same for legacy aliases `premium` / `starter` / `ultimate` which exist as full objects in checkout but only as string mappings in `LEGACY_PLAN_MAPPING`.

### D.5 Lifetime tiers unreachable via documented checkout

`/subscription/checkout?plan=lifetime_early_bird` returns "Invalid plan" because:

- `subscription/checkout/Client.tsx` `plans` map has no `lifetime_early_bird` / `lifetime_standard` / `lifetime_last_call` keys.
- `Polar create` `VALID_POLAR_PLAN_IDS` doesn't accept them either.

The 3 lifetime users in the DB must have arrived through direct Polar product links (e.g. `polar.sh/checkout/{product_id}`) — which means the only way to sell those plans today is to share a hand-crafted external URL. The webhook then maps the inbound product_id to the right plan_id.

### D.6 Two parallel pricing tables for upgrade math

`src/server/services/billing/proration.ts` `PLAN_PRICING` and `src/app/api/subscription/upgrade/route.ts` PLAN_PRICING are nearly-identical duplicates with one consequential difference: the upgrade route adds `medical_beta.monthly = 83_000` and `vn_team.monthly = 149_000` while pricing.ts has `vn_team.price = 299_000`. Whichever file the future maintainer edits, the other will silently stay stale.

---

## E. Open Questions for Founder

### E.1 Are `vn_premium` and `vn_ultimate` keepers?

- Public pricing cards list both as primary tiers, but neither is in `proration.ts` — upgrade flow can't quote a price for them. Either prune them from the UI or add them to proration. Which?

### E.2 Are the lifetime tiers (`lifetime_early_bird`, `lifetime_standard`, `lifetime_last_call`) still being sold?

- Only 3 customers total, and the only purchase path is a direct Polar URL (no checkout-page entry). If still selling: needs a checkout-page entry. If sunsetting: leave existing entitlements in place but remove from `VN_PLANS`/webhook accept list.

### E.3 The `gl_starter` user with `payment_provider='free'`

- DB finding: 1 user has `gl_starter` plan with `payment_provider='free'`. Is this a manual provisioning record, a residual from the legacy free flow, or a side-effect of the Polar `order.refunded` handler downgrading them to `gl_starter`? `/api/subscription/activate-free` exists for free plans but doesn't appear to set this provider value.

### E.4 `admin_upgrade` payment provider — is it documented?

- Greps for `admin_upgrade` come back empty in code, but founder mentioned it. If it's a DB-only convention used by a manual SQL script, that script and the convention need to be captured somewhere reproducible.

### E.5 `vn_team` price truth

- pricing.ts says 299k/mo; proration.ts says 149k/mo. No DB customers either way. Which is correct, and is `vn_team` actually a product we want to sell solo (no admin dashboard exists for pooled-points teams)?

### E.6 `vn_standard` and `vn_ultra` — phantom IDs

- These are ONLY in proration.ts (in `PLAN_PRICING` and `PLAN_TIERS` and `VALID_PLAN_IDS`). No UI surface, no checkout path, no DB customers. Were they pre-launch names for `vn_premium`/`vn_ultimate` that we forgot to delete?

### E.7 Duplicate lifetime subscription rows

- One `lifetime_early_bird` user has 3 active `subscriptions` rows. Is this a webhook idempotency bug (Polar replays?), a manual fixup gone wrong, or expected (e.g. one row per renewal even though "lifetime" implies one)?

---

## F. Recommended Cleanup Priority

> Order is by risk × ease, not by founder decision. Items in **P0** are correctness/revenue bugs visible today.

### P0 — fix before next pricing change

1. **Auto-downgrade expired subscriptions.** One `vn_ultimate` user currently has `status='active'` past `currentPeriodEnd`. Need a cron (Vercel cron or DB trigger) that flips status, resets `currentPlanId`, syncs Clerk metadata, and re-runs `syncWalletTier` once daily.
2. **Resolve the `vn_team` price conflict** between `pricing.ts` (299k) and `proration.ts` (149k). The cheaper file wins on every upgrade math; the more expensive file wins on every display.
3. **Add `vn_premium` and `vn_ultimate` to `proration.ts`.** Currently any prorated upgrade involving these plans falls back to `|| 0`, meaning a `vn_premium → vn_ultimate` upgrade is calculated as `0 - 0 = 0 VND` — free money for the user.
4. **De-duplicate lifetime subscription rows** for the affected user — and add a unique constraint on `(userId, planId)` for `lifetime_*` plans (or document why duplicates are intentional).
5. **Polar create + webhook product-ID collision** (`POLAR_PRODUCT_ULTIMATE_ID` means `gl_lifetime` on create-side and `lifetime_last_call` on webhook-side). Pick one; rename the env var on the other.

### P1 — cleanup before next major feature

6. **Delete phantom plan IDs** `vn_standard` and `vn_ultra` from `proration.ts` and from `upgrade/route.ts` `VALID_PLAN_IDS`, unless they're being kept as a hidden sales SKU (in which case they need a UI surface).
7. **Pick one source of truth for plan definitions.** Either: (a) make `subscription/checkout/Client.tsx` import from `VN_PLANS` like `VietnamPricingCards.tsx` already does, or (b) merge `proration.ts` `PLAN_PRICING` into `pricing.ts` so price/points/tier all live in one record.
8. **Reconcile `pho_wallet` tier vocabulary.** Either map its codes (`vn_creator`, `global_standard`) to real plans or drop the table outright since balance is 100% zero.
9. **Document the `lifetime_*` purchase path** — if these are being sold via direct Polar URLs, capture the URLs in a runbook so a teammate can ship the next sale without reverse-engineering env vars.
10. **Add `vn_team` and `vn_premium`/`vn_ultimate` to `sepay/create/route.ts` `planNames` map** — currently `vn_team` falls through to "Subscription Plan" in the description.
11. **Default checkout cycle** to `monthly` (or whichever the public pricing card defaults to) so the price doesn't 10× between click and checkout for `vn_ultimate`.

### P2 — nice-to-have / hygiene

12. **Drop the dead `POLAR_PRODUCT_IDS` placeholder export** in `src/config/pricing.ts:998`. Nothing imports it.
13. **Drop the dead `pho_wallet` table** + `syncWalletTier` writes (after confirming migration path for the 3 fields it owned: `tier_code`, `clerk_user_id`, `balance`).
14. **Drop `user_cost_settings.monthly_budget_points`** if confirmed unused.
15. **Unify display names** for `vn_basic` ("Phở Tái" vs "Phở Tái (Starter)") and `vn_ultimate` ("Phở Siêu Đặc Biệt (Ultra)" vs "Phở Pro (Ultimate)") — same plan should have one customer-facing brand.
16. **Decide about `medical_beta.monthly`** — pricing.ts treats it as yearly-only, proration.ts invents an 83k/mo price. Either expose monthly checkout for medical_beta or remove the fictional monthly from proration.
17. **Replace the 3 hardcoded UUIDs in `polar/webhook/route.ts:50-64`** with a documented one-time DB migration that re-keys those subscriptions to env-var-resolvable product IDs.

---

## Appendix — File index

Files read for this audit (all read-only):

- `src/config/pricing.ts` — primary plan definitions.
- `src/config/customizations.ts` — Sepay/Polar env var wiring.
- `packages/database/src/schemas/pricing.ts` — `transactions` + `modelPricing` schemas.
- `packages/database/src/schemas/wallet.ts` — dead `pho_wallet` schema.
- `packages/database/src/schemas/user.ts` — `users.currentPlanId` column comment.
- `src/app/[variants]/(main)/subscription/checkout/Client.tsx` — duplicate plans object.
- `src/app/[variants]/(main)/subscription/plans/features/PlansContent.tsx` — checkout URL builder.
- `src/features/PricingCards/VietnamPricingCards.tsx` — public VN pricing cards.
- `src/app/api/payment/polar/create/route.ts` — Polar checkout create.
- `src/app/api/payment/polar/webhook/route.ts` — Polar webhook + lifetime allocator.
- `src/app/api/payment/sepay/create/route.ts` — Sepay payment create.
- `src/app/api/payment/sepay/webhook/route.ts` — Sepay webhook.
- `src/libs/polar/index.ts` — Polar SDK wrapper.
- `src/libs/sepay/index.ts` — Sepay gateway wrapper.
- `src/app/api/subscription/upgrade/route.ts` — upgrade endpoint with second `PLAN_PRICING`.
- `src/server/services/billing/proration.ts` — proration math + canonical second `PLAN_PRICING`.
- `src/middleware.ts` — confirmation that `/subscription/checkout` is a public route.

Greps that informed counts:

- 49 files in `src/`, 5 files in `packages/`, contain plan_id literals (375 occurrences in `src/`, 12 in `packages/`).
- 7 files reference `POLAR_` env vars; 6 files reference Sepay product mapping.
- 16 files reference `paymentProvider` / `admin_upgrade`.
- 4 files import `PLAN_TIERS`/`calculateProratedAmount` (proration.ts, its test, upgrade/route.ts, preview-upgrade/route.ts).
