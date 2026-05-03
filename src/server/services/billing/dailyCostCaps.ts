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

const PLAN_CAPS: Record<string, DailyCostCap> = {
  // Lifetime plans
  lifetime_early_bird: { tier1: 10, tier2: 10, tier3: 10 },

  lifetime_last_call: { tier1: 10, tier2: 10, tier3: 10 },

  lifetime_standard: { tier1: 10, tier2: 10, tier3: 10 },

  // Promo / beta plans
  // PHO-238: T3 hard-blocked at $0 — medical_beta is FREE-tier and was burning $26/hr.
  // Defense-in-depth: also blocked via PLAN_MODEL_ACCESS.allowedTiers + dailyTier3Limit=0.
  medical_beta: { tier1: 5, tier2: 3, tier3: 0 },

  vn_free: { tier1: 1, tier2: 0, tier3: 0 },

  vn_premium: { tier1: 5, tier2: 5, tier3: 5 },
  // Subscription plans
  vn_pro: { tier1: 5, tier2: 5, tier3: 5 },
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
export function getDailyCostCap(planId: string, tier: number): number {
  const envKey = `DAILY_CAP_${planId.toUpperCase()}_T${tier}`;
  const envVal = process.env[envKey];
  if (envVal !== undefined && envVal !== '') {
    const parsed = Number.parseFloat(envVal);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
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
