/**
 * Daily USD cost aggregation + cap-check helper.
 *
 * Reads `usage_logs.cost_usd` (already populated by `processModelUsage()` on
 * every metered AI call) and compares against the configured daily cap from
 * `dailyCostCaps.ts`.
 *
 * Used as a pre-flight check before issuing AI calls in:
 *  - `src/app/(backend)/webapi/chat/[provider]/route.ts`
 *  - `src/app/api/artifact-ai/route.ts`
 *  - `src/app/api/research/ai-summary/route.ts`
 */
import { and, eq, gte, sql } from 'drizzle-orm';

import { usageLogs } from '@/database/schemas/usage';
import { getServerDB } from '@/database/server';

import { getDailyCostCap, getStartOfVietnamDayUTC } from './dailyCostCaps';

export interface DailyCostCapCheckResult {
  allowed: boolean;
  /** Configured cap in USD for this (plan, tier). 0 = tier blocked. */
  dailyCostCap: number;
  /** Total USD already spent today against this tier. */
  dailyCostUsed: number;
  /** Vietnamese user-facing message when blocked. */
  reason?: string;
  /** Machine-readable code so callers / observability can branch. */
  reasonCode?: 'TIER_BLOCKED' | 'DAILY_CAP_EXCEEDED';
}

/**
 * Sum `cost_usd` from `usage_logs` for the user / tier / current Vietnam day.
 *
 * Returns 0 on DB error (fail-OPEN). Rationale: the chat path also has the
 * Phở Points pre-flight, atomic tier-slot acquire, and post-call billing —
 * one failed read here only allows ONE extra request through before the
 * cap recomputes from the new log row, while a fail-CLOSED would brick all
 * chat on a brief Postgres hiccup.
 */
export async function getDailyTierCostUSD(userId: string, tier: number): Promise<number> {
  try {
    const db = await getServerDB();
    const startOfDayUTC = getStartOfVietnamDayUTC();

    const rows = await db
      .select({ totalCost: sql<number>`COALESCE(SUM(${usageLogs.costUSD}), 0)` })
      .from(usageLogs)
      .where(
        and(
          eq(usageLogs.userId, userId),
          eq(usageLogs.modelTier, tier),
          gte(usageLogs.createdAt, startOfDayUTC),
        ),
      );

    // pg `numeric` may come back as string depending on driver; coerce.
    const raw = rows[0]?.totalCost;
    const num = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw ?? 0);
    return Number.isFinite(num) && num > 0 ? num : 0;
  } catch (e) {
    console.warn('[billing] getDailyTierCostUSD failed — failing OPEN', {
      error: e instanceof Error ? e.message : String(e),
      tier,
      userId,
    });
    return 0;
  }
}

/**
 * Check whether the user can issue another request against `tier` today.
 *
 * Returns:
 *  - `{ allowed: true,  ... }` when usage is below the cap.
 *  - `{ allowed: false, reasonCode: 'TIER_BLOCKED', ... }` when cap is 0
 *    (this plan never gets to use this tier).
 *  - `{ allowed: false, reasonCode: 'DAILY_CAP_EXCEEDED', ... }` when usage
 *    has reached/exceeded the cap.
 *
 * Side-effect free: pure read, safe to run before `checkTierAccess()`'s
 * atomic slot increment so we don't burn a tier slot on a blocked request.
 */
export async function checkDailyCostCap(
  userId: string,
  planId: string,
  tier: number,
): Promise<DailyCostCapCheckResult> {
  const dailyCostCap = getDailyCostCap(planId, tier);

  if (dailyCostCap <= 0) {
    return {
      allowed: false,
      dailyCostCap,
      dailyCostUsed: 0,
      reason: `Gói hiện tại của bạn không có quyền dùng model Tier ${tier}. Vui lòng nâng cấp để sử dụng.`,
      reasonCode: 'TIER_BLOCKED',
    };
  }

  const dailyCostUsed = await getDailyTierCostUSD(userId, tier);

  // Opt-in observability: flip DEBUG_COST_CAPS=1 to confirm in prod logs that this
  // cap check actually runs for a given user/tier and what cap vs used it resolved.
  if (process.env.DEBUG_COST_CAPS === '1') {
    console.log('[billing] cost cap check', { dailyCostCap, dailyCostUsed, planId, tier, userId });
  }

  if (dailyCostUsed >= dailyCostCap) {
    console.warn('[billing] DAILY CAP HIT', {
      dailyCostCap,
      dailyCostUsed: dailyCostUsed.toFixed(4),
      planId,
      tier,
      userId,
    });

    return {
      allowed: false,
      dailyCostCap,
      dailyCostUsed,
      reason:
        `⚠️ Bạn đã dùng hết hạn mức Tier ${tier} hôm nay ` +
        `($${dailyCostUsed.toFixed(2)}/$${dailyCostCap.toFixed(2)}). ` +
        `Vui lòng dùng model Tier thấp hơn hoặc thử lại sau 0:00 (giờ Việt Nam).`,
      reasonCode: 'DAILY_CAP_EXCEEDED',
    };
  }

  return { allowed: true, dailyCostCap, dailyCostUsed };
}
