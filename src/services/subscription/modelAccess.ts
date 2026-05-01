/**
 * Subscription Model Access Service
 *
 * Manages which AI models users can access based on their subscription plan.
 * Handles auto-enabling models when users subscribe to plans.
 */
import {
  getAllowedModelsForPlan,
  getDefaultModelForPlan,
  getRequiredProvidersForPlan,
} from '@/config/pricing';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { serverDB } from '@/database/server';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { getUserPlanFromDB } from '@/server/services/subscription/getUserPlanFromDB';
import { ProviderConfig } from '@/types/user/settings';

export class SubscriptionModelAccessService {
  private async getAiInfraRepo(userId: string): Promise<AiInfraRepos> {
    const { aiProvider } = await getServerGlobalConfig();
    return new AiInfraRepos(serverDB, userId, aiProvider as Record<string, ProviderConfig>);
  }

  /**
   * Get allowed models for user's current subscription plan
   */
  async getAllowedModelsForUser(userId: string): Promise<string[]> {
    try {
      const planCode = await this.getCurrentUserPlanCode(userId);
      return getAllowedModelsForPlan(planCode);
    } catch (error) {
      console.error('Error getting allowed models for user:', error);
      // Fallback to free plan models
      return getAllowedModelsForPlan('vn_free');
    }
  }

  /**
   * Check if user can use specific model
   */
  async canUserUseModel(userId: string, modelId: string): Promise<boolean> {
    try {
      const allowedModels = await this.getAllowedModelsForUser(userId);
      return allowedModels.includes(modelId);
    } catch (error) {
      console.error('Error checking model access for user:', error);
      return false;
    }
  }

  /**
   * Get default model for user's plan
   */
  async getDefaultModelForUser(userId: string): Promise<{ model: string; provider: string }> {
    try {
      const planCode = await this.getCurrentUserPlanCode(userId);
      return getDefaultModelForPlan(planCode);
    } catch (error) {
      console.error('Error getting default model for user:', error);
      return getDefaultModelForPlan('vn_free');
    }
  }

  /**
   * Auto-enable models when user subscribes to a plan
   */
  async autoEnableModelsForPlan(userId: string, planCode: string): Promise<void> {
    try {
      console.log(`🚀 Auto-enabling models for user ${userId} with plan ${planCode}`);

      // Set up repository with correct userId
      const aiInfraRepo = await this.getAiInfraRepo(userId);

      // Get required providers and models for this plan
      const requiredProviders = getRequiredProvidersForPlan(planCode);
      const allowedModels = getAllowedModelsForPlan(planCode);
      const defaultModel = getDefaultModelForPlan(planCode);

      console.log(`Required providers: ${requiredProviders.join(', ')}`);
      console.log(`Allowed models: ${allowedModels.length} models`);
      console.log(`Default model: ${defaultModel.model} (${defaultModel.provider})`);

      // Enable required providers
      await this.enableProvidersForUser(aiInfraRepo, requiredProviders);

      // Enable allowed models
      await this.enableModelsForUser(aiInfraRepo, allowedModels);

      console.log(`✅ Successfully auto-enabled models for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error auto-enabling models for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get current user's plan code from the database.
   *
   * PHO-241/A1.6: This used to fall back to Clerk publicMetadata.planId for
   * "promo-activated" users, which made Clerk a writable source-of-truth for
   * paid-plan authorization. We now read exclusively from the DB; promo
   * activations write to both `users.current_plan_id` and the `subscriptions`
   * table (see /api/promo/activate), so DB-only is correct.
   */
  private async getCurrentUserPlanCode(userId: string): Promise<string> {
    const result = await getUserPlanFromDB(userId);
    return result.planId;
  }

  /**
   * Enable providers for user
   */
  private async enableProvidersForUser(
    aiInfraRepo: AiInfraRepos,
    providers: string[],
  ): Promise<void> {
    for (const providerId of providers) {
      try {
        // Enable the provider
        await aiInfraRepo.aiProviderModel.toggleProviderEnabled(providerId, true);
        console.log(`✅ Enabled provider: ${providerId}`);
      } catch (error) {
        console.error(`❌ Failed to enable provider ${providerId}:`, error);
      }
    }
  }

  /**
   * Enable models for user
   */
  private async enableModelsForUser(aiInfraRepo: AiInfraRepos, models: string[]): Promise<void> {
    // Get model to provider mapping
    const modelProviderMap = this.getModelProviderMap();

    for (const modelId of models) {
      try {
        const providerId = modelProviderMap[modelId];
        if (!providerId) {
          console.warn(`⚠️ No provider found for model: ${modelId}`);
          continue;
        }

        // Enable the model with correct parameters
        await aiInfraRepo.aiModelModel.toggleModelEnabled({
          enabled: true,
          id: modelId,
          providerId,
          source: 'builtin',
        });
        console.log(`✅ Enabled model: ${modelId} (${providerId})`);
      } catch (error) {
        console.error(`❌ Failed to enable model ${modelId}:`, error);
      }
    }
  }

  /**
   * Get model to provider mapping
   */
  private getModelProviderMap(): Record<string, string> {
    return {
      'claude-3-5-sonnet': 'anthropic',

      // Anthropic models
      'claude-3-haiku': 'anthropic',

      'claude-3-opus': 'anthropic',

      'claude-3-sonnet': 'anthropic',

      // Other models
      'deepseek-chat': 'deepseek',

      'deepseek-reasoner': 'deepseek',

      // Google models
      'gemini-1.5-flash': 'google',

      'gemini-1.5-pro': 'google',

      'gemini-2.0-flash': 'google',

      'gemini-2.5-pro': 'google',

      'gpt-4-turbo': 'openai',

      'gpt-4.1': 'openai',

      'gpt-4o': 'openai',

      // OpenAI models
      'gpt-4o-mini': 'openai',

      'o1': 'openai',

      'o1-pro': 'openai',
      'o3': 'openai',
      'qwen-turbo': 'qwen',
    };
  }
}

export const subscriptionModelAccessService = new SubscriptionModelAccessService();
