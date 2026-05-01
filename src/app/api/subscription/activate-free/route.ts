import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { subscriptions, users } from '@/database/schemas';
import { getServerDB } from '@/database/server';

const FREE_PLANS = new Set(['vn_free', 'gl_starter', 'starter']);

/**
 * Activate a free subscription plan
 * POST /api/subscription/activate-free
 *
 * For free plans (vn_free, gl_starter), we don't need payment.
 * Simply activate the subscription directly.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized', success: false }, { status: 401 });
    }

    const body = await request.json();
    const { planId } = body;
    // Note: customerEmail and customerName available in body if needed for future use

    // Validate this is a free plan
    if (!planId || !FREE_PLANS.has(planId)) {
      return NextResponse.json(
        {
          message: `Plan "${planId}" is not a free plan. Use payment flow for paid plans.`,
          success: false,
        },
        { status: 400 },
      );
    }

    const db = await getServerDB();
    const now = new Date();

    // Map plan IDs to internal codes
    const planCodeMap: Record<string, string> = {
      gl_starter: 'gl_starter',
      starter: 'vn_free',
      vn_free: 'vn_free',
    };
    const normalizedPlanId = planCodeMap[planId] || planId;

    // ========================================================================
    // PHO-238 A1.10: Idempotency guards
    // ----------------------------------------------------------------------
    // Pre-fix exposure: this endpoint UPDATE-d phoPointsBalance=50_000
    // unconditionally on every call. A free user could POST repeatedly to
    // re-mint their balance back to 50K → unlimited free points.
    //
    // Fix layers, in order:
    //   1. Block if any active subscription row exists (paid or free).
    //   2. Block if users.pointsResetDate is still in the future
    //      (current period not yet expired → already activated this cycle).
    //   3. The existing UPDATE (below) sets pointsResetDate to the start of
    //      next month — that timestamp is what Layer 2 reads on the next
    //      call. So Layer 3 is implicit; no extra write needed.
    // ========================================================================

    // Layer 1: subscription row exists?
    const [existingSubscription] = await db
      .select({
        id: subscriptions.id,
        planId: subscriptions.planId,
        status: subscriptions.status,
      })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')))
      .limit(1);

    if (existingSubscription) {
      console.warn('[activate-free] DUPLICATE ACTIVATION ATTEMPT — active subscription exists', {
        attemptedAt: now.toISOString(),
        existingPlanId: existingSubscription.planId,
        userId,
      });
      return NextResponse.json(
        {
          activated: false,
          message: 'Bạn đã kích hoạt một gói trước đó. Vào /settings để xem chi tiết.',
          planId: existingSubscription.planId,
          success: false,
        },
        { status: 409 },
      );
    }

    // Layer 2: pointsResetDate still in current period?
    const [currentUserRow] = await db
      .select({
        balance: users.phoPointsBalance,
        currentPlanId: users.currentPlanId,
        pointsResetDate: users.pointsResetDate,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (
      currentUserRow?.pointsResetDate &&
      currentUserRow.pointsResetDate.getTime() > now.getTime()
    ) {
      console.warn('[activate-free] DUPLICATE ACTIVATION ATTEMPT — period still active', {
        attemptedAt: now.toISOString(),
        currentBalance: currentUserRow.balance,
        currentPlanId: currentUserRow.currentPlanId,
        pointsResetDate: currentUserRow.pointsResetDate.toISOString(),
        userId,
      });
      return NextResponse.json(
        {
          activated: false,
          currentBalance: currentUserRow.balance,
          message: `Đã kích hoạt trong kỳ hiện tại. Quota sẽ reset vào ${currentUserRow.pointsResetDate.toISOString().slice(0, 10)}.`,
          planId: currentUserRow.currentPlanId,
          pointsResetDate: currentUserRow.pointsResetDate.toISOString(),
          success: false,
        },
        { status: 409 },
      );
    }

    // 1. Update user's current plan
    await db
      .update(users)
      .set({
        currentPlanId: normalizedPlanId,
        phoPointsBalance: 50_000,
        // Free tier points
        pointsResetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1),
        subscriptionStatus: 'ACTIVE', // Next month
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    // 2. Create subscription record (using schema columns from billing.ts)
    await db
      .insert(subscriptions)
      .values({
        billingCycle: 'monthly',
        currentPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
        currentPeriodStart: now,
        id: `sub_free_${userId}_${Date.now()}`,
        paymentProvider: 'free',
        planId: normalizedPlanId === 'vn_free' ? 'free' : 'starter',
        status: 'active',
        userId,
      })
      .onConflictDoNothing();

    console.log(`✅ Free plan activated: ${normalizedPlanId} for user ${userId}`);

    return NextResponse.json({
      message: 'Free plan activated successfully!',
      planId: normalizedPlanId,
      redirectUrl: '/settings?active=subscription&activated=true',
      success: true,
    });
  } catch (error) {
    console.error('❌ Free plan activation error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to activate free plan',
        success: false,
      },
      { status: 500 },
    );
  }
}
