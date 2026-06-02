/**
 * Phở Points Credit Service
 * Updated for PRICING_MASTERPLAN.md.md
 */
import { eq, sql } from 'drizzle-orm';

import {
  canUseTier,
  getDailyRequestCap,
  getDailyTierLimit,
  getScientificSkillsLimit,
} from '@/config/pricing';
import { users } from '@/database/schemas';
import { usageLogs } from '@/database/schemas/usage';
import { getServerDB } from '@/database/server';
import { captureAiGeneration } from '@/libs/posthog-server';

export async function addPhoCredits(userId: string, amount: number) {
  try {
    const db = await getServerDB();
    await db
      .update(users)
      .set({
        lifetimeSpent: sql`${users.lifetimeSpent} + ${amount}`,
        phoPointsBalance: sql`${users.phoPointsBalance} + ${amount}`,
      })
      .where(eq(users.id, userId));

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Credits] Added Phở Points:', { amount, userId });
    }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error('❌ Failed to add Phở Points:', {
      amount,
      error: errorMessage,
      userId,
    });
    throw new Error(`Failed to add Phở Points: ${errorMessage}`);
  }
}

export async function getUserCreditBalance(userId: string) {
  try {
    const db = await getServerDB();
    const result = await db
      .select({
        balance: users.phoPointsBalance,
        currentPlanId: users.currentPlanId,
        dailyTier1Usage: users.dailyTier1Usage,
        dailyTier2Usage: users.dailyTier2Usage,
        dailyTier3Usage: users.dailyTier3Usage,
        lastUsageDate: users.lastUsageDate,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (result.length === 0) return null;
    return result[0];
  } catch (e) {
    console.error('❌ Failed to get user credit balance:', e);
    return null;
  }
}

export async function deductPhoCredits(userId: string, amount: number) {
  try {
    const db = await getServerDB();
    await db
      .update(users)
      .set({
        lastUsageDate: new Date(),
        phoPointsBalance: sql`GREATEST(0, ${users.phoPointsBalance} - ${amount})`,
      })
      .where(eq(users.id, userId));

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Credits] Deducted Phở Points:', { amount, userId });
    }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error('❌ Failed to deduct Pho credits:', {
      amount,
      error: errorMessage,
      userId,
    });
    // Don't throw here to avoid interrupting the response if possible
  }
}

export interface UsageLogParams {
  costUSD?: number;
  /**
   * PHO-231: feature label so PostHog can split spend by surface
   * (chat / embedding / artifact / summary / ...). Defaults to 'chat'.
   */
  feature?: string;
  inputTokens: number;
  model: string;
  outputTokens: number;
  // True when the stream aborted before completion. Counts what was already
  // consumed from the gateway so the user is debited for partial usage too —
  // otherwise mid-stream disconnects let users escape billing while the
  // gateway has already charged us.
  partial?: boolean;
  /**
   * PHO-246: resolved user plan ID. Caller passes the value already used to
   * authorize this request so PostHog `$ai_generation` events carry plan +
   * tier and cost can be sliced per plan / per tier. If omitted, the
   * capture path falls back to a DB lookup (logs a warning).
   */
  planId?: string;
  provider: string;
  responseTimeMs?: number;
  sessionId?: string;
  /**
   * PCFIX-4: time-to-first-token (ms) for streaming responses. Forwarded to
   * PostHog as `$ai_ttft_ms` so we can tell "stalled before first token" (high
   * TTFT) apart from "long stream" (low TTFT, high total). Undefined for
   * non-streaming paths where the full response is buffered before metering.
   */
  ttftMs?: number;
}

/**
 * Get today's date string in Vietnam timezone (UTC+7) for daily-counter comparison.
 * Used by both processModelUsage / atomicAcquireTierSlot and the daily-request-cap
 * check downstream — keeps every "is it the same VN day?" decision aligned.
 */
function getVietnamDateString(date: Date = new Date()): string {
  // UTC+7 (no DST in Vietnam): add 7 hours in milliseconds.
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().slice(0, 10);
}

/**
 * Process AI model usage: deduct Phở Points and log to usage_logs.
 *
 * PHO-237 (2026-05-03) — Token-based deduction: 1 Phở Point = $0.01 USD.
 *
 * Callers still pass `cost` as the LEGACY points-cost they compute themselves
 * (e.g. `(in × inPts/1M + out × outPts/1M)` from `model_pricing`). Internally
 * we convert to real USD via the documented seed ratio (1 pt ≈ $0.00004,
 * see `scripts/seed-model-pricing-gateway.ts:21`) and derive the actual
 * deduction from USD:
 *
 *     pointsDeducted = Math.ceil(costUSD × 100)   ⇔   Math.ceil(cost / 250)
 *
 * Effect (allocation unchanged — "stealth rebalance"):
 *   $0.01 call →     1 pt  (was ~250)         — light users feel generous
 *   $0.30 call →    30 pts (was ~7 500)
 *   $7.50 call →   750 pts (was ~187 500)     — heavy users self-regulate
 *   $15.00 call → 1 500 pts                   — expensive usage = expensive pts
 *
 * Free tier (Tier 1, first 5/day) still pays 0 — no forced minimum.
 * `usage_logs.cost_usd` continues to record the real USD per call so the
 * daily USD cap (PHO-238 / PR #46) keeps working unchanged.
 *
 * Decision: Hien approved 2026-05-03. Linear: PHO-237.
 */
export async function processModelUsage(
  userId: string,
  cost: number,
  tier: number = 1,
  tierSlotAlreadyAcquired: boolean = false,
  usageLog?: UsageLogParams,
) {
  try {
    const db = await getServerDB();
    const now = new Date();

    // PHO-237: legacy points-cost → real USD → token-based deduction.
    // Prefer caller-provided `usageLog.costUSD` (forward-compatible with future
    // per-model USD pricing); fall back to deriving from `cost` via the seed ratio.
    const costUSD = usageLog?.costUSD ?? cost / 25_000;
    const tokenBasedCost = Math.ceil(costUSD * 100);

    // 1. Get current user stats including all tier usage
    const userRows = await db
      .select({
        dailyTier1Usage: users.dailyTier1Usage,
        dailyTier2Usage: users.dailyTier2Usage,
        dailyTier3Usage: users.dailyTier3Usage,
        lastUsageDate: users.lastUsageDate,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userRows.length === 0) return;
    const user = userRows[0];

    // 2. Check for daily reset using Vietnam timezone (UTC+7).
    // PHO-228: previously compared via JS Date.getDate/Month/Year which on
    // Vercel resolves to UTC. Daily counters were resetting at 00:00 UTC
    // = 07:00 VN, giving every Vietnam user ~7h of "extra" daily quota each
    // morning. Now aligned with the rest of the billing path that already
    // uses getVietnamDateString (see checkDailyRequestCap).
    const todayVN = getVietnamDateString(now);
    const lastUsageVN = user.lastUsageDate
      ? getVietnamDateString(new Date(user.lastUsageDate))
      : '';
    const isSameDay = lastUsageVN === todayVN;

    // If not same day, reset all tier usage to 0
    let newTier1Usage = isSameDay ? user.dailyTier1Usage || 0 : 0;
    let newTier2Usage = isSameDay ? user.dailyTier2Usage || 0 : 0;
    let newTier3Usage = isSameDay ? user.dailyTier3Usage || 0 : 0;

    // 3. Track points actually deducted — used by the unified usage_logs insert below.
    //    PHO-237: defaults to `tokenBasedCost` (atomic-slot path); overwritten
    //    to `finalCost` (0 when free-tier waives) in the counter-update path.
    let pointsDeducted = tokenBasedCost;

    // 4. Branch: atomic-slot path (Tier 2/3) vs counter-update path (Tier 1 / fallback).
    //    PHO-224: BOTH branches now fall through to the usage_logs insert below.
    //    The previous early `return;` left every Tier 2/3 paid request invisible
    //    in usage_logs (points deducted but no log row).
    if (tierSlotAlreadyAcquired && (tier === 2 || tier === 3)) {
      // Atomic-slot path: tier counters are managed exclusively by atomicAcquireTierSlot()
      // in checkTierAccess(). Only deduct credits here; don't touch counters or lastUsageDate.
      if (tokenBasedCost > 0) {
        await db
          .update(users)
          .set({
            lifetimeSpent: sql`${users.lifetimeSpent} + ${tokenBasedCost}`,
            phoPointsBalance: sql`GREATEST(0, ${users.phoPointsBalance} - ${tokenBasedCost})`,
          })
          .where(eq(users.id, userId));
        console.log(
          `[Credits] Deducted ${tokenBasedCost} pts (Tier ${tier}, atomic slot, $${costUSD.toFixed(4)}). User: ${userId}`,
        );
      }
      // pointsDeducted already === tokenBasedCost (set above).
    } else {
      // Counter-update path: Tier 1 (with free-tier waiver) or non-slot fallback.
      // Free Tier: first FREE_TIER_LIMIT Tier 1 requests/day are zero-cost.
      const FREE_TIER_LIMIT = 5;
      let finalCost = tokenBasedCost;
      let isFree = false;

      switch (tier) {
        case 1: {
          if (newTier1Usage < FREE_TIER_LIMIT) {
            finalCost = 0; // Free!
            isFree = true;
          }
          newTier1Usage += 1;
          break;
        }
        case 2:
        case 3: {
          // Tier 2/3 counters are ONLY incremented by atomicAcquireTierSlot()
          // in checkTierAccess(). Do NOT increment here to avoid double-counting.
          // This was the root cause of the tier limit bypass bug.
          break;
        }
        // No default
      }

      // Update DB — only update tier1 counter + credits.
      // Tier 2/3 counters are managed exclusively by atomicAcquireTierSlot().
      // On day-reset (isSameDay=false), reset tier 2/3 to 0.
      const updatePayload: Record<string, any> = {
        dailyTier1Usage: newTier1Usage,
        lastUsageDate: now,
        lifetimeSpent: sql`${users.lifetimeSpent} + ${finalCost}`,
        phoPointsBalance: sql`GREATEST(0, ${users.phoPointsBalance} - ${finalCost})`,
      };
      if (!isSameDay) {
        // New day: reset tier 2/3 counters (atomicAcquireTierSlot will set to 1 on first use)
        updatePayload.dailyTier2Usage = 0;
        updatePayload.dailyTier3Usage = 0;
      }
      await db.update(users).set(updatePayload).where(eq(users.id, userId));

      if (process.env.NODE_ENV !== 'production') {
        if (isFree) {
          console.log(
            `[Credits] Free Tier used (${newTier1Usage}/${FREE_TIER_LIMIT}). Cost waived for user ${userId}.`,
          );
        } else if (finalCost > 0) {
          console.log(
            `[Credits] Deducted ${finalCost} pts (Tier ${tier}, $${costUSD.toFixed(4)}). T1=${newTier1Usage}, T2=${newTier2Usage}, T3=${newTier3Usage}. User: ${userId}`,
          );
        }
      }

      pointsDeducted = finalCost;
    }

    // NOTE: Redis sync removed — DailyTierRateLimiter.check() already
    // increments pho:ratelimit:* keys via checkTierAccess() in the chat route.
    // The duplicate INCR here was causing admin dashboard to show 2x actual usage.

    // PHO-237: monitoring log — searchable as `[billing] Points deducted` in
    // Vercel logs to verify the new formula is in effect post-deploy.
    console.log('[billing] Points deducted', {
      costUSD: costUSD.toFixed(4),
      formula: '1 point = $0.01 USD (Math.ceil(costUSD × 100))',
      legacyPointsCost: cost,
      model: usageLog?.model,
      pointsDeducted,
      tier,
      userId,
    });

    // 5. Log to usage_logs with actual model/tier/tokens (PHO-224: unified for BOTH branches).
    if (usageLog) {
      const VND_RATE = 24_167;
      // PHO-237: `costUSD` already computed at top; no fallback recomputation here.

      try {
        await db.insert(usageLogs).values({
          costUSD,
          costVND: costUSD * VND_RATE,
          inputTokens: usageLog.inputTokens,
          metadata: usageLog.partial ? { partial: true } : null,
          model: usageLog.model,
          modelTier: tier,
          outputTokens: usageLog.outputTokens,
          pointsDeducted,
          provider: usageLog.provider,
          responseTimeMs: usageLog.responseTimeMs ?? null,
          sessionId: usageLog.sessionId ?? null,
          totalTokens: usageLog.inputTokens + usageLog.outputTokens,
          userId,
        });
      } catch (logErr) {
        console.warn('⚠️ Failed to insert usage_logs:', logErr);
      }

      // PHO-231: emit $ai_generation to PostHog so the cost dashboard sees
      // every metered call (chat, embeddings, ...) — not just send_message.
      // PHO-246: forward `planId` (when caller passed it) and the resolved
      // `tier` so we can slice cost per plan / per tier in PostHog.
      // Fire-and-forget; observability must never block billing.
      captureAiGeneration({
        costPoints: pointsDeducted,
        costUSD,
        feature: usageLog.feature ?? 'chat',
        inputTokens: usageLog.inputTokens,
        latencyMs: usageLog.responseTimeMs,
        model: usageLog.model,
        outputTokens: usageLog.outputTokens,
        partial: usageLog.partial,
        planId: usageLog.planId,
        provider: usageLog.provider,
        tier,
        ttftMs: usageLog.ttftMs,
        userId,
      });
    }
  } catch (e) {
    console.error('❌ Failed to process model usage:', e);
  }
}

/**
 * Check if user can access Scientific Skills based on their plan
 */
export async function checkScientificSkillsAccess(
  userId: string,
  planId: string,
): Promise<TierAccessResult> {
  const dailyLimit = getScientificSkillsLimit(planId);

  if (dailyLimit === 0) {
    return {
      allowed: false,
      reason: '🔬 Scientific Skills yêu cầu gói Phở Tái trở lên. Nâng cấp để sử dụng.',
    };
  }
  if (dailyLimit === -1) {
    return { allowed: true, dailyLimit: -1 };
  }

  // Check daily usage via Upstash Redis (preferred) or in-memory fallback
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const today = new Date().toISOString().slice(0, 10);
    const redisKey = `pho:scientific:${userId}:${today}`;
    try {
      const resp = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/${redisKey}`, {
        headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      });
      const data = (await resp.json()) as { result: string | null };
      const currentUsage = data.result ? Number(data.result) : 0;
      const remaining = dailyLimit - currentUsage;

      if (remaining <= 0) {
        return {
          allowed: false,
          dailyLimit,
          reason: `🔬 Bạn đã dùng hết ${dailyLimit} lượt Scientific Skills hôm nay. Nâng cấp để có thêm.`,
          remaining: 0,
        };
      }
      return { allowed: true, dailyLimit, remaining };
    } catch {
      // Fall through to allow on Redis error
      return { allowed: true, dailyLimit };
    }
  }

  // No Redis = allow (fail open)
  return { allowed: true, dailyLimit };
}

/**
 * Increment Scientific Skills usage counter in Redis
 */
export async function incrementScientificSkillsUsage(userId: string): Promise<void> {
  if (!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)) return;
  const today = new Date().toISOString().slice(0, 10);
  const redisKey = `pho:scientific:${userId}:${today}`;
  try {
    await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/incr/${redisKey}`, {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      method: 'POST',
    });
    // Set TTL to 48 hours
    fetch(`${process.env.UPSTASH_REDIS_REST_URL}/expire/${redisKey}/172800`, {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      method: 'POST',
    }).catch(() => {
      /* silent */
    });
  } catch {
    /* silent */
  }
}

/**
 * Check if user can access a specific model tier based on their plan and daily limits
 * Returns: { allowed: boolean, reason?: string, remaining?: number }
 */
export interface TierAccessResult {
  allowed: boolean;
  dailyLimit?: number;
  reason?: string;
  remaining?: number;
  slotAcquired?: boolean;
}

/**
 * Build a plan-aware Vietnamese error message when a tier is fully blocked
 * (either disallowed by `allowedTiers` or has a daily cap of 0).
 */
function getTierBlockedReason(planId: string, tier: number): string {
  if (planId === 'medical_beta' && tier === 3) {
    return 'Gói Medical Beta (miễn phí) không hỗ trợ model Tier 3. Vui lòng nâng cấp lên gói Pro hoặc Ultimate.';
  }
  if (planId === 'vn_free' && tier >= 2) {
    return `Gói miễn phí không hỗ trợ model Tier ${tier}. Vui lòng nâng cấp để sử dụng.`;
  }
  return 'Model này yêu cầu gói cao hơn. Vui lòng nâng cấp để sử dụng.';
}

/**
 * Atomically acquire a daily tier usage slot using PostgreSQL conditional UPDATE.
 * Prevents race conditions by combining the check and increment in a single query.
 * If the UPDATE matches (returns rows), the slot was acquired.
 * If no rows returned, the daily limit has been reached.
 */
async function atomicAcquireTierSlot(
  userId: string,
  tier: 2 | 3,
  dailyLimit: number,
): Promise<{ acquired: boolean; error?: string; newUsage: number }> {
  const db = await getServerDB();

  try {
    if (tier === 3) {
      const result = await db.execute(sql`
        UPDATE users
        SET
          daily_tier3_usage = CASE
            WHEN (last_usage_date IS NULL OR (last_usage_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) THEN 1
            ELSE daily_tier3_usage + 1
          END,
          daily_tier2_usage = CASE
            WHEN (last_usage_date IS NULL OR (last_usage_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) THEN 0
            ELSE daily_tier2_usage
          END,
          daily_tier1_usage = CASE
            WHEN (last_usage_date IS NULL OR (last_usage_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) THEN 0
            ELSE daily_tier1_usage
          END,
          last_usage_date = NOW()
        WHERE id = ${userId}
          AND (
            (last_usage_date IS NULL OR (last_usage_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
            OR daily_tier3_usage < ${dailyLimit}
          )
        RETURNING daily_tier3_usage
      `);

      const rows = Array.isArray(result) ? result : (result as any).rows || [];
      if (rows.length > 0) {
        return { acquired: true, newUsage: Number(rows[0].daily_tier3_usage) };
      }
      return { acquired: false, newUsage: dailyLimit };
    }

    // Tier 2
    const result = await db.execute(sql`
      UPDATE users
      SET
        daily_tier2_usage = CASE
          WHEN (last_usage_date IS NULL OR (last_usage_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) THEN 1
          ELSE daily_tier2_usage + 1
        END,
        daily_tier3_usage = CASE
          WHEN (last_usage_date IS NULL OR (last_usage_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) THEN 0
          ELSE daily_tier3_usage
        END,
        daily_tier1_usage = CASE
          WHEN (last_usage_date IS NULL OR (last_usage_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) THEN 0
          ELSE daily_tier1_usage
        END,
        last_usage_date = NOW()
      WHERE id = ${userId}
        AND (
          (last_usage_date IS NULL OR (last_usage_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date < (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
          OR daily_tier2_usage < ${dailyLimit}
        )
      RETURNING daily_tier2_usage
    `);

    const rows = Array.isArray(result) ? result : (result as any).rows || [];
    if (rows.length > 0) {
      return { acquired: true, newUsage: Number(rows[0].daily_tier2_usage) };
    }
    return { acquired: false, newUsage: dailyLimit };
  } catch (e: any) {
    console.error('❌ atomicAcquireTierSlot failed', {
      error: e?.message,
      stack: e?.stack,
      tier,
      userId,
    });
    // PHO-227: Fail-CLOSED on DB error.
    // Was: return { acquired: true } → silent unlimited Tier 2/3 bypass on DB hiccup.
    // Now: return acquired:false → caller surfaces standard "tier cap reached" UX.
    // PostHog tracking + dedicated retry UX deferred to PHO-231 (Phase 2.3 observability).
    return { acquired: false, error: 'DB_ERROR', newUsage: 0 };
  }
}

export async function checkTierAccess(
  userId: string,
  tier: number,
  planId: string,
): Promise<TierAccessResult> {
  // canUseTier and getDailyTierLimit are statically imported at top

  // 1. Check if plan allows this tier at all
  if (!canUseTier(planId, tier)) {
    return {
      allowed: false,
      reason: getTierBlockedReason(planId, tier),
    };
  }

  // 2. Get daily limit for this tier
  const dailyLimit = getDailyTierLimit(planId, tier);

  if (dailyLimit === -1) {
    return { allowed: true, dailyLimit: -1, slotAcquired: false };
  }

  if (dailyLimit === 0) {
    return {
      allowed: false,
      dailyLimit: 0,
      reason: getTierBlockedReason(planId, tier),
    };
  }

  // 3. Tier 1 — no daily rate limiting (handled in processModelUsage free tier)
  if (tier === 1) {
    return { allowed: true, dailyLimit, slotAcquired: false };
  }

  // 4. Tier 2/3 — ATOMIC acquire: increment + check in single SQL query
  //    This prevents race conditions where concurrent requests bypass the limit.
  const { acquired, newUsage } = await atomicAcquireTierSlot(userId, tier as 2 | 3, dailyLimit);

  if (!acquired) {
    let reason: string;
    if (tier === 3) {
      reason =
        `⚠️ Bạn đã dùng hết ${dailyLimit} lượt Tier 3 hôm nay.\n\n` +
        `💡 Thử các model Tier 2 (không giới hạn hoặc giới hạn cao hơn):\n` +
        `• Claude Sonnet 4.6 — suy luận mạnh, coding xuất sắc\n` +
        `• Gemini 2.5 Pro — 2M context, Google Search\n` +
        `• GPT-5.2 — flagship OpenAI\n\n` +
        `🔄 Hạn mức reset lúc 0:00 mỗi ngày.`;
    } else {
      reason =
        `⚠️ Bạn đã dùng hết ${dailyLimit} lượt Tier 2 hôm nay.\n\n` +
        `💡 Thử các model Tier 1 (miễn phí không giới hạn):\n` +
        `• Mercury 2 ⚡ — siêu nhanh 1000+ tok/s\n` +
        `• Gemini 2.0 Flash — đáng tin cậy, multimodal\n` +
        `• Llama 4 Scout — MoE, multi-task mạnh\n` +
        `• Gemma 3 27B — tool calling xuất sắc\n\n` +
        `🔄 Hạn mức reset lúc 0:00 mỗi ngày.`;
    }

    return {
      allowed: false,
      dailyLimit,
      reason,
      remaining: 0,
      slotAcquired: false,
    };
  }

  console.log(`🔒 [Atomic Tier ${tier}] Slot acquired for ${userId}: ${newUsage}/${dailyLimit}`);

  return {
    allowed: true,
    dailyLimit,
    remaining: dailyLimit - newUsage,
    slotAcquired: true,
  };
}

// ============================================================================
// DAILY REQUEST CAP — Circuit breaker per user per day
// Uses existing tier counters from getUserCreditBalance() (no extra DB query)
// Resets at 00:00 UTC+7 (Vietnam timezone)
// ============================================================================

/**
 * Check if user has exceeded their daily request cap.
 * Uses the tier usage counters already fetched by getUserCreditBalance().
 * Returns { allowed, reason?, dailyRequestCap, totalUsedToday }.
 */
export function checkDailyRequestCap(
  creditStatus: NonNullable<Awaited<ReturnType<typeof getUserCreditBalance>>>,
  planId: string,
): TierAccessResult & { dailyRequestCap?: number; totalUsedToday?: number } {
  const cap = getDailyRequestCap(planId);

  // Check if lastUsageDate is the same day in Vietnam timezone
  const todayVN = getVietnamDateString();
  const lastDateVN = creditStatus.lastUsageDate
    ? getVietnamDateString(new Date(creditStatus.lastUsageDate))
    : '';

  // If different day (VN timezone), counters will be reset — allow
  if (lastDateVN !== todayVN) {
    return { allowed: true, dailyRequestCap: cap, totalUsedToday: 0 };
  }

  const totalUsedToday =
    (creditStatus.dailyTier1Usage || 0) +
    (creditStatus.dailyTier2Usage || 0) +
    (creditStatus.dailyTier3Usage || 0);

  if (totalUsedToday >= cap) {
    return {
      allowed: false,
      dailyRequestCap: cap,
      reason:
        `⚠️ Bạn đã đạt giới hạn ${cap} tin nhắn/ngày. ` +
        `Nâng cấp gói để sử dụng thêm.\n\n` +
        `🔄 Hạn mức reset lúc 0:00 (giờ Việt Nam).`,
      totalUsedToday,
    };
  }

  return { allowed: true, dailyRequestCap: cap, totalUsedToday };
}
