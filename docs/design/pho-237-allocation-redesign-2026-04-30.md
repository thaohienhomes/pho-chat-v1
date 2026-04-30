# PHO-237 — Phở Points Allocation + Burn Rate Redesign

**Date:** 2026-04-30
**Author:** Claude (with Hien)
**Status:** Design doc only — no code changes. Decision required from Hien.

---

## 1. Current State

### 1.1 Plans + monthly allocations (from `src/config/pricing.ts`)

| Plan code      | Display                   | Price              | Points / mo        | Tier 2/day      | Tier 3/day | Notes                |
| -------------- | ------------------------- | ------------------ | ------------------ | --------------- | ---------- | -------------------- |
| `vn_free`      | Phở Không Người Lái       | 0 đ                | 50,000             | 0 (Tier 1 only) | 0          | No history           |
| `vn_basic`     | Phở Tái (Starter)         | 69k đ/mo           | 300,000            | 30              | 0          |                      |
| `vn_premium`   | Phở Bò Viên (Standard)    | 129k đ/mo          | 1,000,000          | ∞               | 20         |                      |
| `vn_pro`       | Phở Đặc Biệt (Pro)        | 199k đ/mo          | 2,000,000          | ∞               | 50         | + Studio             |
| `vn_team`      | Lẩu Phở (Team, ≥3 users)  | 299k đ/mo          | 2,000,000 (pooled) | ∞               | per spec   | Pooled               |
| `vn_ultimate`  | Phở Siêu Đặc Biệt (Ultra) | 499k đ/mo          | 5,000,000          | ∞               | 100        | + Studio + Priority  |
| `medical_beta` | Phở Medical Beta 🏥       | activated by promo | 1,000,000          | ∞               | 10         | Llama-3.1 default    |
| `gl_starter`   | Free (USD)                | $0                 | 50,000             | 0               | 0          |                      |
| `gl_standard`  | Starter (USD)             | $9.99/mo           | 300,000            | 30              | 0          |                      |
| `gl_premium`   | Premium (USD)             | $19.99/mo          | 2,000,000          | ∞               | 50         |                      |
| `gl_lifetime`  | Founding Member           | $149.99 once       | 2,000,000          | ∞               | per spec   | Chat only, no Studio |

**Daily request circuit breaker** (`DAILY_REQUEST_CAP` in `pricing.ts`):

| Plan                                     | Cap   | Comment                                         |
| ---------------------------------------- | ----- | ----------------------------------------------- |
| `vn_free` / `gl_starter`                 | 20    | strict                                          |
| `vn_basic` / `gl_standard`               | 100   |                                                 |
| `vn_premium`                             | 200   | (PHO-234: previously inverted with `vn_pro`)    |
| `vn_pro`                                 | 500   | (PHO-234)                                       |
| `vn_team` / `vn_ultimate` / `lifetime_*` | 1,000 |                                                 |
| `medical_beta`                           | 50    | "burning 71% of total cost" — already throttled |

### 1.2 Per-tier burn rates (from `scripts/seed-model-pricing*` USD/1M tokens)

| Tier | Models (representative)                 | Input USD/1M  | Output USD/1M | Indicative cost / 1k-token chat turn |
| ---- | --------------------------------------- | ------------- | ------------- | ------------------------------------ |
| 1    | gemini-2.5-flash, gemini-3-flash        | $0.30 – $0.50 | $2.50 – $3.00 | \~$0.003                             |
| 2    | gemini-2.5-pro, claude-sonnet-4.5       | $1.25 – $3.00 | $10 – $15     | \~$0.012                             |
| 3    | gemini-3.1-pro-preview, claude-opus-4.6 | $2.00 – $5.00 | $12 – $25     | \~$0.025                             |

(One Phở Point ≈ $0.00004 USD per the fallback in `credits.ts:245`. So
2,000,000 points ≈ $80 USD ≈ \~2,000,000 ÷ 25 ≈ 80k Tier-3 turns or
\~26M Tier-1 turns.)

### 1.3 What Phase 2 already changed

- **PHO-225/228** — pre-flight check + Vietnam-tz daily reset.
- **PHO-224** — usage_logs hole closed for Tier 2/3 atomic-slot path.
- **PHO-230** — mid-stream abort billing.
- **PHO-234** — `vn_premium` / `vn_pro` Tier 3 cap inversion fixed.
- **PHO-229** — embedding metering (3 sites).
- **PHO-232** — PostHog browser exception autocapture.
- **PHO-231** — PostHog server-side `$ai_generation` events.

So as of this PR every billable LLM call (chat + embedding) deducts
points and emits a PostHog event. The **measurement layer is now
trustworthy** — we can finally redesign allocation against real numbers.

---

## 2. Problems with the current model

| #   | Problem                                                                                                                                                  | Evidence                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P1  | Free plan can hit 50k points fast on a bad day                                                                                                           | One Tier-3-by-mistake = \~25k pts. Two = empty wallet.      |
| P2  | `vn_basic` blocks Tier 3 entirely but allocates 300k points for Tier 1+2 only — points partly unused                                                     | Most Tier 1+2 traffic costs <100k pts/mo for typical users. |
| P3  | `vn_premium` (1M pts, 129k đ) and `gl_premium` (2M pts, $19.99) — same approximate USD price, 2× points spread                                           | Cross-currency parity drift.                                |
| P4  | No soft cap: at 0 points the user is hard-blocked even mid-session                                                                                       | UX cliff. PHO-225 added pre-flight, but 0 still blocks.     |
| P5  | Daily request cap and monthly point cap are independent — a user on `vn_pro` can drain 2M points in 24h via Tier 3 abuse and still be inside the 500-cap | Abuse path.                                                 |
| P6  | `medical_beta` allocation (1M pts, 10 T3/day) was the "burning 71% of total cost" plan — current throttle is reactive, not designed                      | Already noted in code.                                      |
| P7  | `vn_team` "pooled 2M" is confusing — same number as `vn_pro` but split across ≥3 users                                                                   | Per-user that is 666k, weaker than `vn_premium`.            |

---

## 3. Three proposed redesigns

The columns in each option mean:

- **Pts/mo**: monthly point allocation.
- **T2/T3 day**: hard daily caps for Tier 2 / Tier 3 messages (`-1` = unlimited).
- **Soft cap %**: how much over the monthly allocation a paid user can
  spend before being soft-blocked (see §4).

### Option 1 — Conservative (minimum change, fix outliers only)

| Plan           | Pts/mo (was → new) | T2/day | T3/day | Soft cap % |
| -------------- | ------------------ | ------ | ------ | ---------- |
| `vn_free`      | 50k → 30k          | 0      | 0      | 0 (hard)   |
| `vn_basic`     | 300k → 200k        | 30     | 0      | 0 (hard)   |
| `vn_premium`   | 1.0M → 1.0M        | -1     | 20     | 10         |
| `vn_pro`       | 2.0M → 2.0M        | -1     | 50     | 15         |
| `vn_ultimate`  | 5.0M → 5.0M        | -1     | 100    | 20         |
| `medical_beta` | 1.0M → 600k        | -1     | 10     | 0          |

**Rationale:** Tightens free + medical_beta where the loss is concentrated.
Keeps paid plans untouched so existing users don't churn.

### Option 2 — Aggressive (cost-optimal)

| Plan           | Pts/mo (was → new) | T2/day | T3/day | Soft cap % |
| -------------- | ------------------ | ------ | ------ | ---------- |
| `vn_free`      | 50k → 20k          | 0      | 0      | 0 (hard)   |
| `vn_basic`     | 300k → 150k        | 20     | 0      | 0 (hard)   |
| `vn_premium`   | 1.0M → 800k        | 200    | 15     | 10         |
| `vn_pro`       | 2.0M → 1.5M        | -1     | 40     | 15         |
| `vn_ultimate`  | 5.0M → 3.5M        | -1     | 80     | 20         |
| `medical_beta` | 1.0M → 400k        | 100    | 8      | 0          |

**Rationale:** Aligns each plan's points budget with median observed
burn (assuming user's audit numbers). Maximises gross margin.
Risk: existing paid users see "less for the same money" → churn.

### Option 3 — Recommended (balanced) ★

| Plan           | Pts/mo (was → new)              | T2/day | T3/day   | Soft cap % |
| -------------- | ------------------------------- | ------ | -------- | ---------- |
| `vn_free`      | 50k → 25k                       | 0      | 0        | 0 (hard)   |
| `vn_basic`     | 300k → 250k                     | 30     | 0        | 0 (hard)   |
| `vn_premium`   | 1.0M → 1.0M                     | -1     | 20       | 10         |
| `vn_pro`       | 2.0M → 2.5M ★                   | -1     | 60 ★     | 15         |
| `vn_ultimate`  | 5.0M → 5.0M                     | -1     | 100      | 25         |
| `vn_team`      | 2.0M pooled → 3.5M pooled       | -1     | per spec | 15         |
| `medical_beta` | 1.0M → 500k                     | -1     | 8        | 0          |
| `gl_*`         | (mirror Vietnam plans by ratio) |        |          |            |

**Rationale:**

- **Plug the leaks**: `vn_free`, `vn_basic`, `medical_beta` are the
  unprofitable plans → tighten.
- **Premium stays the same**: it's the volume entry plan, churn-sensitive.
- **Pro gets a bonus**: 2.0M → 2.5M and 50 → 60 T3/day. This is a
  positive marketing message ("Pro upgrade — now even better") and
  recovers some of the perceived value lost when free/basic shrink.
- **Ultimate keeps its allocation**: it's already over-spec'd, point is
  signalling not consumption.
- **Soft caps**: paid plans ramp gracefully; free + medical_beta still
  hard-cap because they cost us money on every byte.

★ marks the changes from current state.

---

## 4. Soft cap mechanism (applies to all three options)

When a paid user crosses **monthly_points × (100% + soft_cap\_%)**:

1. Continue serving requests for the remainder of the calendar month.
2. Show a banner: "You're at 110% of your Pro allocation. Upgrade to
   Ultimate for X more points / mo."
3. Gate Tier 3 specifically (Tier 1 + 2 still flow). Reasoning: Tier 3
   is the only thing that can blow a budget; Tier 1 is essentially free.
4. Email at 100%, 110%, 130%.
5. Hard block at **monthly_points × 200%** as a circuit breaker — at
   that point the user is either abusing or has a runaway script.

Free + `medical_beta` keep the current hard-block behaviour; soft cap
only makes sense when there is revenue offsetting the over-spend.

---

## 5. Decision questions for Hien

1. **Which option (1 / 2 / 3) — and is there a deadline tied to a comms
   plan (e.g. announce alongside a "we improved Pro" marketing beat)?**
2. **Soft cap percentages** — are 10 / 15 / 20–25 % the right tiers, or
   do you want them flatter (all 15 %) for simplicity?
3. **Grace period** — once a user crosses the soft cap, do we keep
   serving until end-of-month or until the next billing date?
4. **Grandfather existing users** — if Option 2 or 3 reduces an existing
   user's allocation, do we keep their old number for the current
   billing cycle? Recommended: yes for paid plans, no for free.
5. **Studio vs. Chat split** — point pool is currently shared. Do we
   want a separate `monthlyImagePoints` so a user who burns Studio
   doesn't also lose Chat capacity?

---

## 6. Implementation outline (only after Hien picks an option)

1. Update constants in `src/config/pricing.ts` (`VN_PLANS`, `GLOBAL_PLANS`,
   `DAILY_REQUEST_CAP`, plus a new `SOFT_CAP_PCT` map).
2. Update Clerk metadata templates so new signups inherit the new caps.
3. Add a soft-cap branch to `processModelUsage` /
   `checkDailyRequestCap`. Hard block stays the existing `GREATEST(0,
balance - cost)` SQL; soft cap is a new "near-zero" warning state in
   the API response, surfaced by the chat UI.
4. Update the user-facing pricing page (`src/features/PricingCards/*`).
5. Migration script for existing users — re-stamp `monthlyPoints` based
   on new mapping. Grandfather rule from §5 Q4 applies.
6. Email sequence templates (100 % / 110 % / 130 %).

Estimated scope: \~6 files, no schema migration needed (allocation is
read from config, not stored on the user row).

---

## 7. References

- `docs/audit/cost-phase-2-implementation-plan.md`
- `docs/audit/cost-audit-phase-2-2026-04-28.md`
- `src/config/pricing.ts`
- `src/server/services/billing/credits.ts`
- `scripts/seed-model-pricing*` (per-model USD pricing source of truth)
