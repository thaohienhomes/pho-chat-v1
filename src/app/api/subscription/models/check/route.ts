/**
 * Subscription Model Access Check Endpoint
 * Checks if user can access a specific model based on their subscription
 *
 * POST /api/subscription/models/check - Check if user can use specific model
 */
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

import { getModelTier } from '@/config/pricing';
import { pino } from '@/libs/logger';
import { subscriptionModelAccessService } from '@/services/subscription/modelAccess';

/**
 * Request body for model access check
 */
interface CheckModelAccessRequest {
  modelId: string;
  providerId?: string;
}

/**
 * Response for model access check
 */
interface CheckModelAccessResponse {
  data?: {
    canAccess: boolean;
    modelId: string;
    reason?: string;
    suggestedPlan?: string;
    tier: number;
    tierName: string;
    upgradeRequired?: boolean;
  };
  error?: string;
  success: boolean;
}

/**
 * POST /api/subscription/models/check
 * Check if user can access a specific model
 */
export async function POST(request: NextRequest): Promise<NextResponse<CheckModelAccessResponse>> {
  try {
    // Verify authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized', success: false }, { status: 401 });
    }

    // Parse request body
    const body: CheckModelAccessRequest = await request.json();
    const { modelId } = body;

    // Validate required fields
    if (!modelId) {
      return NextResponse.json(
        {
          error: 'Missing required field: modelId',
          success: false,
        },
        { status: 400 },
      );
    }

    pino.info(
      {
        modelId,
        userId,
      },
      'Checking model access for user',
    );

    // PREVIEW BYPASS: Allow all models in preview/development environments for testing
    // Requires explicit STAGING_TIER_BYPASS=true to prevent accidental production leaks
    const isPreviewEnv =
      process.env.STAGING_TIER_BYPASS === 'true' &&
      (process.env.VERCEL_ENV === 'preview' ||
        process.env.VERCEL_ENV === 'development' ||
        process.env.NODE_ENV === 'development');

    if (isPreviewEnv) {
      console.warn('⚠️ [STAGING BYPASS ACTIVE] model check bypass — STAGING_TIER_BYPASS=true');
    }

    // Check if user can use the model (bypass in preview)
    const canAccess = isPreviewEnv
      ? true
      : await subscriptionModelAccessService.canUserUseModel(userId, modelId);

    // Get model tier information
    const tier = getModelTier(modelId);
    const { MODEL_TIERS } = await import('@/config/pricing');
    const tierConfig = MODEL_TIERS[tier];

    let reason: string | undefined;
    let upgradeRequired = false;
    let suggestedPlan: string | undefined;

    if (!canAccess) {
      upgradeRequired = true;

      if (tier === 2) {
        reason = 'This model requires a Basic or higher subscription plan';
        suggestedPlan = 'vn_basic';
      } else if (tier === 3) {
        reason = 'This model requires a Pro or higher subscription plan';
        suggestedPlan = 'vn_pro';
      } else {
        reason = 'This model is not available in your current plan';
      }
    }

    pino.info(
      {
        canAccess,
        modelId,
        reason,
        suggestedPlan,
        tier,
        upgradeRequired,
        userId,
      },
      'Model access check completed',
    );

    return NextResponse.json({
      data: {
        canAccess,
        modelId,
        reason,
        suggestedPlan,
        tier,
        tierName: tierConfig?.tierName || 'Unknown',
        upgradeRequired,
      },
      success: true,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    pino.error(
      {
        error: errorMessage,
      },
      'Failed to check model access for user',
    );

    return NextResponse.json(
      {
        error: 'Failed to check model access',
        success: false,
      },
      { status: 500 },
    );
  }
}
