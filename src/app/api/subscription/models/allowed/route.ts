/**
 * Subscription Allowed Models Endpoint
 * Returns models that user can access based on their subscription plan
 *
 * GET /api/subscription/models/allowed - Get allowed models for current user
 */
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { PLAN_MODEL_ACCESS, getAllowedTiersForPlan } from '@/config/pricing';
import { pino } from '@/libs/logger';
import { captureServerEvent } from '@/libs/posthog-server';
import { getUserPlanIdFromDB } from '@/server/services/subscription/getUserPlanFromDB';
import { subscriptionModelAccessService } from '@/services/subscription/modelAccess';

/**
 * Response for allowed models
 */
interface AllowedModelsResponse {
  data?: {
    allowedModels: string[];
    allowedTiers: number[];
    dailyLimits?: Record<string, number>;
    defaultModel: string;
    defaultProvider: string;
    planCode: string;
  };
  error?: string;
  success: boolean;
}

/**
 * GET /api/subscription/models/allowed
 * Get allowed models for user's current subscription plan
 */
export async function GET(): Promise<NextResponse<AllowedModelsResponse>> {
  try {
    // STAGING BYPASS: Allow all models in preview/development environments for testing.
    // Requires explicit STAGING_TIER_BYPASS=true. Hard guard: refuse to honor
    // the env var on production deployments even if someone sets it by
    // accident — never silently bypass billing.
    const stagingFlag = process.env.STAGING_TIER_BYPASS === 'true';
    const isNonProdEnv =
      process.env.VERCEL_ENV === 'preview' ||
      process.env.VERCEL_ENV === 'development' ||
      process.env.NODE_ENV === 'development';
    const isPreviewEnv = stagingFlag && isNonProdEnv;

    if (stagingFlag && !isNonProdEnv) {
      captureServerEvent('billing_bypass_denied', 'anonymous', {
        endpoint: '/api/subscription/models/allowed',
        node_env: process.env.NODE_ENV,
        reason: 'staging_flag_in_production',
        vercel_env: process.env.VERCEL_ENV,
      });
      pino.error(
        { vercel_env: process.env.VERCEL_ENV },
        'STAGING_TIER_BYPASS=true on production deployment — refusing bypass',
      );
      return NextResponse.json(
        { error: 'Misconfigured: STAGING_TIER_BYPASS not allowed in production', success: false },
        { status: 500 },
      );
    }

    if (isPreviewEnv) {
      // userId may not be resolved yet (auth() runs below); use 'anonymous' so
      // the event still lands and we can debug staging usage.
      captureServerEvent('billing_bypass_used', 'anonymous', {
        endpoint: '/api/subscription/models/allowed',
        mode: 'staging_env_var',
        vercel_env: process.env.VERCEL_ENV,
      });
      console.warn(
        '⚠️ [STAGING BYPASS ACTIVE] Returning all tiers — STAGING_TIER_BYPASS=true, ' +
          `VERCEL_ENV=${process.env.VERCEL_ENV}, NODE_ENV=${process.env.NODE_ENV}`,
      );
      return NextResponse.json({
        data: {
          allowedModels: [],
          allowedTiers: [1, 2, 3], // All tiers enabled for staging
          defaultModel: 'gemini-2.0-flash',
          defaultProvider: 'google',
          planCode: 'staging_bypass',
        },
        success: true,
      });
    }

    // Verify authentication
    const { userId } = await auth();

    // If no user, return default free tier models
    if (!userId) {
      const planCode = 'vn_free';

      return NextResponse.json({
        data: {
          allowedModels: PLAN_MODEL_ACCESS.vn_free.models,
          allowedTiers: getAllowedTiersForPlan(planCode),
          dailyLimits: PLAN_MODEL_ACCESS.vn_free.dailyLimits,
          defaultModel: PLAN_MODEL_ACCESS.vn_free.defaultModel,
          defaultProvider: PLAN_MODEL_ACCESS.vn_free.defaultProvider,
          planCode,
        },
        success: true,
      });
    }

    pino.info(
      {
        userId,
      },
      'Fetching allowed models for user',
    );

    // PHO-241/A1.6: DB is the single source of truth. Helper applies the same
    // prioritization (lifetime > paid > free, recency tiebreaker) used by
    // /api/subscription/current and the user.ts trpc router.
    const [allowedModels, defaultModel, planCode] = await Promise.all([
      subscriptionModelAccessService.getAllowedModelsForUser(userId),
      subscriptionModelAccessService.getDefaultModelForUser(userId),
      getUserPlanIdFromDB(userId),
    ]);

    // Get plan details
    const planAccess = PLAN_MODEL_ACCESS[planCode];
    const allowedTiers = getAllowedTiersForPlan(planCode);

    pino.info(
      {
        allowedModels: allowedModels.length,
        allowedTiers,
        defaultModel: defaultModel.model,
        defaultProvider: defaultModel.provider,
        planCode,
        userId,
      },
      'Successfully fetched allowed models for user',
    );

    const response = NextResponse.json({
      data: {
        allowedModels,
        allowedTiers,
        dailyLimits: planAccess?.dailyLimits,
        defaultModel: defaultModel.model,
        defaultProvider: defaultModel.provider,
        planCode,
      },
      success: true,
    });

    // Cache for 5 minutes on client, allow stale-while-revalidate for 10 minutes
    response.headers.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    pino.error(
      {
        error: errorMessage,
      },
      'Failed to fetch allowed models for user',
    );

    return NextResponse.json(
      {
        error: 'Failed to fetch allowed models',
        success: false,
      },
      { status: 500 },
    );
  }
}
