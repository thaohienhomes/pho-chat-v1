import { auth, clerkClient } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { subscriptions, users } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { getUserPlanFromDB } from '@/server/services/subscription/getUserPlanFromDB';

/**
 * Promo Code Activation API
 *
 * Validates a promo code and activates the corresponding plan.
 *
 * PHO-241/A1.6: The DB write (users + subscriptions) is now AUTHORITATIVE.
 * The Clerk metadata write is best-effort and exists only to keep the
 * client-side display cache in sync — it must never gate authorization.
 * If the Clerk write fails after DB succeeds, we log a warning but still
 * return success to the user; a reconciliation cron resyncs Clerk later.
 *
 * Also sends a welcome email on successful activation.
 *
 * Currently supports:
 * - medical_beta: Phở Chat Medical Beta (999k VNĐ/year)
 */

// Plan-specific configuration for promo activations
const PLAN_CONFIGS: Record<string, { billingCycle: 'yearly' | 'lifetime'; monthlyPoints: number }> =
  {
    medical_beta: { billingCycle: 'yearly', monthlyPoints: 1_000_000 },
  };

// Valid promo codes — in production, move to DB or env var
const VALID_PROMO_CODES: Record<
  string,
  {
    description: string;
    expiresAt?: string; // ISO date
    maxUses?: number;
    planId: string;
  }
> = {
  // Batch 1 codes for Medical Beta launch (Feb 2026)
  'PHO-MED-2026-BETA': {
    description: 'Medical Beta - Founding batch',
    maxUses: 200,
    planId: 'medical_beta',
  },
  'PHO-MED-2026-VIP1': {
    description: 'Medical Beta - VIP batch 1',
    maxUses: 50,
    planId: 'medical_beta',
  },
};

// Track code usage in memory (in production, use DB)
const codeUsageCount: Record<string, number> = {};

/**
 * Calculate end of current month for points reset date
 */
function getEndOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { code } = body as { code: string };

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Promo code is required' }, { status: 400 });
    }

    const normalizedCode = code.trim().toUpperCase();
    const promoConfig = VALID_PROMO_CODES[normalizedCode];

    if (!promoConfig) {
      return NextResponse.json(
        { error: 'Mã khuyến mãi không hợp lệ. Vui lòng kiểm tra lại.' },
        { status: 404 },
      );
    }

    // Check expiry
    if (promoConfig.expiresAt && new Date(promoConfig.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Mã khuyến mãi đã hết hạn.' }, { status: 410 });
    }

    // Check max uses
    if (promoConfig.maxUses) {
      const currentUses = codeUsageCount[normalizedCode] || 0;
      if (currentUses >= promoConfig.maxUses) {
        return NextResponse.json({ error: 'Mã khuyến mãi đã được sử dụng hết.' }, { status: 410 });
      }
    }

    // PHO-241/A1.6: DB is the single source of truth — read it (NOT Clerk metadata)
    // when checking whether the plan is already active.
    const existingPlan = await getUserPlanFromDB(userId);
    if (existingPlan.planId === promoConfig.planId) {
      return NextResponse.json(
        {
          error: 'Bạn đã kích hoạt gói này rồi!',
          planId: promoConfig.planId,
        },
        { status: 409 },
      );
    }

    const planId = promoConfig.planId;
    const planConfig = PLAN_CONFIGS[planId] || {
      billingCycle: 'yearly' as const,
      monthlyPoints: 500_000,
    };

    // =============================================
    // STEP 1 (AUTHORITATIVE): Sync database — users + subscriptions tables.
    // Must succeed before we touch Clerk; if this fails we abort.
    // =============================================
    const db = await getServerDB();

    // 1a. Update users table: currentPlanId, phoPointsBalance, pointsResetDate, subscriptionStatus
    const pointsResetDate = getEndOfMonth();
    await db
      .update(users)
      .set({
        currentPlanId: planId,
        phoPointsBalance: planConfig.monthlyPoints,
        pointsResetDate,
        subscriptionStatus: 'ACTIVE',
      })
      .where(eq(users.id, userId));
    console.log('✅ [Promo] users table synced:', {
      currentPlanId: planId,
      phoPointsBalance: planConfig.monthlyPoints,
    });

    // 1b. Create or update subscription record
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + (planConfig.billingCycle === 'yearly' ? 365 : 30));

    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);

    if (existing) {
      await db
        .update(subscriptions)
        .set({
          billingCycle: planConfig.billingCycle,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: end,
          currentPeriodStart: start,
          paymentProvider: 'promo',
          planId,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.userId, userId));
      console.log('✅ [Promo] Subscription updated for user:', userId);
    } else {
      await db.insert(subscriptions).values({
        billingCycle: planConfig.billingCycle,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: end,
        currentPeriodStart: start,
        paymentProvider: 'promo',
        planId,
        status: 'active',
        userId,
      });
      console.log('✅ [Promo] Subscription created for user:', userId);
    }

    // 1c. Sync wallet tier (non-critical)
    try {
      const { syncWalletTier } = await import('@/libs/wallet/tierSync');
      await syncWalletTier(db as any, userId, planId);
      console.log('✅ [Promo] Wallet tier synced for user:', userId);
    } catch (walletError) {
      console.error('⚠️ [Promo] Wallet tier sync failed (non-critical):', walletError);
    }

    // =============================================
    // STEP 2 (DISPLAY ONLY): Update Clerk publicMetadata so the client cache
    // shows the new plan immediately. NOT authoritative — failure here does
    // NOT roll back the DB write; a reconciliation cron will retry.
    // We also reuse the Clerk user object for the welcome email below.
    // =============================================
    const client = await clerkClient();
    let clerkUser: Awaited<ReturnType<typeof client.users.getUser>> | undefined;
    try {
      clerkUser = await client.users.getUser(userId);
      await client.users.updateUserMetadata(userId, {
        publicMetadata: {
          ...clerkUser.publicMetadata,
          planId,
          previousPlanId: existingPlan.planId,
          promoActivatedAt: new Date().toISOString(),
          promoCode: normalizedCode,
          ...(planId === 'medical_beta' ? { medical_beta: true } : {}),
        },
      });
      console.log('✅ [Promo] Clerk metadata updated for user:', userId);
    } catch (clerkError) {
      console.warn(
        '⚠️ [Promo] Clerk metadata sync failed — DB is authoritative, plan IS active. ' +
          'Reconciliation cron will retry. userId=' +
          userId,
        clerkError,
      );
    }

    // =============================================
    // STEP 3: Send welcome email (non-blocking, requires Clerk user from STEP 2)
    // =============================================
    if (clerkUser) {
      try {
        const userEmail = clerkUser.emailAddresses?.[0]?.emailAddress;
        if (userEmail) {
          const { sendWelcomeEmail } = await import('@/libs/email');
          await sendWelcomeEmail({
            email: userEmail,
            name: clerkUser.firstName || userEmail.split('@')[0] || 'there',
            planId,
          });
          console.log('✅ [Promo] Welcome email sent to:', userEmail);
        }
      } catch (emailError) {
        console.error('⚠️ [Promo] Welcome email failed (non-critical):', emailError);
      }
    }

    // Increment usage count
    codeUsageCount[normalizedCode] = (codeUsageCount[normalizedCode] || 0) + 1;

    return NextResponse.json({
      activatedAt: new Date().toISOString(),
      message: '🏥 Chúc mừng! Gói Phở Medical Beta đã được kích hoạt thành công!',
      planId,
      success: true,
    });
  } catch (error) {
    console.error('Promo code activation error:', error);
    return NextResponse.json({ error: 'Có lỗi xảy ra. Vui lòng thử lại sau.' }, { status: 500 });
  }
}

// GET endpoint to check code validity without activating
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json(
      { error: 'Code parameter is required', usage: '/api/promo/activate?code=PHO-MED-2026-BETA' },
      { status: 400 },
    );
  }

  const normalizedCode = code.trim().toUpperCase();
  const promoConfig = VALID_PROMO_CODES[normalizedCode];

  if (!promoConfig) {
    return NextResponse.json({ valid: false });
  }

  const isExpired = promoConfig.expiresAt ? new Date(promoConfig.expiresAt) < new Date() : false;

  const currentUses = codeUsageCount[normalizedCode] || 0;
  const isMaxedOut = promoConfig.maxUses ? currentUses >= promoConfig.maxUses : false;

  return NextResponse.json({
    description: promoConfig.description,
    planId: promoConfig.planId,
    valid: !isExpired && !isMaxedOut,
  });
}
