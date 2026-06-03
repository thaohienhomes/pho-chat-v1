/**
 * Centralized Pricing Configuration for Phở Chat
 * Based on PRICING_MASTERPLAN.md.md
 *
 * This file contains all pricing-related constants and types.
 * All other files should import from this central config.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface PlanConfig {
  advancedAI: boolean;
  code: string;
  dailyTier2Limit?: number;
  dailyTier3Limit?: number;
  // Medical/Beta defaults to avoid latency/quota issues
  defaultModel?: string;
  defaultProvider?: string;
  displayName: string;
  enableCustomAPI: boolean;
  enableKnowledgeBase: boolean;

  features: string[];
  // Legacy descriptive features
  keyLimits: string;
  monthlyPoints: number;
  price: number;

  priceYearly?: number;
  prioritySupport: boolean;

  /** Scientific Skills queries per day. -1 = unlimited, 0 = not available */
  scientificSkillsLimit?: number;

  // New Feature Flags & Limits (matching Plan Comparison)
  storageGB: number;
  vectorEntries: number;
}

export interface ModelTierConfig {
  inputCostPer1M: number;
  models: string[];
  outputCostPer1M: number;
  pointsPerMessage: number;
  tier: 1 | 2 | 3;
  tierName: string;
}

export interface PlanModelAccess {
  allowedTiers: number[];
  dailyLimits?: Record<string, number>;
  defaultModel: string;
  defaultProvider: string;
  models: string[];
}

// ============================================================================
// VIETNAM PLANS (VND - via Sepay/VietQR)
// ============================================================================

export const VN_PLANS: Record<string, PlanConfig> = {
  // Medical Beta: Free-tier base with boosted limits via promo code activation
  // Activation: promo code sets publicMetadata.planId = 'medical_beta'
  // Default model: Groq (Llama 3.1) — avoids high latency and quota limits
  medical_beta: {
    advancedAI: true,
    code: 'medical_beta',
    dailyTier2Limit: -1,
    // PHO-238: Tier 3 disabled — medical_beta is FREE-tier and was burning $26/hr on flagship models.
    // Defense-in-depth: blocked here, in PLAN_MODEL_ACCESS.allowedTiers, and in dailyCostCaps.ts.
    dailyTier3Limit: 0,
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    displayName: 'Phở Medical Beta 🏥',

    enableCustomAPI: true,

    enableKnowledgeBase: true,
    features: [
      '1M Phở Points/tháng',
      'Unlimited Tier 1 & 2',
      'Tier 3 yêu cầu nâng cấp (Pro/Ultimate)',
      'Scientific Skills không giới hạn',
      'PubMed, ArXiv, Drug Interaction, Clinical Calculator',
      'Research Mode + Deep Research',
    ],
    keyLimits: 'Unlim Tier 1 & 2. Tier 3 yêu cầu nâng cấp. Medical plugins.',
    monthlyPoints: 1_000_000,
    // 999k VNĐ/year — paid via Sepay/VietQR, activated by promo code
    price: 999_000,

    priceYearly: 999_000,

    prioritySupport: false,
    scientificSkillsLimit: -1,
    storageGB: 1,
    vectorEntries: 5000,
  },

  vn_basic: {
    advancedAI: false,
    code: 'vn_basic',
    dailyTier2Limit: 30,
    displayName: 'Phở Tái (Starter)',
    enableCustomAPI: true,
    enableKnowledgeBase: true,
    features: [
      'Unlimited Tier 1 models',
      '30 Tier 2 messages/day',
      'Conversation history',
      'File upload support',
      'Scientific Skills (5/ngày)',
      'No ads',
    ],

    keyLimits: 'Unlim Tier 1. 30 Tier 2 msgs/day.',

    monthlyPoints: 300_000,

    // Matched to Plan Comparison "Starter"
    price: 69_000,

    priceYearly: 690_000,

    prioritySupport: false,
    scientificSkillsLimit: 5,
    // New Features
    storageGB: 1,
    vectorEntries: 5000,
  },

  vn_free: {
    advancedAI: false,
    code: 'vn_free',
    displayName: 'Phở Không Người Lái (Free)',
    enableCustomAPI: false,
    enableKnowledgeBase: false,
    features: [
      'Tier 1 models only (GPT-4o-mini, Gemini Flash)',
      'Basic conversation',
      'No history saving',
    ],

    keyLimits: 'Tier 1 Models Only. No History.',

    monthlyPoints: 50_000,

    // Slight bump for Free
    price: 0,

    prioritySupport: false,
    scientificSkillsLimit: 0,
    // New Features
    storageGB: 0.5,
    vectorEntries: 0,
  },
  vn_premium: {
    advancedAI: true,
    code: 'vn_premium',
    dailyTier2Limit: -1, // Unlimited T2
    dailyTier3Limit: 20,
    displayName: 'Phở Bò Viên (Standard)',
    enableCustomAPI: true,
    enableKnowledgeBase: true,
    features: [
      '1M Phở Points/tháng',
      'Unlimited Tier 1 & 2 models',
      '20 Tier 3 messages/day',
      'Scientific Skills (20/ngày)',
      'Research Mode',
    ],
    keyLimits: 'Unlim Tier 1 & 2. 20 Tier 3 msgs/day.',
    monthlyPoints: 1_000_000,
    price: 129_000,
    priceYearly: 1_290_000,
    prioritySupport: false,
    scientificSkillsLimit: 20,
    storageGB: 2,
    vectorEntries: 10_000,
  },
  vn_pro: {
    advancedAI: false,
    code: 'vn_pro',
    dailyTier2Limit: -1, // Unlimited
    dailyTier3Limit: 50,
    displayName: 'Phở Đặc Biệt (Pro)',
    enableCustomAPI: true,
    enableKnowledgeBase: true,
    features: [
      '2M Phở Points/tháng',
      '~40 videos hoặc ~200 ảnh',
      'Unlimited Tier 1 & 2 models',
      '50 Tier 3 messages/day',
      'Scientific Skills không giới hạn',
      'Phở Studio access ✨',
    ],
    keyLimits: 'Unlim Tier 1 & 2. 50 Tier 3 msgs/day.',
    monthlyPoints: 2_000_000,
    price: 199_000,
    priceYearly: 1_990_000,
    prioritySupport: true,
    scientificSkillsLimit: -1,
    // New Features
    storageGB: 2,
    vectorEntries: 10_000,
  },
  vn_team: {
    advancedAI: true,
    code: 'vn_team',
    displayName: 'Lẩu Phở (Team)',
    enableCustomAPI: true,
    enableKnowledgeBase: true,
    features: [
      'All Premium features',
      'Admin Dashboard',
      'Pooled points for team',
      'User management',
      'Usage analytics',
    ],
    keyLimits: 'Min 3 users. Admin Dashboard.',
    monthlyPoints: 2_000_000, // Pooled - set to same as Pro per spec interaction
    price: 299_000,
    prioritySupport: true,
    scientificSkillsLimit: -1,
    // New Features
    storageGB: 4,
    vectorEntries: 20_000,
  },
  vn_ultimate: {
    advancedAI: true,
    code: 'vn_ultimate',
    dailyTier2Limit: -1, // Unlimited
    dailyTier3Limit: 100,
    displayName: 'Phở Siêu Đặc Biệt (Ultra)',
    enableCustomAPI: true,
    enableKnowledgeBase: true,
    features: [
      '5M Phở Points/tháng',
      '~100 videos hoặc ~500 ảnh',
      'Unlimited Tier 1 & 2 models',
      '100 Tier 3 messages/day',
      'Scientific Skills không giới hạn',
      'Phở Studio access ✨',
      'Priority support',
    ],
    keyLimits: 'Unlim Tier 1 & 2. 100 Tier 3 msgs/day. Studio Access.',
    monthlyPoints: 5_000_000,
    price: 499_000,
    priceYearly: 4_990_000,
    prioritySupport: true,
    scientificSkillsLimit: -1,
    storageGB: 4,
    vectorEntries: 20_000,
  },
} as const;

// ============================================================================
// GLOBAL PLANS (USD - via Polar.sh)
// ============================================================================

export const GLOBAL_PLANS: Record<string, PlanConfig> = {
  gl_lifetime: {
    advancedAI: true,
    code: 'gl_lifetime',
    dailyTier2Limit: -1, // Unlimited Tier 2 within monthly points cap
    displayName: 'Founding Member (Lifetime)',
    enableCustomAPI: true,
    enableKnowledgeBase: true,
    features: [
      'Phở Chat unlimited forever',
      '2M Phở Points/month (Chat only)',
      'Tier 1 & 2 model access',
      'Priority support',
      'Early access to new features',
      '⚠️ Studio NOT included',
    ],
    keyLimits: '2M points/mo (Chat only). No Studio.',
    monthlyPoints: 2_000_000,
    price: 149.99,
    prioritySupport: true,
    // New Features
    storageGB: 4,
    vectorEntries: 20_000,
  },
  gl_premium: {
    advancedAI: false,
    code: 'gl_premium',
    dailyTier2Limit: -1, // Unlimited Tier 2
    dailyTier3Limit: 50, // 50 Tier 3 messages/day
    displayName: 'Premium',
    enableCustomAPI: true,
    enableKnowledgeBase: true,
    features: [
      'Unlimited Tier 1 & 2 models',
      '50 Tier 3 messages/day',
      'Priority support',
      'All advanced features',
    ],
    keyLimits: 'Unlim Tier 1 & 2. 50 Tier 3 msgs/day.',
    monthlyPoints: 2_000_000,
    price: 19.99,
    priceYearly: 199.99,
    prioritySupport: true,
    // New Features
    storageGB: 2,
    vectorEntries: 10_000,
  },
  gl_standard: {
    advancedAI: false,
    code: 'gl_standard',
    dailyTier2Limit: 30, // 30 Tier 2 messages/day
    displayName: 'Starter',
    enableCustomAPI: true,
    enableKnowledgeBase: true,
    features: [
      'Unlimited Tier 1 models',
      '30 Tier 2 messages/day',
      'Conversation history',
      'File upload support',
    ],
    keyLimits: 'Unlim Tier 1. 30 Tier 2 msgs/day.',
    monthlyPoints: 300_000,
    price: 9.99,
    priceYearly: 99.99,
    prioritySupport: false,
    // New Features
    storageGB: 1,
    vectorEntries: 5000,
  },
  gl_starter: {
    advancedAI: false,
    code: 'gl_starter',
    displayName: 'Free',
    enableCustomAPI: false,
    enableKnowledgeBase: false,
    features: ['Tier 1 models only', 'Basic conversation', 'Limited history'],
    keyLimits: 'Tier 1 Models Only. Limited History.',
    monthlyPoints: 50_000,
    price: 0,
    prioritySupport: false,
    // New Features
    storageGB: 0.5,
    vectorEntries: 0,
  },
  // Lifetime Deal Plans
  lifetime_early_bird: {
    advancedAI: true,
    code: 'lifetime_early_bird',
    dailyTier2Limit: -1,
    dailyTier3Limit: 50,
    displayName: 'Lifetime Early Bird',
    enableCustomAPI: true,
    enableKnowledgeBase: true,
    features: [
      'All Premium features',
      'Lifetime access',
      '2M Points/Month (Reset)',
      'Priority Support',
    ],
    keyLimits: 'Lifetime Access. 2M Points/Mo.',
    monthlyPoints: 2_000_000,
    price: 89,
    prioritySupport: true,
    storageGB: 4,
    vectorEntries: 20_000,
  },
  lifetime_last_call: {
    advancedAI: true,
    code: 'lifetime_last_call',
    dailyTier2Limit: -1,
    dailyTier3Limit: 50,
    displayName: 'Lifetime Last Call',
    enableCustomAPI: true,
    enableKnowledgeBase: true,
    features: [
      'All Premium features',
      'Lifetime access',
      '2M Points/Month (Reset)',
      'Priority Support',
    ],
    keyLimits: 'Lifetime Access. 2M Points/Mo.',
    monthlyPoints: 2_000_000,
    price: 149.99,
    prioritySupport: true,
    storageGB: 4,
    vectorEntries: 20_000,
  },
  lifetime_standard: {
    advancedAI: true,
    code: 'lifetime_standard',
    dailyTier2Limit: -1,
    dailyTier3Limit: 50,
    displayName: 'Lifetime Standard',
    enableCustomAPI: true,
    enableKnowledgeBase: true,
    features: [
      'All Premium features',
      'Lifetime access',
      '2M Points/Month (Reset)',
      'Priority Support',
    ],
    keyLimits: 'Lifetime Access. 2M Points/Mo.',
    monthlyPoints: 2_000_000,
    price: 119,
    prioritySupport: true,
    storageGB: 4,
    vectorEntries: 20_000,
  },
} as const;

// ============================================================================
// PLAN-TO-MODELS ACCESS MAPPING
// ============================================================================

// ============================================================================
// SHARED MODEL ARRAYS (used by PLAN_MODEL_ACCESS below)
// Single source of truth - update here to propagate to all plans
// ============================================================================

/** Tier 1: Budget models — available to ALL plans including Free */
const TIER1_MODELS = [
  // Phở Logical Models
  'pho-fast',
  // Vercel AI Gateway (Primary for Gemini)
  'google/gemini-2.0-flash',
  'google/gemini-3.1-flash-lite-preview',
  'deepseek/deepseek-chat',
  // Groq (via CF Gateway)
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
  'gemma-3-27b-it', // Gemma 3 27B — NEW: strong tool calling, cheap
  'mistral-saba-24b',
  'meta-llama/llama-4-scout-17b-16e-instruct', // Llama 4 Scout — moved from Tier 2: fast & cheap
  'llama-4-scout-17b', // Logical alias used in phochat picker
  // Cerebras (via CF Gateway)
  'llama3.1-8b',
  'llama3.1-70b',
  // Fireworks AI (via CF Gateway)
  'accounts/fireworks/models/llama-v3p1-8b-instruct',
  'accounts/fireworks/models/llama-v3p1-70b-instruct',
  // Legacy short IDs (for backward compat & tier lookup)
  'gemini-2.0-flash',
  'gemini-3.1-flash-lite-preview',
  'gpt-4o-mini',
  'gemini-1.5-flash',
  'claude-3-haiku',
  'deepseek-chat',
  'qwen-turbo',
  'llama-4-scout', // Legacy short ID for Llama 4 Scout
  // InceptionLabs Mercury — ultra-fast diffusion LLM (1000+ tok/s)
  'mercury-coder-small-2-2', // Mercury 2
  'mercury-coder-small-2', // Mercury Coder Small
] as const;

/** Tier 2: Standard models — available to Basic/Starter+ plans */
const TIER2_MODELS = [
  // Phở Logical Models
  'pho-pro',
  'pho-vision',
  // Vercel AI Gateway (Primary for premium models)
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'google/gemini-3-flash-preview',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-4-20250514',
  'openai/gpt-5.2',
  'openai/gpt-4o',
  'openai/gpt-4.1',
  'deepseek/deepseek-r1',
  'xai/grok-4',
  'xai/grok-4-1', // Grok 4.1 — latest xAI model
  'nvidia/nemotron-3-nano-30b-a3b', // Nemotron Nano 30B
  'meta-llama/llama-4-70b-instruct',
  // Groq Tier 2 (via CF Gateway)
  'deepseek-r1-distill-llama-70b',
  'qwen-qwq-32b',
  'meta-llama/llama-4-maverick-17b-128e-instruct', // Scout moved to Tier 1
  'qwen/qwen3-32b',
  // Together AI — Kimi K2
  'moonshotai/Kimi-K2-Instruct', // NEW: Kimi K2 — excellent tool calling, 128K ctx
  'kimi-k2', // Logical alias used in phochat picker
  // Together AI (via CF Gateway)
  'Qwen/Qwen2.5-72B-Instruct-Turbo',
  'deepseek-ai/DeepSeek-R1',
  'deepseek-ai/DeepSeek-V3',
  // Legacy short IDs (for backward compat & tier lookup)
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gpt-4o',
  'gpt-4.1',
  'claude-3-5-sonnet',
  'claude-3-sonnet',
  'gemini-1.5-pro',
  'deepseek-reasoner',
  'nemotron-3-nano-30b-a3b', // Legacy short ID
  'grok-4-1', // Legacy short ID
] as const;

/** Tier 3: Premium models — available to Pro/Ultimate/Team/Lifetime plans */
const TIER3_MODELS = [
  // Phở Logical Models
  'pho-smart',
  // Vercel AI Gateway
  'google/gemini-3-pro-preview',
  'google/gemini-3.1-pro-preview',
  'anthropic/claude-opus-4-20250514',
  'anthropic/claude-opus-4.6',
  'openai/o3-mini',
  'openai/gpt-5.4', // GPT-5.4 — expensive, Tier 3 to limit usage
  'gpt-5.4', // Legacy short ID
  // Legacy short IDs (for backward compat & tier lookup)
  'gemini-3-pro-preview',
  'gemini-3.1-pro-preview',
  'claude-opus-4-6',
  'gpt-4-turbo',
  'claude-3-opus',
  'o1',
  'o1-preview',
  'o1-pro',
  'o3',
] as const;

/**
 * Defines which models are allowed for each subscription plan
 * and sets default model selection per plan
 */
export const PLAN_MODEL_ACCESS: Record<string, PlanModelAccess> = {
  // GLOBAL PLANS - Primary providers: Vercel Gateway, Groq, Cerebras
  // ============================================================================

  // Global Lifetime: Tier 1 & 2 - Behaves like PRO with 2M points monthly reset
  gl_lifetime: {
    allowedTiers: [1, 2],
    dailyLimits: { tier2: -1 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS],
  },

  // Global Premium (Pro): Tier 1 & 2 with 2M points cap
  gl_premium: {
    allowedTiers: [1, 2],
    dailyLimits: { tier2: -1 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS],
  },

  // Global Standard: Tier 1 & 2 with daily limits
  gl_standard: {
    allowedTiers: [1, 2],
    dailyLimits: { tier2: 30 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS],
  },

  // Global Starter Plan: Tier 1 ONLY
  gl_starter: {
    allowedTiers: [1],
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS],
  },

  // ============================================================================
  // LIFETIME DEAL PLANS - All tiers with 2M points/month
  // ============================================================================

  lifetime_early_bird: {
    allowedTiers: [1, 2, 3],
    dailyLimits: { tier2: -1, tier3: 50 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS, ...TIER3_MODELS],
  },

  lifetime_last_call: {
    allowedTiers: [1, 2, 3],
    dailyLimits: { tier2: -1, tier3: 50 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS, ...TIER3_MODELS],
  },

  lifetime_standard: {
    allowedTiers: [1, 2, 3],
    dailyLimits: { tier2: -1, tier3: 50 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS, ...TIER3_MODELS],
  },

  // Medical Beta: Tier 1 + Tier 2 only — Groq primary
  // PHO-238: Tier 3 disabled. medical_beta is FREE-tier (promo activation) and was
  // burning $26/hr on Tier 3 flagship models. Defense-in-depth alongside
  // VN_PLANS.medical_beta.dailyTier3Limit = 0 and dailyCostCaps.ts T3 = $0.
  medical_beta: {
    allowedTiers: [1, 2],
    // PHO cost audit (2026-06): medical_beta is a near-free promo. Tier 2 was
    // unlimited and a single user burned ~$22/day on it, far above the intended
    // $3/day USD cap (which can be slipped by a request-timing race or an env
    // override). An atomic per-day message limit hard-bounds it. Tunable.
    dailyLimits: { tier2: 30 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS],
  },

  // VN Basic (Phở Tái): Tier 1 + Tier 2 with 30 messages/day limit
  vn_basic: {
    allowedTiers: [1, 2],
    dailyLimits: { tier2: 30 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS],
  },

  // VN Free: Tier 1 ONLY with 50,000 points/month
  vn_free: {
    allowedTiers: [1],
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS],
  },

  // ============================================================================
  // VIETNAM PLANS - Primary providers: Vercel Gateway, Groq, Cerebras
  // ============================================================================
  // VN Premium (Phở Bò Viên): All tiers with 20 Tier 3 messages/day
  vn_premium: {
    allowedTiers: [1, 2, 3],
    dailyLimits: { tier2: -1, tier3: 20 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS, ...TIER3_MODELS],
  },

  // VN Pro (Phở Đặc Biệt): All tiers with 50 Tier 3 messages/day
  vn_pro: {
    allowedTiers: [1, 2, 3],
    dailyLimits: { tier2: -1, tier3: 50 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS, ...TIER3_MODELS],
  },

  // VN Team: All tiers (enterprise plan)
  vn_team: {
    allowedTiers: [1, 2, 3],
    dailyLimits: { tier3: 100 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS, ...TIER3_MODELS],
  },

  // VN Ultimate (Phở Pro): All tiers with 100 Tier 3 messages/day + Studio access
  vn_ultimate: {
    allowedTiers: [1, 2, 3],
    dailyLimits: { tier2: -1, tier3: 100 },
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS, ...TIER3_MODELS],
  },
};

// ============================================================================
// MODEL TIERS (Points-based pricing)
// ============================================================================

/**
 * Model tier mapping with comprehensive model IDs
 * Includes both short names and full OpenRouter-style IDs
 *
 * Tier 1: Budget models - Available to FREE/BASIC plans
 * Tier 2: Standard models - Available to PRO plans (Phở Tái, Standard)
 * Tier 3: Premium models - Available to TEAM/Enterprise plans (Phở Đặc Biệt)
 */
export const MODEL_TIERS: Record<number, ModelTierConfig> = {
  1: {
    inputCostPer1M: 5,
    models: [
      // Phở Logical Models
      'pho-fast',
      // OpenAI budget models (legacy IDs)
      'gpt-4o-mini',
      'openai/gpt-4o-mini',
      // Google budget models (legacy IDs)
      'gemini-1.5-flash',
      'gemini-2.0-flash',
      'gemini-flash-1.5',
      'gemini-2.0-flash-001',
      'google/gemini-flash-1.5',
      'google/gemini-2.0-flash-001',
      'google/gemma-2-9b-it',
      'google/gemma-2-9b-it:free',
      // Anthropic budget models (legacy IDs)
      'claude-3-haiku',
      'claude-3.5-haiku',
      'anthropic/claude-3-haiku',
      'anthropic/claude-3.5-haiku',
      // DeepSeek budget models
      'deepseek-chat',
      'deepseek/deepseek-chat',
      'deepseek/deepseek-r1:free',
      // Qwen budget models
      'qwen-turbo',
      'qwen/qwen-2-7b-instruct:free',
      // Meta LLaMA models (free tier)
      'meta-llama/llama-3.1-8b-instruct:free',
      'meta-llama/llama-3.2-11b-vision-instruct',
      'meta-llama/llama-3.3-70b-instruct:free',
      // ============================================
      // Legacy Tier 1 Models
      // ============================================
      'gemini-2.0-flash', // Fast, reliable
      'gemini-3.1-flash-lite-preview', // Fastest response (upgraded from 2.5 Lite)
      // ============================================
      // Vercel AI Gateway Tier 1 Models
      // ============================================
      'google/gemini-2.0-flash', // Vercel AI Gateway
      'deepseek/deepseek-chat', // Vercel AI Gateway - DeepSeek V3
      // ============================================
      // Groq Tier 1 Models (via CF Gateway)
      // ============================================
      'llama-3.1-8b-instant', // Groq - fastest
      'llama-3.3-70b-versatile', // Groq - best quality
      'mixtral-8x7b-32768', // Groq - Mixtral
      'gemma2-9b-it', // Groq - Gemma 2
      'gemma-3-27b-it', // Groq - Gemma 3 27B (NEW)
      'meta-llama/llama-4-scout-17b-16e-instruct', // Groq - Llama 4 Scout (moved from Tier 2)
      'llama-4-scout', // Legacy short ID
      // ============================================
      // Cerebras Tier 1 Models (via CF Gateway)
      // ============================================
      'llama3.1-8b', // Cerebras - fastest inference
      'llama3.1-70b', // Cerebras - quality
      // ============================================
      // Fireworks AI Tier 1 Models (via CF Gateway)
      // ============================================
      'accounts/fireworks/models/llama-v3p1-8b-instruct', // Fireworks AI
      'accounts/fireworks/models/llama-v3p1-70b-instruct', // Fireworks AI
      // ============================================
      // InceptionLabs Mercury (Tier 1 — ultra-fast)
      // ============================================
      'mercury-coder-small-2-2', // Mercury 2
      'mercury-coder-small-2', // Mercury Coder Small
      // Kimi K2.5 (via phochat)
      'kimi-k2.5', // Kimi K2.5 (upgraded from K2)
    ],
    outputCostPer1M: 15, // Cost per 1M output tokens
    pointsPerMessage: 5, // ~15-20 points per typical message
    tier: 1,
    tierName: 'Cheap (Budget)',
  },
  2: {
    inputCostPer1M: 100,
    models: [
      // Phở Logical Models
      'pho-pro',
      'pho-vision',
      // OpenAI standard models (legacy IDs)
      'gpt-4o',
      'openai/gpt-4o',
      'gpt-4.1',
      // Anthropic standard models (legacy IDs)
      'claude-3.5-sonnet',
      'claude-3-5-sonnet',
      'claude-3-sonnet',
      'anthropic/claude-3.5-sonnet',
      // Google standard models (legacy IDs)
      'gemini-1.5-pro',
      'gemini-2.5-pro',
      'gemini-pro-1.5',
      'google/gemini-pro-1.5',
      'google/gemini-2.0-pro-exp-02-05:free',
      // DeepSeek premium models
      'deepseek-reasoner',
      'deepseek-r1',
      'deepseek/deepseek-r1',
      // Meta LLaMA premium models
      'meta-llama/llama-3.2-90b-vision-instruct',
      'meta-llama/llama-3.3-70b-instruct',
      // Auto model - maps to Tier 2 by default since it routes to best model
      'Together/auto',
      // ============================================
      // Legacy Tier 2 Models
      // ============================================
      'gemini-2.5-flash', // Best value for performance
      'gemini-2.5-pro', // High quality, 2M context
      'gemini-3-flash-preview', // Latest Gemini 3 (Preview)
      // ============================================
      // Vercel AI Gateway Tier 2 Models
      // ============================================
      'google/gemini-2.5-flash', // Vercel AI Gateway
      'google/gemini-2.5-pro', // Vercel AI Gateway
      'anthropic/claude-sonnet-4.5', // Vercel AI Gateway
      'anthropic/claude-sonnet-4.6', // Vercel AI Gateway — Claude Sonnet 4.6
      'claude-sonnet-4.6', // Legacy short ID
      'anthropic/claude-sonnet-4-20250514', // Vercel AI Gateway — Claude 4 Sonnet
      'anthropic/claude-haiku-4.5', // Vercel AI Gateway
      'openai/gpt-5.2', // Vercel AI Gateway
      'openai/gpt-4o', // Vercel AI Gateway — retired but kept for legacy
      'openai/gpt-5.3-codex', // Vercel AI Gateway — GPT-5.3 Codex (NEW)
      'deepseek/deepseek-r1', // Vercel AI Gateway
      'xai/grok-4', // Vercel AI Gateway — legacy
      'xai/grok-4.2', // Vercel AI Gateway — Grok 4.2 (NEW)
      'moonshot/kimi-k2.5', // Vercel AI Gateway — Kimi K2.5 (NEW)
      'meta-llama/llama-4-70b-instruct', // Vercel AI Gateway
      // ============================================
      // Together AI Tier 2 Models (via CF Gateway)
      // ============================================
      'Qwen/Qwen2.5-72B-Instruct-Turbo', // Together AI - Qwen 2.5
      'deepseek-ai/DeepSeek-R1', // Together AI - DeepSeek R1
      'deepseek-ai/DeepSeek-V3', // Together AI - DeepSeek V3
      'moonshotai/Kimi-K2-Instruct', // Together AI - Kimi K2 (legacy)
      'moonshotai/Kimi-K2.5-Instruct', // Together AI - Kimi K2.5 (NEW)
      // ============================================
      // Groq Tier 2 Models (via CF Gateway)
      // ============================================
      'deepseek-r1-distill-llama-70b', // Groq - DeepSeek R1 Distill
      'qwen-qwq-32b', // Groq - Qwen QwQ reasoning
      'meta-llama/llama-4-maverick-17b-128e-instruct', // Groq - Llama 4 Maverick (Scout moved to T1)
      // ============================================
      // NVIDIA (via Vercel AI Gateway)
      // ============================================
      'nvidia/nemotron-3-nano-30b-a3b', // Nemotron Nano 30B
      'nemotron-3-nano-30b-a3b', // Legacy short ID
      // ============================================
      // xAI (via Vercel AI Gateway)
      // ============================================
      'xai/grok-4-1', // Grok 4.1 — latest
      'grok-4-1', // Legacy short ID
    ],
    outputCostPer1M: 300,
    pointsPerMessage: 150,
    tier: 2,
    tierName: 'Standard',
  },
  3: {
    inputCostPer1M: 500,
    models: [
      // Phở Logical Models
      'pho-smart',
      // OpenAI premium models (legacy IDs)
      'gpt-4-turbo',
      'o1',
      'o1-mini',
      'o1-preview',
      'o1-pro',
      'o3',
      'openai/o1',
      'openai/o1-mini',
      'openai/o1-preview',
      // Anthropic premium models (legacy IDs)
      'claude-3-opus',
      'anthropic/claude-3-opus',
      'anthropic/claude-opus-4-20250514', // Vercel AI Gateway — Claude 4 Opus
      'anthropic/claude-opus-4.6', // Vercel AI Gateway — Claude Opus 4.6
      'claude-opus-4.6', // Legacy short ID
      'google/gemini-3.1-pro-preview', // Vercel AI Gateway — Gemini 3.1 Pro
      'gemini-3.1-pro-preview', // Legacy short ID
      'openai/gpt-5.4', // Vercel AI Gateway — GPT-5.4 (Tier 3)
      'gpt-5.4', // Legacy short ID
      // ============================================
      // Legacy Tier 3 Models
      // ============================================
      'gemini-3-pro-preview', // Latest Gemini 3 Pro
    ],
    outputCostPer1M: 1500,
    pointsPerMessage: 1000,
    tier: 3,
    tierName: 'Expensive (Premium)',
  },
} as const;

// ============================================================================
// PLAN USAGE ESTIMATES (for comparison table)
// ============================================================================
// Based on:
// - Tier 1 message: ~5 points (GPT-4o-mini)
// - Tier 2 message: ~150 points (GPT-4o, Claude 3.5)
// - Tier 3 message: ~1000 points (o1, Claude Opus)
// - Image (Flux Pro): ~10,000 points
// - Video 5s (Instant): ~50,000 points
// - Audio 10s: ~20,000 points

export const PLAN_USAGE_ESTIMATES = {
  gl_lifetime: {
    hasStudio: false,
    images: '0 (Chat only)',
    monthlyPoints: 2_000_000,
    tier1Messages: '~400,000',
    tier2Messages: '~13,000',
    tier3Messages: '~2,000',
    videos: '0 (No Studio)',
  },

  gl_premium: {
    hasStudio: true,
    images: '~200',
    monthlyPoints: 2_000_000,
    tier1Messages: '~400,000',
    tier2Messages: '~13,000',
    tier3Messages: '~2,000',
    videos: '~40',
  },

  gl_standard: {
    hasStudio: false,
    images: '~30',
    monthlyPoints: 300_000,
    tier1Messages: '~60,000',
    tier2Messages: '~2,000',
    tier3Messages: '0',
    videos: '0 (No Studio)',
  },

  // Global Plans
  gl_starter: {
    hasStudio: false,
    images: '~5',
    monthlyPoints: 50_000,
    tier1Messages: '~10,000',
    tier2Messages: '~300',
    tier3Messages: '0',
    videos: '0 (No Studio)',
  },

  // Medical Beta (upgraded March 2026)
  medical_beta: {
    hasStudio: false,
    images: '~100',
    monthlyPoints: 1_000_000,
    tier1Messages: '~200,000',
    tier2Messages: '~6,600',
    tier3Messages: '~1,000',
    videos: '0 (No Studio)',
  },

  vn_basic: {
    hasStudio: false,
    images: '~30',
    monthlyPoints: 300_000,
    tier1Messages: '~60,000',
    tier2Messages: '~2,000',
    tier3Messages: '0',
    videos: '0 (No Studio)',
  },

  // VN Plans
  vn_free: {
    hasStudio: false,
    images: '~5',
    monthlyPoints: 50_000,
    tier1Messages: '~10,000',
    tier2Messages: '~300',
    tier3Messages: '0',
    videos: '0 (No Studio)',
  },

  vn_premium: {
    hasStudio: true,
    images: '~100',
    monthlyPoints: 1_000_000,
    tier1Messages: '~200,000',
    tier2Messages: '~6,600',
    tier3Messages: '~1,000',
    videos: '~20',
  },
  vn_pro: {
    hasStudio: true,
    images: '~200',
    monthlyPoints: 2_000_000,
    tier1Messages: '~400,000',
    tier2Messages: '~13,000',
    tier3Messages: '~2,000',
    videos: '~40',
  },
  vn_ultimate: {
    hasStudio: true,
    images: '~500',
    monthlyPoints: 5_000_000,
    tier1Messages: '~1,000,000',
    tier2Messages: '~33,000',
    tier3Messages: '~5,000',
    videos: '~100',
  },
} as const;

// ============================================================================
// POLAR PRODUCT IDS (for global payments)
// ============================================================================

export const POLAR_PRODUCT_IDS = {
  gl_lifetime: 'polar_prod_ltd_id',
  gl_premium: 'polar_prod_prem_id',
  gl_standard: 'polar_prod_std_id',
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get model tier by model name
 * Supports both full OpenRouter-style IDs (e.g., 'openai/gpt-4o-mini')
 * and short model names (e.g., 'gpt-4o-mini')
 *
 * Matching priority:
 * 1. Exact match with the full model ID
 * 2. Exact match with model ID without :free suffix
 * 3. Partial match (model name contains the tier model)
 */
export function getModelTier(modelName: string): number {
  const normalizedName = modelName.toLowerCase();
  // Remove :free suffix for matching (free variants inherit tier from base model)
  const nameWithoutFreeSuffix = normalizedName.replace(/:free$/, '');

  // Priority 1: Check for exact match first
  for (const [tier, config] of Object.entries(MODEL_TIERS)) {
    if (
      config.models.some(
        (m) => normalizedName === m.toLowerCase() || nameWithoutFreeSuffix === m.toLowerCase(),
      )
    ) {
      return Number(tier);
    }
  }

  // Priority 2: Check if model name contains any tier model (partial match)
  // This handles cases where the model ID might have extra prefixes/suffixes
  for (const [tier, config] of Object.entries(MODEL_TIERS)) {
    if (
      config.models.some(
        (m) => normalizedName.includes(m.toLowerCase()) || m.toLowerCase().includes(normalizedName),
      )
    ) {
      return Number(tier);
    }
  }

  // Default to Tier 2 for unknown models (safer default - requires paid plan)
  return 2;
}

/**
 * Get points cost for a model
 */
export function getModelPointsCost(modelName: string): number {
  const tier = getModelTier(modelName);
  return MODEL_TIERS[tier as keyof typeof MODEL_TIERS]?.pointsPerMessage ?? 150;
}

/**
 * Calculate points for token usage
 */
export function calculatePointsFromTokens(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const tier = getModelTier(modelName);
  const tierConfig = MODEL_TIERS[tier as keyof typeof MODEL_TIERS];

  if (!tierConfig) return 150; // Default

  const inputCost = (inputTokens / 1_000_000) * tierConfig.inputCostPer1M;
  const outputCost = (outputTokens / 1_000_000) * tierConfig.outputCostPer1M;

  return Math.ceil(inputCost + outputCost);
}

/**
 * Get plan by code (works for both VN and Global)
 */
export function getPlanByCode(code: string): PlanConfig | undefined {
  return VN_PLANS[code] || GLOBAL_PLANS[code];
}

/**
 * Monthly Phở Points entitlement for a plan code (0 if unknown).
 * Single source of truth for the monthly-grant cron and payment webhooks.
 */
export function getMonthlyPointsForPlan(code: string): number {
  return getPlanByCode(code)?.monthlyPoints ?? 0;
}

/**
 * Whether a plan receives a recurring monthly points grant.
 * True for every paid plan (price > 0) and lifetime plan that has a positive
 * monthlyPoints allowance. Free tiers (price === 0, e.g. vn_free) are excluded.
 */
export function isMonthlyGrantPlan(code: string): boolean {
  const plan = getPlanByCode(code);
  if (!plan) return false;
  return (plan.price ?? 0) > 0 && (plan.monthlyPoints ?? 0) > 0;
}

/**
 * All plan codes eligible for the monthly points grant.
 * Used by the grant cron to select affected users.
 */
export function getMonthlyGrantPlanCodes(): string[] {
  return [...Object.keys(VN_PLANS), ...Object.keys(GLOBAL_PLANS)].filter(isMonthlyGrantPlan);
}

/**
 * Check if user can use a model tier based on their plan
 * Uses PLAN_MODEL_ACCESS.allowedTiers for accurate tier checking
 */
export function canUseTier(planCode: string, tier: number): boolean {
  // Use PLAN_MODEL_ACCESS as the source of truth
  const planAccess = PLAN_MODEL_ACCESS[planCode];
  if (planAccess?.allowedTiers) {
    return planAccess.allowedTiers.includes(tier);
  }

  // Fallback: check plan config
  const plan = getPlanByCode(planCode);
  if (!plan) return tier === 1;

  // Free plans: Tier 1 only
  if (plan.price === 0 && !planCode.includes('lifetime')) return tier === 1;

  // Default: allow tier 1 only for unknown plans
  return tier === 1;
}

/**
 * Get daily limit for a tier based on plan
 */
export function getDailyTierLimit(planCode: string, tier: number): number {
  const plan = getPlanByCode(planCode);
  if (!plan) return tier === 1 ? -1 : 0;

  if (tier === 1) return -1; // Always unlimited

  if (tier === 2) {
    return plan.dailyTier2Limit ?? 0;
  }

  if (tier === 3) {
    return plan.dailyTier3Limit ?? 0;
  }

  return 0;
}

// ============================================================================
// DAILY REQUEST CAP — Circuit breaker to prevent runaway spending
// Reset at 00:00 UTC+7 (Vietnam time). Returns -1 for unlimited.
// ============================================================================

export const DAILY_REQUEST_CAP: Record<string, number> = {
  // Pro plans
  gl_premium: 500,

  // Basic plans
  gl_standard: 100,

  // Free / unknown — strict cap
  gl_starter: 20,

  // Ultimate / Lifetime — generous cap
  lifetime_early_bird: 1000,

  lifetime_last_call: 1000,

  lifetime_standard: 1000,

  // Medical beta — moderate cap (was burning 71% of total cost)
  medical_beta: 50,

  vn_basic: 100,

  vn_free: 20,
  // Premium plans
  vn_premium: 200,
  vn_pro: 500,
  vn_team: 1000,
  vn_ultimate: 1000,
};

/** Get daily request cap for a plan. Returns -1 for unknown plans (fail open). */
export function getDailyRequestCap(planCode: string): number {
  return DAILY_REQUEST_CAP[planCode] ?? 20; // Default: strict 20 for unknown plans
}

// ============================================================================
// LEGACY MAPPINGS (for backward compatibility)
// ============================================================================

export const LEGACY_PLAN_MAPPING: Record<string, string> = {
  free: 'vn_free',
  premium: 'vn_basic',
  starter: 'vn_free',
  ultimate: 'vn_pro',
} as const;

export function getLegacyPlanMapping(legacyId: string): string {
  return LEGACY_PLAN_MAPPING[legacyId] || legacyId;
}

// ============================================================================
// PLAN MODEL ACCESS HELPERS
// ============================================================================

/**
 * Get allowed models for a subscription plan
 */
export function getAllowedModelsForPlan(planCode: string): string[] {
  const planAccess = PLAN_MODEL_ACCESS[planCode];
  if (!planAccess) {
    // Default to free plan models if plan not found
    return PLAN_MODEL_ACCESS.vn_free.models;
  }
  return planAccess.models;
}

/**
 * Get default model and provider for a subscription plan
 */
export function getDefaultModelForPlan(planCode: string): { model: string; provider: string } {
  const planAccess = PLAN_MODEL_ACCESS[planCode];
  if (!planAccess) {
    return {
      model: PLAN_MODEL_ACCESS.vn_free.defaultModel,
      provider: PLAN_MODEL_ACCESS.vn_free.defaultProvider,
    };
  }
  return {
    model: planAccess.defaultModel,
    provider: planAccess.defaultProvider,
  };
}

/**
 * Check if a plan can use a specific model
 */
export function canPlanUseModel(planCode: string, modelId: string): boolean {
  const allowedModels = getAllowedModelsForPlan(planCode);
  return allowedModels.includes(modelId);
}

/**
 * Get required providers for a plan (based on allowed models)
 */
export function getRequiredProvidersForPlan(planCode: string): string[] {
  const allowedModels = getAllowedModelsForPlan(planCode);

  // Model to provider mapping
  const modelProviderMap: Record<string, string> = {
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

  const providers = new Set<string>();
  allowedModels.forEach((model) => {
    const provider = modelProviderMap[model];
    if (provider) {
      providers.add(provider);
    }
  });

  return Array.from(providers);
}

/**
 * Get Scientific Skills daily limit for a subscription plan
 * Returns: -1 = unlimited, 0 = not available, N = daily limit
 */
export function getScientificSkillsLimit(planCode: string): number {
  const plan = getPlanByCode(planCode);
  return plan?.scientificSkillsLimit ?? 0;
}

/**
 * Get allowed tiers for a subscription plan
 */
export function getAllowedTiersForPlan(planCode: string): number[] {
  const planAccess = PLAN_MODEL_ACCESS[planCode];
  if (!planAccess) {
    return PLAN_MODEL_ACCESS.vn_free.allowedTiers;
  }
  return planAccess.allowedTiers;
}
