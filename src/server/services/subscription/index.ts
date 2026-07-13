import { LobeChatDatabase } from '@lobechat/database';
import { subscriptions, usageLogs } from '@lobechat/database/schemas';
import { and, eq, sql } from 'drizzle-orm';

import {
  canPlanUseModel,
  getAllowedModelsForPlan,
  getAllowedTiersForPlan,
  getDefaultModelForPlan,
  getModelTier,
} from '@/config/pricing';
import { pino } from '@/libs/logger';

// Legacy imports for backward compatibility
import { FREE_TIER_MODELS, TRIAL_CONFIG } from '../trial/config';

export interface CreateSubscriptionParams {
  billingCycle?: 'monthly' | 'yearly';
  paymentProvider?: 'sepay' | 'polar' | 'free';
  planId: 'free' | 'starter' | 'premium' | 'ultimate' | 'vn_free' | 'vn_basic' | 'vn_premium' | 'vn_pro' | 'vn_ultimate' | 'medical_beta';
  userId: string;
}

export interface TrialAccessResult {
  allowed: boolean;
  /** Tiers user can access based on their plan */
  allowedTiers?: number[];
  /** Daily limit for the requested model's tier */
  dailyLimit?: number;
  /** Remaining messages for the requested model's tier today */
  dailyRemaining?: number;
  /** Timestamp (ms) when daily limit resets (next midnight UTC) */
  dailyResetTime?: number;
  isTrialUser: boolean;
  /** @deprecated Use allowedTiers instead */
  messagesRemaining?: number;
  model?: string;
  modelAdjusted?: boolean;
  /** User's plan code for tier-based access */
  planCode?: string;
  reason?: string;
  /** @deprecated Use allowedTiers instead */
  tokensRemaining?: number;
}

export class SubscriptionService {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  /**
   * Create a free subscription for new users
   */
  createFreeSubscription = async (userId: string) => {
    try {
      // Check if user already has a subscription
      const existing = await this.db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .limit(1);

      if (existing.length > 0) {
        pino.info({ userId }, 'User already has a subscription, skipping creation');
        return { message: 'Subscription already exists', success: false };
      }

      // Create free subscription (no expiration)
      const start = new Date();
      const end = new Date(start);
      end.setFullYear(end.getFullYear() + 100); // 100 years = effectively no expiration

      await this.db.insert(subscriptions).values({
        billingCycle: 'monthly',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: end,
        currentPeriodStart: start,
        paymentProvider: 'free',
        planId: 'free',
        status: 'active',
        userId,
      });

      pino.info({ userId }, 'Free subscription created for new user');
      return { message: 'Free subscription created', success: true };
    } catch (error) {
      pino.error({ error, userId }, 'Failed to create free subscription');
      throw error;
    }
  };

  /**
   * Get user's active subscription (prioritizes paid plans over free plan)
   */
  getActiveSubscription = async (userId: string) => {
    const result = await this.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')));

    if (result.length === 0) return null;

    // Prioritize paid plans over free plan
    // Sort by: paid plans first, then by most recent period start
    const sortedResults = result.sort((a, b) => {
      // Free plan has lowest priority
      if (a.planId === 'free' && b.planId !== 'free') return 1;
      if (a.planId !== 'free' && b.planId === 'free') return -1;

      // For same priority, prefer more recent subscription
      const aStart = a.currentPeriodStart ? new Date(a.currentPeriodStart).getTime() : 0;
      const bStart = b.currentPeriodStart ? new Date(b.currentPeriodStart).getTime() : 0;
      return bStart - aStart;
    });

    return sortedResults[0];
  };

  /**
   * Check if a plan is a paid plan (not free)
   * Includes both standard plans (starter, premium, ultimate) and VN plans (vn_basic, vn_pro, vn_team)
   */
  private isPaidPlan = (planId: string): boolean => {
    const freePlans = ['free', 'trial'];
    return !freePlans.includes(planId.toLowerCase());
  };

  /**
   * Check if user has an active paid subscription
   */
  hasPaidSubscription = async (userId: string): Promise<boolean> => {
    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) return false;

    // Check if subscription is paid (not free)
    return this.isPaidPlan(subscription.planId);
  };

  /**
   * Check if user can access AI models
   * Free users can access AI models during their trial period
   */
  canAccessAIModels = async (userId: string): Promise<boolean> => {
    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) {
      pino.warn({ userId }, 'User has no subscription - denying AI model access');
      return false;
    }

    // Paid plans always have access (includes VN plans like vn_basic, vn_pro, vn_team)
    if (this.isPaidPlan(subscription.planId)) {
      pino.info({ planId: subscription.planId, userId }, 'User has paid subscription - allowing AI access');
      return true;
    }

    // Free users can access during trial
    const trialAccess = await this.checkTrialAccess(userId);
    return trialAccess.allowed;
  };

  /**
   * Check subscription access with tier-based model restrictions
   *
   * Access is determined by:
   * 1. User's subscription plan (vn_free, vn_basic, vn_pro, etc.)
   * 2. Plan's allowed tiers from PLAN_MODEL_ACCESS
   * 3. Requested model's tier from MODEL_TIERS
   *
   * Free tier (vn_free) = Tier 1 only
   * Basic tier (vn_basic) = Tier 1 only (unlimited within points)
   * Pro tier (vn_pro) = Tier 1 & 2
   */
  checkTrialAccess = async (userId: string, requestedModel?: string): Promise<TrialAccessResult> => {
    const subscription = await this.getActiveSubscription(userId);
    const planCode = subscription?.planId || 'vn_free';

    // Get allowed tiers for this plan
    const allowedTiers = getAllowedTiersForPlan(planCode);
    const isFreePlan = planCode === 'vn_free' || planCode === 'gl_starter' || planCode === 'free';

    // Check if requested model is allowed for this plan
    let finalModel = requestedModel;
    let modelAdjusted = false;

    if (requestedModel) {
      const modelTier = getModelTier(requestedModel);

      if (!allowedTiers.includes(modelTier)) {
        // Model not allowed for this tier - use fallback
        const defaultModel = getDefaultModelForPlan(planCode);
        finalModel = defaultModel.model;
        modelAdjusted = true;

        pino.info(
          {
            allowedTiers,
            modelTier,
            originalModel: requestedModel,
            planCode,
            userId,
          },
          'Model tier not allowed for plan - using default model',
        );
      }
    }

    // For free plans, check points/usage limits (legacy behavior).
    // Legacy message limit applies only if TRIAL_CONFIG.maxMessages > 0.
    // getTrialUsage is an unbounded COUNT/SUM over the user's entire
    // usage_logs — only pay for it when the limit is actually enforced
    // (with maxMessages = -1 the result was computed and discarded on
    // every free-user message, on the pre-first-token hot path).
    if (isFreePlan && TRIAL_CONFIG.maxMessages > 0) {
      const usage = await this.getTrialUsage(userId);
      const messagesRemaining = Math.max(0, TRIAL_CONFIG.maxMessages - usage.messageCount);

      if (messagesRemaining <= 0) {
        pino.warn({ messagesUsed: usage.messageCount, planCode, userId }, 'Free tier limit reached');
        return {
          allowed: false,
          allowedTiers,
          isTrialUser: true,
          messagesRemaining: 0,
          planCode,
          reason: 'Bạn đã sử dụng hết quota miễn phí. Nâng cấp để tiếp tục chat với AI.',
        };
      }
    }

    // Daily tier limits are enforced in the chat route via checkTierAccess()
    // (PostgreSQL atomic check in credits.ts). This middleware only validates
    // plan-level access — it does NOT count or enforce daily usage.

    // Paid plans always have access (within their tier restrictions)
    return {
      allowed: true,
      allowedTiers,
      isTrialUser: isFreePlan,
      model: finalModel,
      modelAdjusted,
      planCode,
    };
  };

  /**
   * Get trial usage statistics
   */
  private getTrialUsage = async (userId: string): Promise<{
    messageCount: number;
    totalTokens: number;
  }> => {
    try {
      const result = await this.db
        .select({
          messageCount: sql<number>`COUNT(*)::int`,
          totalTokens: sql<number>`COALESCE(SUM(${usageLogs.totalTokens}), 0)::int`,
        })
        .from(usageLogs)
        .where(eq(usageLogs.userId, userId));

      return {
        messageCount: result[0]?.messageCount || 0,
        totalTokens: result[0]?.totalTokens || 0,
      };
    } catch (error) {
      pino.error({ error, userId }, 'Failed to get trial usage, allowing access');
      return { messageCount: 0, totalTokens: 0 };
    }
  };

  /**
   * Get allowed models for a user based on their subscription plan
   * @deprecated Use getAllowedModelsForUser instead
   */
  getAllowedTrialModels = (): readonly string[] => {
    return FREE_TIER_MODELS;
  };

  /**
   * Get allowed models for a user based on their subscription plan
   */
  getAllowedModelsForUser = async (userId: string): Promise<string[]> => {
    const subscription = await this.getActiveSubscription(userId);
    const planCode = subscription?.planId || 'vn_free';
    return getAllowedModelsForPlan(planCode);
  };

  /**
   * Check if a user can use a specific model
   */
  canUserUseModel = async (userId: string, modelId: string): Promise<boolean> => {
    const subscription = await this.getActiveSubscription(userId);
    const planCode = subscription?.planId || 'vn_free';
    return canPlanUseModel(planCode, modelId);
  };

  /**
   * Get user's subscription plan details
   */
  getSubscriptionPlan = async (userId: string) => {
    const subscription = await this.getActiveSubscription(userId);

    if (!subscription) {
      return {
        allowedTiers: [1], // Free tier = Tier 1 only
        canAccessAI: true, // Free tier can still use AI within limits
        planId: 'vn_free',
        status: 'none',
      };
    }

    const allowedTiers = getAllowedTiersForPlan(subscription.planId);

    return {
      allowedTiers,
      billingCycle: subscription.billingCycle,
      canAccessAI: true, // All plans can access AI within their tier limits
      currentPeriodEnd: subscription.currentPeriodEnd,
      planId: subscription.planId,
      status: subscription.status,
    };
  };
}
