/**
 * Daily USD cost caps per plan per tier.
 *
 * When the user's total `usage_logs.cost_usd` for a given tier on the current
 * Vietnam day (Asia/Ho_Chi_Minh) reaches the cap, further requests against
 * that tier are blocked with HTTP 429 until the next VN midnight rollover.
 *
 * EMERGENCY FIX (PHO-238): a medical_beta user burned $26.40 in one hour on
 * Tier 3 because Phở Points balance is too generous (379K credits ≈ $760
 * budget for a FREE user) and per-call deduction does not keep pace with the
 * real per-call USD spend on expensive models. The Phở Points layer stays in
 * place; this cap is a hard ceiling underneath it.
 *
 * Caps are starting values — tune via `DAILY_CAP_{PLAN}_T{TIER}` env vars at
 * runtime without redeploy. Setting an env var to `0` blocks the tier; any
 * positive number raises/lowers the limit.
 */

export interface DailyCostCap {
  /** USD; 0 means tier is fully blocked for this plan */
  tier1: number;
  /** USD; 0 means tier is fully blocked for this plan */
  tier2: number;
  /** USD; 0 means tier is fully blocked for this plan */
  tier3: number;
}

const DEFAULT_CAPS: DailyCostCap = { tier1: 1, tier2: 0, tier3: 0 };

// IMPORTANT: every plan in `PLAN_MODEL_ACCESS` (src/config/pricing.ts) MUST have
// an entry here, kept in sync with that plan's `allowedTiers`:
//   - a tier the plan is NOT allowed to use stays at 0 (blocked);
//   - a tier the plan IS allowed to use MUST be > 0, otherwise the plan is
//     silently blocked from it (cap === 0 means "deny").
// Plans missing here fall back to DEFAULT_CAPS (tier2/3 = 0), which wrongly
// blocks paid Tier 2 plans — the bug this complete table guards against. Values
// are USD/day starting points and stay env-overridable via DAILY_CAP_{PLAN}_T{TIER}.
const PLAN_CAPS: Record<string, DailyCostCap> = {
  // Global lifetime / premium — Tier 1 & 2 only (no Tier 3)
  gl_lifetime: { tier1: 5, tier2: 10, tier3: 0 },

  gl_premium: { tier1: 5, tier2: 10, tier3: 0 },

  // Global standard — Tier 1 & 2 (30 T2 msgs/day)
  gl_standard: { tier1: 3, tier2: 5, tier3: 0 },

  // Free plans — Tier 1 only
  gl_starter: { tier1: 1, tier2: 0, tier3: 0 },

  // Lifetime deal plans — all tiers
  lifetime_early_bird: { tier1: 10, tier2: 10, tier3: 10 },

  lifetime_last_call: { tier1: 10, tier2: 10, tier3: 10 },

  lifetime_standard: { tier1: 10, tier2: 10, tier3: 10 },

  // PHO-238: T3 hard-blocked at $0 — medical_beta is FREE-tier and was burning $26/hr.
  // 2026-06 cost audit (PHO-287): the "~$22/day on Tier 2" burn that forced the
  // emergency $1 cap was NOT really a cap-value problem — it was the un-seeded-model
  // leak. claude-sonnet-4.6 had no model_pricing row, so it billed ~$0 and this USD
  // cap (which reads usage_logs.cost_usd) never saw the real spend. With that leak
  // fixed (seed + conservative fallback in the chat route), the USD cap is meaningful
  // again, so T2 is raised back to $3/day to unblock legit medical_beta usage.
  // Backstops still in place: atomic 30-msg/day Tier 2 limit + allowedTiers + T3=$0.
  medical_beta: { tier1: 5, tier2: 3, tier3: 0 },

  // VN basic (Phở Tái) — Tier 1 & 2 (30 T2 msgs/day)
  vn_basic: { tier1: 2, tier2: 3, tier3: 0 },

  vn_free: { tier1: 1, tier2: 0, tier3: 0 },

  // VN subscription plans — all tiers
  vn_premium: { tier1: 5, tier2: 5, tier3: 5 },

  vn_pro: { tier1: 5, tier2: 5, tier3: 5 },

  // VN team (pooled enterprise) — all tiers
  vn_team: { tier1: 10, tier2: 10, tier3: 10 },

  vn_ultimate: { tier1: 10, tier2: 10, tier3: 10 },
};

/**
 * Resolve the daily USD cap for `(planId, tier)`.
 *
 * Lookup order:
 *   1. Env override `DAILY_CAP_{UPPERCASE_PLAN}_T{TIER}` (e.g. `DAILY_CAP_MEDICAL_BETA_T3=1.00`).
 *   2. Static `PLAN_CAPS` table.
 *   3. `DEFAULT_CAPS` (matches vn_free — most restrictive).
 *
 * Returns 0 when the tier is fully blocked for this plan. Callers MUST treat
 * `cap === 0` as "deny" rather than "no cap".
 */
// Track which env overrides we've already logged so the warning below fires at
// most once per (process, env key) instead of on every request.
const loggedEnvOverrides = new Set<string>();

export function getDailyCostCap(planId: string, tier: number): number {
  const envKey = `DAILY_CAP_${planId.toUpperCase()}_T${tier}`;
  const envVal = process.env[envKey];
  if (envVal !== undefined && envVal !== '') {
    const parsed = Number.parseFloat(envVal);
    if (Number.isFinite(parsed) && parsed >= 0) {
      // Surface active env overrides once per process. A too-high override silently
      // masking the static cap is the leading hypothesis for why the medical_beta
      // $3 cap did not bite in the 2026-06 audit — make it visible in prod logs.
      if (!loggedEnvOverrides.has(envKey)) {
        loggedEnvOverrides.add(envKey);
        const staticCaps = PLAN_CAPS[planId] ?? DEFAULT_CAPS;
        const staticCap =
          tier === 1 ? staticCaps.tier1 : tier === 2 ? staticCaps.tier2 : staticCaps.tier3;
        console.warn('[billing] daily cost cap ENV OVERRIDE active', {
          envKey,
          overrideValue: parsed,
          staticCap,
        });
      }
      return parsed;
    }
  }

  const caps = PLAN_CAPS[planId] ?? DEFAULT_CAPS;
  switch (tier) {
    case 1: {
      return caps.tier1;
    }
    case 2: {
      return caps.tier2;
    }
    case 3: {
      return caps.tier3;
    }
    default: {
      return 0;
    }
  }
}

/**
 * Seconds remaining until the next midnight in Asia/Ho_Chi_Minh (UTC+7, no DST).
 * Used for `Retry-After` headers when a daily cap is hit so clients know when
 * the cap will reset.
 */
export function getSecondsUntilMidnightVN(now: Date = new Date()): number {
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
  const nextMidnightVnAsUtc = Date.UTC(
    vnNow.getUTCFullYear(),
    vnNow.getUTCMonth(),
    vnNow.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  const nextMidnightUtcMs = nextMidnightVnAsUtc - VN_OFFSET_MS;
  return Math.max(1, Math.ceil((nextMidnightUtcMs - now.getTime()) / 1000));
}

/**
 * UTC instant equivalent to "00:00 today in Vietnam (Asia/Ho_Chi_Minh)".
 * Lower bound for the SUM(cost_usd) aggregation in `dailyCostAggregation.ts`.
 *
 * Aligned with `atomicAcquireTierSlot()` (which uses Postgres
 * `(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`) and `getVietnamDateString()`
 * in `billing/credits.ts`. Vietnam has no DST so a fixed +7h offset is exact.
 */
export function getStartOfVietnamDayUTC(now: Date = new Date()): Date {
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
  const startOfVnDayAsUtc = Date.UTC(
    vnNow.getUTCFullYear(),
    vnNow.getUTCMonth(),
    vnNow.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  return new Date(startOfVnDayAsUtc - VN_OFFSET_MS);
}
