import { eq, isNull, lt, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { users } from '@/database/schemas/user';
import { getServerDB } from '@/database/server';
import { resolveMonthlyGrant } from '@/server/services/billing/monthlyGrant';

/**
 * Cron endpoint: grant the monthly Phở Points allowance to EVERY paid plan.
 *
 * Replaces the old `reset-lifetime-points` job, which was hardcoded to
 * `gl_lifetime` only — leaving medical_beta / vn_* / gl_premium yearly
 * subscribers without their advertised monthly points (audit 2026-06-01).
 *
 * Behaviour (per SPECS_BUSINESS.md — points do NOT roll over):
 * - Runs at 00:00 UTC on the 1st of each month.
 * - For every user on a monthly-grant plan (price > 0, monthlyPoints > 0) whose
 *   points have not yet been reset this calendar month, SET phoPointsBalance to
 *   the plan's monthlyPoints (full reset, not additive) and stamp pointsResetDate.
 * - Subscription plans require subscriptionStatus = 'ACTIVE'. Lifetime plans are
 *   always granted (they never expire), preserving the previous behaviour.
 * - Idempotent: the pointsResetDate gate guarantees at most one grant per month,
 *   and self-heals users whose pointsResetDate was never set (null).
 *
 * Security: requires Authorization: Bearer <CRON_SECRET> (added by Vercel).
 * @see https://vercel.com/docs/cron-jobs
 */

export async function GET(request: NextRequest) {
  console.log('[grant-monthly-points] Cron job started');

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[grant-monthly-points] CRON_SECRET not configured');
    return NextResponse.json(
      { error: 'CRON_SECRET not configured', success: false },
      { status: 403 },
    );
  }

  const providedToken = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!providedToken || providedToken !== cronSecret) {
    console.error('[grant-monthly-points] Unauthorized request');
    return NextResponse.json({ error: 'Unauthorized', success: false }, { status: 401 });
  }

  // Preview mode: compute who WOULD be granted without writing. Useful to verify
  // the blast on production before letting the job run for real.
  const dryRun = ['1', 'true'].includes(request.nextUrl.searchParams.get('dryRun') ?? '');

  try {
    const serverDB = await getServerDB();
    const now = new Date();
    const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    console.log(
      `[grant-monthly-points] Granting for users not reset since ${currentMonthStart.toISOString()}`,
    );

    // Pull candidates by the (cheap) date gate only, then filter plan eligibility
    // in JS. We avoid drizzle inArray()/ANY($array) because the Neon serverless
    // driver mis-serialises PostgreSQL array literals.
    const candidates = await serverDB
      .select({
        currentPoints: users.phoPointsBalance,
        id: users.id,
        lastReset: users.pointsResetDate,
        planId: users.currentPlanId,
        status: users.subscriptionStatus,
      })
      .from(users)
      .where(or(isNull(users.pointsResetDate), lt(users.pointsResetDate, currentMonthStart)));

    // Resolve each candidate's grant; drop the ineligible (null).
    const eligible = candidates
      .map((u) => ({ allowance: resolveMonthlyGrant(u.planId, u.status), user: u }))
      .filter(
        (x): x is { allowance: number; user: (typeof candidates)[number] } => x.allowance !== null,
      );

    console.log(
      `[grant-monthly-points] ${candidates.length} candidates, ${eligible.length} eligible`,
    );

    if (dryRun) {
      const byPlanPreview: Record<string, number> = {};
      for (const { user } of eligible) {
        const p = user.planId as string;
        byPlanPreview[p] = (byPlanPreview[p] ?? 0) + 1;
      }
      return NextResponse.json({
        byPlan: byPlanPreview,
        dryRun: true,
        eligibleCount: eligible.length,
        success: true,
        timestamp: now.toISOString(),
      });
    }

    if (eligible.length === 0) {
      return NextResponse.json({
        grantedCount: 0,
        message: 'No users need a monthly grant',
        success: true,
        timestamp: now.toISOString(),
      });
    }

    let successCount = 0;
    let failedCount = 0;
    const byPlan: Record<string, number> = {};
    const failedDetails: { error: string; userId: string }[] = [];

    // Individual updates — same Neon-driver-safe approach as the old cron.
    for (const { allowance, user } of eligible) {
      const planId = user.planId as string;

      try {
        await serverDB
          .update(users)
          .set({
            phoPointsBalance: allowance,
            pointsResetDate: now,
            updatedAt: now,
          })
          .where(eq(users.id, user.id));

        successCount++;
        byPlan[planId] = (byPlan[planId] ?? 0) + 1;
        console.log(
          `[grant-monthly-points] ${user.id} (${planId}): ${user.currentPoints} → ${allowance}`,
        );
      } catch (userError) {
        failedCount++;
        const errorMessage = userError instanceof Error ? userError.message : 'Unknown error';
        failedDetails.push({ error: errorMessage, userId: user.id });
        console.error(`[grant-monthly-points] Failed for ${user.id}: ${errorMessage}`);
      }
    }

    console.log(
      `[grant-monthly-points] Complete. Success: ${successCount}, Failed: ${failedCount}`,
    );

    return NextResponse.json({
      byPlan,
      failedCount,
      failedDetails: failedCount > 0 ? failedDetails : undefined,
      grantedCount: successCount,
      success: failedCount === 0,
      timestamp: now.toISOString(),
      totalEligible: eligible.length,
    });
  } catch (error) {
    console.error('[grant-monthly-points] Database error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown database error', success: false },
      { status: 500 },
    );
  }
}
