// Logical model mapping service

/**
 * Model redirects for deprecated/sunset models.
 * When a provider retires a model, add an entry here to transparently
 * redirect users to the successor model.
 */
const MODEL_REDIRECTS: Record<string, string> = {
  'claude-3-5-sonnet-20240620': 'claude-sonnet-4-20250514',

  // Claude 3.5 Sonnet → Claude 4 Sonnet
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-20250514',

  // Claude 3.7 Sonnet → Claude 4 Sonnet (3.7 sunset by Anthropic)
  'claude-3-7-sonnet-20250219': 'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-latest': 'claude-sonnet-4-20250514',
};

export interface LogicalModelConfig {
  id: string;
  providers: {
    modelId: string;
    provider: string;
  }[];
}

class PhoGatewayService {
  private logicalModels: Record<string, LogicalModelConfig> = {
    // ── Premium Anthropic Models — failover via Vercel AI Gateway ──
    // NOTE: Vercel AI Gateway uses DOT format (claude-opus-4.6), NOT hyphen (claude-opus-4-6).
    'anthropic/claude-opus-4-20250514': {
      id: 'anthropic/claude-opus-4-20250514',
      providers: [
        { modelId: 'anthropic/claude-opus-4-20250514', provider: 'vercelaigateway' },
        { modelId: 'anthropic/claude-opus-4.6', provider: 'vercelaigateway' }, // upgrade fallback
        { modelId: 'google/gemini-2.5-pro', provider: 'vercelaigateway' }, // cross-provider fallback
      ],
    },
    'anthropic/claude-opus-4.6': {
      id: 'anthropic/claude-opus-4.6',
      providers: [
        { modelId: 'anthropic/claude-opus-4.6', provider: 'vercelaigateway' },
        { modelId: 'anthropic/claude-sonnet-4.6', provider: 'vercelaigateway' }, // downgrade fallback
        { modelId: 'google/gemini-2.5-pro', provider: 'vercelaigateway' }, // cross-provider fallback
      ],
    },
    'anthropic/claude-sonnet-4.6': {
      id: 'anthropic/claude-sonnet-4.6',
      providers: [
        { modelId: 'anthropic/claude-sonnet-4.6', provider: 'vercelaigateway' },
        { modelId: 'anthropic/claude-sonnet-4-20250514', provider: 'vercelaigateway' }, // older version fallback
        { modelId: 'google/gemini-2.5-flash', provider: 'vercelaigateway' }, // cross-provider fallback
      ],
    },

    // ── New Open Models (Tier 1/2) ─────────────────────────────────────────
    // These are exposed in the phochat picker via phochat.ts logical entries.
    'gemma-3-27b-it': {
      id: 'gemma-3-27b-it',
      providers: [
        { modelId: 'gemma-3-27b-it', provider: 'groq' },
        { modelId: 'google/gemini-2.0-flash', provider: 'vercelaigateway' }, // fallback
      ],
    },

    'kimi-k2': {
      id: 'kimi-k2',
      providers: [
        { modelId: 'moonshotai/Kimi-K2-Instruct', provider: 'togetherai' },
        { modelId: 'google/gemini-2.5-flash', provider: 'vercelaigateway' }, // fallback
      ],
    },

    // Legacy compatibility
    'llama-3.1-8b-instant': {
      id: 'llama-3.1-8b-instant',
      providers: [
        { modelId: 'llama-3.1-8b-instant', provider: 'groq' },
        { modelId: '@cf/meta/llama-3.1-8b-instruct', provider: 'cloudflare' },
        { modelId: 'google/gemini-2.0-flash', provider: 'vercelaigateway' },
      ],
    },

    'llama-4-scout-17b': {
      id: 'llama-4-scout-17b',
      providers: [
        { modelId: 'meta-llama/llama-4-scout-17b-16e-instruct', provider: 'groq' },
        { modelId: 'google/gemini-2.0-flash', provider: 'vercelaigateway' }, // fallback
      ],
    },

    // InceptionLabs Mercury 2 — ultra-fast diffusion LLM (1000+ tok/s)
    // API model name: "mercury-2" (per https://docs.inceptionlabs.ai/get-started/models)
    'mercury-coder-small-2-2': {
      id: 'mercury-coder-small-2-2',
      providers: [
        { modelId: 'mercury-2', provider: 'inceptionlabs' },
        { modelId: 'google/gemini-2.0-flash', provider: 'vercelaigateway' }, // fallback
      ],
    },

    
    
    
    
    

    
    'openai/gpt-5.2': {
      id: 'openai/gpt-5.2',
      providers: [
        { modelId: 'openai/gpt-5.2', provider: 'vercelaigateway' },
        { modelId: 'openai/gpt-4o', provider: 'vercelaigateway' }, // downgrade fallback
        { modelId: 'google/gemini-2.5-flash', provider: 'vercelaigateway' }, // cross-provider fallback
      ],
    },
    





'openai/gpt-5.3-codex': {
      id: 'openai/gpt-5.3-codex',
      providers: [
        { modelId: 'openai/gpt-5.3-codex', provider: 'vercelaigateway' },
        { modelId: 'openai/gpt-5.2', provider: 'vercelaigateway' }, // downgrade fallback
        { modelId: 'google/gemini-2.5-flash', provider: 'vercelaigateway' }, // cross-provider fallback
      ],
    },
    // ── xAI Models — DISABLED: model IDs need verification from Vercel AI Gateway dashboard ──
// Known correct IDs: xai/grok-4.1-fast-reasoning, xai/grok-4.20-reasoning-beta
// Uncomment and fix IDs once confirmed:
// 'xai/grok-4-1': { ... },
// 'xai/grok-4.2': { ... },
// ── OpenAI Premium Models — failover via Vercel AI Gateway ──
'openai/gpt-5.4': {
      id: 'openai/gpt-5.4',
      providers: [
        { modelId: 'openai/gpt-5.4', provider: 'vercelaigateway' },
        { modelId: 'openai/gpt-5.2', provider: 'vercelaigateway' }, // downgrade fallback
        { modelId: 'google/gemini-2.5-pro', provider: 'vercelaigateway' }, // cross-provider fallback
      ],
    },

    // 2026-07-13: gateway-first for pho-fast/pho-pro. Groq free tier throttles at
    // 12k/6k TPM (hard 413s reached users, retry-after up to 142s), and Groq llama
    // pricing is unseeded in model_pricing (bills at conservative fallback).
    // Groq stays as fallback; requires a positive AI Gateway credit balance.
    'pho-fast': {
      id: 'pho-fast',
      providers: [
        { modelId: 'google/gemini-2.0-flash', provider: 'vercelaigateway' },
        { modelId: 'llama-3.1-8b-instant', provider: 'groq' },
        { modelId: 'llama3.1-8b', provider: 'cerebras' },
      ],
    },

    'pho-pro': {
      id: 'pho-pro',
      providers: [
        { modelId: 'google/gemini-2.5-flash', provider: 'vercelaigateway' },
        { modelId: 'llama-3.3-70b-versatile', provider: 'groq' },
      ],
    },

    'pho-smart': {
      id: 'pho-smart',
      providers: [
        { modelId: 'llama3.1-70b', provider: 'cerebras' },
        { modelId: 'llama-3.3-70b-versatile', provider: 'groq' },
        { modelId: 'google/gemini-2.5-flash', provider: 'vercelaigateway' },
      ],
    },

    'pho-vision': {
      id: 'pho-vision',
      providers: [{ modelId: 'google/gemini-2.5-flash', provider: 'vercelaigateway' }],
    },
  };

  /**
   * Resolve a model ID to a list of prioritized providers
   */
  resolveProviderList(modelId: string, provider?: string) {
    // If it's a logical model ID, return its configured list
    if (this.logicalModels[modelId]) {
      return this.logicalModels[modelId].providers;
    }

    // Default: Return the requested provider/model as the only option
    // (Existing behavior fallback)
    return [{ modelId, provider: provider || 'openai' }];
  }

  /**
   * Get a failover list for a specific model+provider combo
   * Used for backward compatibility with specific model IDs
   */
  getFailoverList(modelId: string, provider: string) {
    // If we have a logical mapping for this specific model ID, return it
    if (this.logicalModels[modelId]) {
      return this.logicalModels[modelId].providers;
    }

    // Default failover strategies for known providers
    switch (provider) {
      case 'groq':
      case 'cerebras':
      case 'fireworksai':
      case 'togetherai': {
        return [
          { modelId, provider },
          { modelId: this.mapToCloudflare(modelId), provider: 'cloudflare' },
        ];
      }
      default: {
        return [{ modelId, provider }];
      }
    }
  }

  /**
   * Check if a provider is explicitly disabled (e.g. for re-routing)
   */
  isProviderDisabled(provider: string): boolean {
    const DISABLED_PROVIDERS = new Set<string>([]);
    return DISABLED_PROVIDERS.has(provider);
  }

  /**
   * Remap a provider and model if necessary.
   *
   * Two responsibilities:
   * 1. Logical models (pho-pro, pho-fast, etc.) → resolve to their primary
   *    configured provider so the runtime gets the right API key.
   *    The modelId is kept as the logical name so resolveProviderList()
   *    can still return the full failover chain later.
   * 2. Real vendor models from disabled direct providers (google, openai, …)
   *    → redirect to Vercel AI Gateway with a provider-prefixed modelId.
   */
  remapProvider(provider: string, modelId: string): { modelId: string; provider: string } {
    // ── 1. Logical model resolution ──────────────────────────────
    // If the requested model is a logical model (e.g. 'pho-pro', 'mercury-coder-small-2-2'),
    // route to its primary provider and use that provider's actual API model ID.
    // e.g. internal 'mercury-coder-small-2-2' → provider 'inceptionlabs', modelId 'mercury-2'
    if (this.logicalModels[modelId]) {
      const primary = this.logicalModels[modelId].providers[0];
      return { modelId: primary.modelId, provider: primary.provider };
    }

    // ── 1.5. Deprecated model redirect ─────────────────────────
    // If the model has been sunset, redirect to its successor
    const resolvedModelId = MODEL_REDIRECTS[modelId] || modelId;
    if (resolvedModelId !== modelId) {
      console.log(`[Model Redirect] ${modelId} → ${resolvedModelId} (model sunset/deprecated)`);
    }

    // ── 2. Disabled-provider remap ───────────────────────────────
    // Providers that are disabled as direct API connections
    // and should be routed through Vercel AI Gateway instead.
    const REMAP_TO_VERCEL = new Set([
      'google', // No GOOGLE_API_KEY configured
      'openai', // OpenRouter disabled; direct OpenAI not used
      'anthropic', // No ANTHROPIC_API_KEY configured
      'deepseek', // Route through gateway for reliability
      'xai', // No XAI_API_KEY configured
      'vertexai', // VertexAI disabled — use Gateway instead
    ]);

    if (REMAP_TO_VERCEL.has(provider)) {
      // Vercel AI Gateway expects provider-prefixed model IDs
      // e.g., gemini-2.5-flash → google/gemini-2.5-flash
      // For vertexai, remap to google/ prefix
      const gatewayPrefix = provider === 'vertexai' ? 'google' : provider;
      let gatewayModelId = resolvedModelId;

      // ── Vercel AI Gateway model ID translation ──
      // Some providers use different model ID formats on the Gateway vs. their native API.
      // e.g. Anthropic native API: 'claude-opus-4-6' → Gateway slug: 'claude-opus-4.6'
      const GATEWAY_MODEL_TRANSLATION: Record<string, string> = {
        'claude-opus-4-6': 'claude-opus-4.6',
        'claude-opus-4-6-20250205': 'claude-opus-4.6',
        'claude-sonnet-4-6': 'claude-sonnet-4.6',
        'claude-sonnet-4-6-20250217': 'claude-sonnet-4.6',
      };

      if (GATEWAY_MODEL_TRANSLATION[gatewayModelId]) {
        const translated = GATEWAY_MODEL_TRANSLATION[gatewayModelId];
        console.log(
          `[Gateway Translation] ${gatewayModelId} → ${translated} (Vercel AI Gateway slug)`,
        );
        gatewayModelId = translated;
      }

      const prefixedModelId = gatewayModelId.includes('/')
        ? gatewayModelId
        : `${gatewayPrefix}/${gatewayModelId}`;

      // Check if the prefixed ID has a logical model entry for failover
      if (this.logicalModels[prefixedModelId]) {
        const primary = this.logicalModels[prefixedModelId].providers[0];
        return { modelId: primary.modelId, provider: primary.provider };
      }

      return { modelId: prefixedModelId, provider: 'vercelaigateway' };
    }

    return { modelId: resolvedModelId, provider };
  }

  private mapToCloudflare(modelId: string): string {
    if (modelId.includes('70b')) return '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    if (modelId.includes('8b')) return '@cf/meta/llama-3.1-8b-instruct';
    return '@cf/meta/llama-3.1-8b-instruct'; // Default fallback
  }
}

export const phoGatewayService = new PhoGatewayService();
