/**
 * Usage Stats API
 *
 * GET /api/subscription/usage-stats
 *
 * Returns user's current Phở Points balance and daily tier usage
 * Based on PRICING_MASTERPLAN.md.md
 *
 * IMPORTANT: Plan detection logic must be consistent with /api/subscription/current
 * to avoid displaying different plans in different parts of the UI.
 */
import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { GLOBAL_PLANS, VN_PLANS } from '@/config/pricing';
import { users } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { getUserPlanIdFromDB } from '@/server/services/subscription/getUserPlanFromDB';

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getServerDB();

    // Get user data including daily tier usage counters
    // (same columns that atomicAcquireTierSlot() enforces against)
    const userResult = await db
      .select({
        currentPlanId: users.currentPlanId,
        dailyTier2Usage: users.dailyTier2Usage,
        dailyTier3Usage: users.dailyTier3Usage,
        lastUsageDate: users.lastUsageDate,
        phoPointsBalance: users.phoPointsBalance,
        pointsResetDate: users.pointsResetDate,
        streakCount: users.streakCount,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userResult.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const user = userResult[0];

    // PHO-241/A1.6: DB is the single source of truth. Helper applies the same
    // prioritization (lifetime > paid > free, recency tiebreaker) used by
    // /api/subscription/current — keeping this endpoint consistent with BillingInfo.
    const planId = await getUserPlanIdFromDB(userId);

    // Get plan config
    const plan = VN_PLANS[planId] || GLOBAL_PLANS[planId] || VN_PLANS.vn_free;

    // Read daily tier usage from users table — same source as
    // atomicAcquireTierSlot() enforcement. This prevents counter mismatch
    // that caused the UI to show different values from actual enforcement.
    const lastDate = user.lastUsageDate ? new Date(user.lastUsageDate) : null;
    const isToday = lastDate && lastDate.toDateString() === new Date().toDateString();
    const tier2Count = isToday ? (user.dailyTier2Usage ?? 0) : 0;
    const tier3Count = isToday ? (user.dailyTier3Usage ?? 0) : 0;

    // Adjust balance for plan upgrades where DB hasn't been updated yet
    const dbBalance = user.phoPointsBalance ?? 50_000;
    const adjustedBalance =
      dbBalance <= 50_000 && plan.monthlyPoints > 50_000 ? plan.monthlyPoints : dbBalance;

    return NextResponse.json({
      currentPlanId: planId,
      dailyTier2Count: tier2Count,
      dailyTier2Limit: plan.dailyTier2Limit ?? 0,
      dailyTier3Count: tier3Count,
      dailyTier3Limit: plan.dailyTier3Limit ?? 0,
      phoPointsBalance: adjustedBalance,
      pointsResetDate: user.pointsResetDate?.toISOString() ?? null,
      streakDays: user.streakCount ?? 0,
      totalMonthlyPoints: plan.monthlyPoints,
    });
  } catch (error) {
    console.error('Usage stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch usage stats' }, { status: 500 });
  }
}
