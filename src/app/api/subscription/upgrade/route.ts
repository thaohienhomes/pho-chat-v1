/**
 * Subscription Upgrade/Downgrade Endpoint
 * Handles plan changes with prorated charges
 *
 * POST /api/subscription/upgrade - Upgrade or downgrade subscription
 */
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { subscriptions } from '@/database/schemas/billing';
import { getServerDB } from '@/database/server';
import { pino } from '@/libs/logger';
import { captureServerEvent } from '@/libs/posthog-server';
import { PLAN_TIERS, calculateProratedAmount } from '@/server/services/billing/proration';

/**
 * Plan pricing based on PRICING_MASTERPLAN.md.md
 * Uses Phở Points system
 */
const PLAN_PRICING = {
  
  
  // Vietnam Plans
medical_beta: { monthly: 83_000, monthlyPoints: 1_000_000, yearly: 999_000 },
  
// per user
// Legacy mappings (for backward compatibility)
premium: { monthly: 69_000, monthlyPoints: 300_000, yearly: 690_000 },
  
starter: { monthly: 0, monthlyPoints: 50_000, yearly: 0 },
  
  ultimate: { monthly: 199_000, monthlyPoints: 2_000_000, yearly: 1_990_000 },
  vn_basic: { monthly: 69_000, monthlyPoints: 300_000, yearly: 690_000 },
  vn_free: { monthly: 0, monthlyPoints: 50_000, yearly: 0 },
  vn_pro: { monthly: 199_000, monthlyPoints: 2_000_000, yearly: 1_990_000 },
  vn_standard: { monthly: 107_500, monthlyPoints: 1_000_000, yearly: 1_290_000 },
  vn_team: { monthly: 149_000, monthlyPoints: 0, yearly: 1_490_000 },
  vn_ultra: { monthly: 415_833, monthlyPoints: 5_000_000, yearly: 4_990_000 },
} as const;

type PlanId = keyof typeof PLAN_PRICING;

// Valid plan IDs (both new and legacy)
const VALID_PLAN_IDS = new Set<PlanId>([
  'vn_free',
  'vn_basic',
  'vn_standard',
  'vn_pro',
  'vn_team',
  'vn_ultra',
  'medical_beta',
  'starter',
  'premium',
  'ultimate',
]);

interface UpgradeRequest {
  billingCycle: 'monthly' | 'yearly';
  newPlanId: string; // vn_free | vn_basic | vn_pro | vn_team (or legacy: starter | premium | ultimate)
  /** Order ID from completed Sepay payment (for upgrade with payment) */
  paymentOrderId?: string;
}

interface UpgradeResponse {
  message: string;
  newSubscription?: {
    billingCycle: string;
    currentPeriodEnd: string;
    id: string;
    planId: string;
  };
  /** If payment is required, contains payment URL to redirect user */
  paymentRequired?: boolean;
  paymentUrl?: string;
  proratedAmount?: number;
  success: boolean;
}

/**
 * POST /api/subscription/upgrade
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Verify authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = (await request.json()) as Record<string, unknown>;

    // Reject any client-supplied bypass flag — payment authorization MUST come
    // from the Sepay webhook handler (server-internal service call), never
    // from a value the client can set in the request body. Surface as a 403
    // and capture a security event so we can spot scraping/abuse in PostHog.
    if ('bypassPayment' in rawBody) {
      captureServerEvent('billing_bypass_denied', userId, {
        endpoint: '/api/subscription/upgrade',
        new_plan_id: typeof rawBody.newPlanId === 'string' ? rawBody.newPlanId : null,
        reason: 'client_supplied_bypass_payment_flag',
      });
      pino.warn(
        { userId, attemptedPlan: rawBody.newPlanId },
        'Rejected client-supplied bypassPayment flag on /api/subscription/upgrade',
      );
      return NextResponse.json(
        { error: 'bypassPayment is not accepted on this endpoint', success: false },
        { status: 403 },
      );
    }

    const body = rawBody as unknown as UpgradeRequest;
    const { newPlanId, billingCycle } = body;

    if (!newPlanId || !billingCycle) {
      return NextResponse.json(
        { error: 'Missing required fields: newPlanId, billingCycle' },
        { status: 400 },
      );
    }

    // Validate plan ID (supports both new and legacy plan IDs)
    if (!VALID_PLAN_IDS.has(newPlanId as PlanId)) {
      return NextResponse.json({ error: 'Invalid plan ID' }, { status: 400 });
    }

    // Validate billing cycle
    if (!['monthly', 'yearly'].includes(billingCycle)) {
      return NextResponse.json({ error: 'Invalid billing cycle' }, { status: 400 });
    }

    // Get database instance
    const db = await getServerDB();

    // Get current subscription
    const currentSubscription = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')))
      .limit(1);

    if (!currentSubscription || currentSubscription.length === 0) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    const subscription = currentSubscription[0];

    // Check if upgrading to same plan
    if (subscription.planId === newPlanId && subscription.billingCycle === billingCycle) {
      return NextResponse.json(
        {
          error: 'Already subscribed to this plan',
          message: 'You are already subscribed to this plan',
          success: false,
        },
        { status: 400 },
      );
    }

    // Calculate prorated amount
    const proratedAmount = calculateProratedAmount(
      subscription.planId,
      newPlanId,
      billingCycle,
      subscription.currentPeriodEnd,
    );

    // Determine if this is an upgrade or downgrade based on plan tier
    const currentTier = PLAN_TIERS[subscription.planId] ?? 0;
    const newTier = PLAN_TIERS[newPlanId] ?? 0;
    const isUpgrade = newTier > currentTier;

    pino.info(
      {
        billingCycle,
        currentPlan: subscription.planId,
        isUpgrade,
        newPlan: newPlanId,
        proratedAmount,
        userId,
      },
      'Processing subscription upgrade/downgrade',
    );

    // For upgrades with prorated cost, ALWAYS create Sepay payment and return
    // payment URL. The Sepay webhook (verified via HMAC) is responsible for
    // applying the plan change once the user has paid — never the client.
    // Direct update only happens for downgrades / zero-cost changes below.
    if (isUpgrade && proratedAmount > 0) {
      // Create Sepay payment for upgrade fee
      const { SepayPaymentGateway, sepayGateway } = await import('@/libs/sepay');
      const { createPaymentRecord } = await import('@/server/services/billing/sepay');

      const orderId = SepayPaymentGateway.generateOrderId('PHO_UPG');
      const description = `pho.chat Upgrade to ${newPlanId} - prorated fee`;

      // Get base URL from request headers
      const host = request.headers.get('host');
      const protocol = request.headers.get('x-forwarded-proto') || 'https';
      const baseUrl = host
        ? `${protocol}://${host}`
        : process.env.NEXT_PUBLIC_BASE_URL || 'https://pho.chat';

      const paymentResponse = await sepayGateway.createPayment({
        amount: proratedAmount,
        baseUrl,
        currency: 'VND',
        description,
        orderId,
      });

      if (paymentResponse.success) {
        // Store pending upgrade info in payment record metadata
        await createPaymentRecord({
          amountVnd: proratedAmount,
          billingCycle,
          currency: 'VND',
          orderId,
          planId: newPlanId,
          userId,
        });

        pino.info(
          { orderId, proratedAmount, userId },
          'Upgrade payment created, awaiting payment confirmation',
        );

        return NextResponse.json({
          message: `Payment of ${proratedAmount.toLocaleString()} VND required for upgrade`,
          paymentRequired: true,
          paymentUrl: paymentResponse.paymentUrl,
          proratedAmount,
          success: true,
        } as UpgradeResponse);
      } else {
        return NextResponse.json(
          { error: 'Failed to create payment', message: paymentResponse.message, success: false },
          { status: 500 },
        );
      }
    }

    // Proceed with direct subscription update (downgrade, no payment, or payment confirmed)
    const newPeriodStart = new Date();
    const newPeriodEnd = new Date();
    if (billingCycle === 'monthly') {
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
    } else {
      newPeriodEnd.setFullYear(newPeriodEnd.getFullYear() + 1);
    }

    const updatedSubscription = await db
      .update(subscriptions)
      .set({
        billingCycle,
        currentPeriodEnd: newPeriodEnd,
        currentPeriodStart: newPeriodStart,
        planId: newPlanId,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscription.id))
      .returning();

    pino.info(
      { newPlan: newPlanId, subscriptionId: subscription.id, userId },
      'Subscription upgraded/downgraded successfully',
    );

    const response: UpgradeResponse = {
      message:
        proratedAmount > 0
          ? `Upgrade successful. Prorated charge: ${proratedAmount.toLocaleString()} VND`
          : proratedAmount < 0
            ? `Downgrade successful. Credit: ${Math.abs(proratedAmount).toLocaleString()} VND`
            : 'Plan changed successfully. No additional charge.',
      newSubscription: {
        billingCycle: updatedSubscription[0].billingCycle,
        currentPeriodEnd: updatedSubscription[0].currentPeriodEnd.toISOString(),
        id: updatedSubscription[0].id,
        planId: updatedSubscription[0].planId,
      },
      paymentRequired: false,
      proratedAmount,
      success: true,
    };

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    pino.error(
      {
        error: errorMessage,
      },
      'Subscription upgrade/downgrade failed',
    );

    return NextResponse.json(
      {
        error: 'Failed to process subscription change',
        message: errorMessage,
      },
      { status: 500 },
    );
  }
}
