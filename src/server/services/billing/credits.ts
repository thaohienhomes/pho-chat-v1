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
  inputTokens: number;
  model: string;
  outputTokens: number;
  provider: string;
  responseTimeMs?: number;
  sessionId?: string;
}

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

    // 2. Check for daily reset (reset at midnight)
    const lastDate = new Date(user.lastUsageDate || 0);
    const isSameDay =
      lastDate.getDate() === now.getDate() &&
      lastDate.getMonth() === now.getMonth() &&
      lastDate.getFullYear() === now.getFullYear();

    // If not same day, reset all tier usage to 0
    let newTier1Usage = isSameDay ? user.dailyTier1Usage || 0 : 0;
    let newTier2Usage = isSameDay ? user.dailyTier2Usage || 0 : 0;
    let newTier3Usage = isSameDay ? user.dailyTier3Usage || 0 : 0;

    // If tier 2/3 slot was already acquired atomically by checkTierAccess,
    // only handle credit deduction — don't touch tier counters or lastUsageDate
    if (tierSlotAlreadyAcquired && (tier === 2 || tier === 3)) {
      if (cost > 0) {
        await db
          .update(users)
          .set({
            lifetimeSpent: sql`${users.lifetimeSpent} + ${cost}`,
            phoPointsBalance: sql`GREATEST(0, ${users.phoPointsBalance} - ${cost})`,
          })
          .where(eq(users.id, userId));
        console.log(
          `[Credits] Deducted ${cost} Credits (Tier ${tier}, atomic slot). User: ${userId}`,
        );
      }
      return;
    }

    // 3. Free Tier Logic (Tier 1 only)
    // Free Tier Limit: 5 requests/day for Tier 1 models
    const FREE_TIER_LIMIT = 5;

    let finalCost = cost;
    let isFree = false;

    // Increment appropriate tier usage
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

    // 4. Update DB — only update tier1 counter + credits.
    //    Tier 2/3 counters are managed exclusively by atomicAcquireTierSlot().
    //    On day-reset (isSameDay=false), reset tier 2/3 to 0.
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
          `[Credits] Deducted ${finalCost} Credits (Tier ${tier}). T1=${newTier1Usage}, T2=${newTier2Usage}, T3=${newTier3Usage}. User: ${userId}`,
        );
      }
    }

    // NOTE: Redis sync removed — DailyTierRateLimiter.check() already
    // increments pho:ratelimit:* keys via checkTierAccess() in the chat route.
    // The duplicate INCR here was causing admin dashboard to show 2x actual usage.

    // 5. Log to usage_logs with actual model/tier/tokens
    if (usageLog) {
      try {
        const VND_RATE = 24_167;
        const costUSD = usageLog.costUSD ?? finalCost * 0.000_04; // fallback: 1 point ≈ $0.00004
        await db.insert(usageLogs).values({
          costUSD,
          costVND: costUSD * VND_RATE,
          inputTokens: usageLog.inputTokens,
          model: usageLog.model,
          modelTier: tier,
          outputTokens: usageLog.outputTokens,
          pointsDeducted: finalCost,
          provider: usageLog.provider,
          responseTimeMs: usageLog.responseTimeMs ?? null,
          sessionId: usageLog.sessionId ?? null,
          totalTokens: usageLog.inputTokens + usageLog.outputTokens,
          userId,
        });
      } catch (logErr) {
        console.warn('⚠️ Failed to insert usage_logs:', logErr);
      }
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
            WHEN (last_usage_date IS NULL OR last_usage_date::date < CURRENT_DATE) THEN 1
            ELSE daily_tier3_usage + 1
          END,
          daily_tier2_usage = CASE
            WHEN (last_usage_date IS NULL OR last_usage_date::date < CURRENT_DATE) THEN 0
            ELSE daily_tier2_usage
          END,
          daily_tier1_usage = CASE
            WHEN (last_usage_date IS NULL OR last_usage_date::date < CURRENT_DATE) THEN 0
            ELSE daily_tier1_usage
          END,
          last_usage_date = NOW()
        WHERE id = ${userId}
          AND (
            (last_usage_date IS NULL OR last_usage_date::date < CURRENT_DATE)
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
          WHEN (last_usage_date IS NULL OR last_usage_date::date < CURRENT_DATE) THEN 1
          ELSE daily_tier2_usage + 1
        END,
        daily_tier3_usage = CASE
          WHEN (last_usage_date IS NULL OR last_usage_date::date < CURRENT_DATE) THEN 0
          ELSE daily_tier3_usage
        END,
        daily_tier1_usage = CASE
          WHEN (last_usage_date IS NULL OR last_usage_date::date < CURRENT_DATE) THEN 0
          ELSE daily_tier1_usage
        END,
        last_usage_date = NOW()
      WHERE id = ${userId}
        AND (
          (last_usage_date IS NULL OR last_usage_date::date < CURRENT_DATE)
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
      reason: 'Model này yêu cầu gói cao hơn. Vui lòng nâng cấp để sử dụng.',
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
      reason: 'Model này không khả dụng cho gói hiện tại của bạn.',
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

/** Get today's date string in Vietnam timezone (UTC+7) for comparison */
function getVietnamDateString(date: Date = new Date()): string {
  // UTC+7: add 7 hours in milliseconds
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().slice(0, 10);
}

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
