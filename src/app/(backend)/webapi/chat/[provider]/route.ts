import {
  AGENT_RUNTIME_ERROR_SET,
  AgentRuntimeErrorType,
  ChatCompletionErrorPayload,
  ModelRuntime,
} from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import console from 'node:console';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { getModelTier } from '@/config/pricing';
import { modelPricing } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { createTraceOptions, initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import {
  isCostOptimizationEnabled,
  isIntelligentRoutingEnabled,
  isUsageTrackingEnabled,
} from '@/server/services/FeatureFlags';
import {
  checkDailyRequestCap,
  checkTierAccess,
  getUserCreditBalance,
  processModelUsage,
} from '@/server/services/billing/credits';
import { checkDailyCostCap } from '@/server/services/billing/dailyCostAggregation';
import { getSecondsUntilMidnightVN } from '@/server/services/billing/dailyCostCaps';
import { phoGatewayService } from '@/server/services/phoGateway';
import { getUserPlanIdFromDB } from '@/server/services/subscription/getUserPlanFromDB';
import { ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { getTracePayload } from '@/utils/trace';

export const maxDuration = 300;

// TODO: Re-enable when usage tracking is fully implemented
// async function trackUsageAfterCompletion(params: {
//   costEngine: CostOptimizationEngine;
//   inputTokens: number;
//   model: string;
//   outputTokens: number;
//   provider: string;
//   responseTimeMs: number;
//   sessionId: string;
//   usageTracker: UsageTracker;
//   userId: string;
// }): Promise<void> {
//   try {
//     const cost = params.costEngine.calculateCost({
//       inputTokens: params.inputTokens,
//       model: params.model,
//       outputTokens: params.outputTokens,
//       sessionId: params.sessionId,
//       userId: params.userId,
//     });
//     let complexity: 'simple' | 'medium' | 'complex' = 'simple';
//     if (params.inputTokens > 500) complexity = 'complex';
//     else if (params.inputTokens > 100) complexity = 'medium';
//     await params.usageTracker.trackUsage({
//       costUSD: cost,
//       inputTokens: params.inputTokens,
//       model: params.model,
//       outputTokens: params.outputTokens,
//       provider: params.provider,
//       queryComplexity: complexity,
//       sessionId: params.sessionId,
//     });
//     console.log(`📊 Usage tracked: ${params.model} - ${cost.toFixed(6)} USD`);
//   } catch (error) {
//     console.error('Failed to track usage:', error);
//   }
// }

// Conservative fail-safe pricing for models with NO `model_pricing` DB row.
// Points/1M tokens, where points = USD/1M × 25_000 (1 pt ≈ $0.00004, the seed
// ratio in scripts/seed-model-pricing-gateway.ts). Rates are pinned to roughly
// the MOST EXPENSIVE model in each tier so an un-seeded model is billed ~its
// real cost instead of leaking. PHO cost-leak fix (2026-06): the previous
// fallback used MODEL_TIERS rates (100/300 pts ≈ $0.004/$0.012 per 1M), ~800x
// below real flagship cost — every un-seeded model (e.g. claude-sonnet-4.6,
// $102 real / $0.12 billed over 30 days) was effectively free AND uncapped,
// because the daily USD cap reads usage_logs.cost_usd derived from these rates.
const FALLBACK_TIER_PRICING_POINTS: Record<
  number,
  { inputCostPer1M: number; outputCostPer1M: number }
> = {
  1: { inputCostPer1M: 31_250, outputCostPer1M: 250_000 }, // ~$1.25 / $10 per 1M
  2: { inputCostPer1M: 75_000, outputCostPer1M: 375_000 }, // ~$3 / $15 per 1M
  3: { inputCostPer1M: 125_000, outputCostPer1M: 625_000 }, // ~$5 / $25 per 1M
};

async function getModelPricing(modelId: string) {
  try {
    const db = await getServerDB();
    // Try to find exact model match
    let pricing = await db.query.modelPricing.findFirst({
      where: eq(modelPricing.modelId, modelId),
    });

    // Fallback? Or return default.
    // Ensure we handle 'gpt-4o' mapping if needed.
    // For now assuming exact match.
    return pricing;
  } catch (e) {
    console.error('Failed to get model pricing:', e);
    return null;
  }
}

// Helper to count tokens from text
// Uses byte length / 3 as approximation for multilingual BPE tokenizers
// (English ~4 chars/token, Vietnamese/CJK ~1.5-2 chars/token, bytes/3 is balanced)
const textEncoder = new TextEncoder();
function countTokens(text: string): number {
  const byteLength = textEncoder.encode(text).length;
  return Math.ceil(byteLength / 3);
}

// ============  UTF-8 Repair for Vercel AI Gateway + Anthropic  ============ //
//
// When the Vercel AI Gateway proxies Anthropic's API, the SSE response
// sometimes arrives with UTF-8 bytes mis-interpreted as Latin-1/Windows-1252,
// causing Vietnamese/CJK diacritics to display as mojibake
// (e.g. "ấ" → "áº¥", "Đ" → "Ä\x90", "ư" → "Æ°").
//
// This TransformStream detects and repairs double-encoded UTF-8 in the
// LobeChat SSE protocol data payloads.

/**
 * Detect whether a string likely contains double-encoded UTF-8.
 * Checks for common Latin-1 byte patterns that result from interpreting
 * UTF-8 continuation bytes (0x80-0xBF) as Latin-1 characters.
 */
function looksLikeDoublyEncodedUtf8(text: string): boolean {
  // Detect double-encoded UTF-8 by looking for UTF-8 lead bytes followed by
  // continuation bytes, all rendered as Latin-1/Unicode code points.
  // Lead byte ranges: 0xC0-0xDF (2-byte), 0xE0-0xEF (3-byte), 0xF0-0xF4 (4-byte/emoji)
  // Continuation bytes: 0x80-0xBF
  // eslint-disable-next-line no-control-regex
  return /[\u00C0-\u00F4][\u0080-\u00BF]/.test(text);
}

/**
 * Repair a double-encoded UTF-8 string.
 * charCodeAt() returns 0x00-0xFF for Latin-1 chars (identity mapping),
 * so we can treat each char code as a raw byte and re-decode as UTF-8.
 */
function repairDoublyEncodedUtf8(text: string): string {
  try {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code > 0xFF) return text; // Non-Latin-1 char → abort
      bytes[i] = code;
    }
    return new TextDecoder('utf8', { fatal: true }).decode(bytes);
  } catch {
    return text; // Not actually double-encoded
  }
}

/**
 * Recursively find and repair all double-encoded UTF-8 strings in a value.
 */
function repairStringsInValue(value: unknown): { repaired: boolean; value: unknown } {
  if (typeof value === 'string') {
    if (looksLikeDoublyEncodedUtf8(value)) {
      return { repaired: true, value: repairDoublyEncodedUtf8(value) };
    }
    return { repaired: false, value };
  }
  if (Array.isArray(value)) {
    let any = false;
    const result = value.map((item) => {
      const r = repairStringsInValue(item);
      if (r.repaired) any = true;
      return r.value;
    });
    return { repaired: any, value: result };
  }
  if (value !== null && typeof value === 'object') {
    let any = false;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const r = repairStringsInValue(val);
      if (r.repaired) any = true;
      result[key] = r.value;
    }
    return { repaired: any, value: result };
  }
  return { repaired: false, value };
}

/**
 * Create a TransformStream that repairs double-encoded UTF-8 in SSE data payloads.
 * Handles LobeChat SSE protocol format:
 *   id: xxx\n
 *   event: text\n
 *   data: "string or JSON"\n\n
 */
function createUtf8RepairStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder('utf8', { fatal: false });
  const encoder = new TextEncoder();
  let buffer = '';
  let repairCount = 0;

  return new TransformStream({
    flush(controller) {
      if (buffer) {
        controller.enqueue(encoder.encode(buffer));
        buffer = '';
      }
      if (repairCount > 0) {
        console.log(`[UTF-8 Repair] Total repairs in this stream: ${repairCount}`);
      }
    },
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      // Process complete SSE events (terminated by \n\n)
      let eventEnd: number;
      while ((eventEnd = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, eventEnd + 2);
        buffer = buffer.slice(eventEnd + 2);

        // Find and repair data: lines within this event
        const lines = event.split('\n');
        const outputLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith('data: ') && !line.startsWith('data: [DONE]')) {
            try {
              const jsonStr = line.slice(6);
              const parsed = JSON.parse(jsonStr);
              const { repaired, value } = repairStringsInValue(parsed);
              if (repaired) {
                outputLines.push(`data: ${JSON.stringify(value)}`);
                repairCount++;
                if (repairCount === 1) {
                  console.log('[UTF-8 Repair] Fixed double-encoded Vietnamese/CJK text');
                }
                continue;
              }
            } catch {
              // Not valid JSON, pass through
            }
          }
          outputLines.push(line);
        }

        controller.enqueue(encoder.encode(outputLines.join('\n')));
      }
    },
  });
}

// ============  Tool Schema Sanitization   ============ //

/**
 * Recursively sanitize a single property schema for strict providers (Groq, etc.)
 * Removes unsupported constructs: items.enum, items.description inside arrays
 */
function sanitizePropertySchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;

  const result = { ...schema };

  // For array types with items.enum, simplify to just items.type
  // Groq doesn't support enum constraints inside array items
  if (result.type === 'array' && result.items) {
    const items = { ...result.items };
    delete items.enum;
    delete items.description;
    result.items = items;
  }

  // Recursively handle nested object properties
  if (result.properties) {
    const sanitizedProps: any = {};
    for (const [key, value] of Object.entries(result.properties)) {
      sanitizedProps[key] = sanitizePropertySchema(value);
    }
    result.properties = sanitizedProps;
  }

  return result;
}

/**
 * Sanitize tool parameter schemas for providers with strict validation (Groq).
 * Strips unsupported JSON Schema constructs that cause "tool call validation failed" errors.
 */
function sanitizeToolParameters(params: any): any {
  if (!params || typeof params !== 'object') return params;

  const result = { ...params };

  if (result.properties) {
    const sanitizedProps: any = {};
    for (const [key, value] of Object.entries(result.properties)) {
      sanitizedProps[key] = sanitizePropertySchema(value);
    }
    result.properties = sanitizedProps;
  }

  return result;
}

export const POST = checkAuth(async (req: Request, { params, jwtPayload, createRuntime }) => {
  const { provider } = await params;

  // ... (existing code)

  // 🔍 DEBUG: Log request info
  console.log('='.repeat(80));
  console.log(`[Chat API] Request received for provider: ${provider}`);
  console.log(`[Chat API] User ID: ${jwtPayload.userId}`);
  console.log(`[Chat API] JWT Payload:`, {
    apiKeyLength: jwtPayload.apiKey?.length || 0,
    baseURL: jwtPayload.baseURL,
    hasApiKey: !!jwtPayload.apiKey,
    hasBaseURL: !!jwtPayload.baseURL,
  });

  let requestModel = ''; // Hoisted for catch block access
  let tierSlotAcquired = false; // Whether checkTierAccess atomically acquired a tier slot
  let tierFallbackActive = false; // Whether plugin auto-fallback to Tier 1 is active

  try {
    // ============  0. Cost Optimization Setup   ============ //
    const costOptimizationEnabled = jwtPayload.userId
      ? isCostOptimizationEnabled(jwtPayload.userId)
      : false;
    const intelligentRoutingEnabled = jwtPayload.userId
      ? isIntelligentRoutingEnabled(jwtPayload.userId)
      : false;
    const usageTrackingEnabled = jwtPayload.userId
      ? isUsageTrackingEnabled(jwtPayload.userId)
      : false;

    // TODO: Re-enable when cost optimization is fully implemented
    // let costEngine: CostOptimizationEngine | undefined;
    // let usageTracker: UsageTracker | undefined;
    // let modelRouter: IntelligentModelRouter | undefined;

    if (costOptimizationEnabled && jwtPayload.userId) {
      try {
        // const serverDB = await getServerDB();
        // costEngine = new CostOptimizationEngine();
        // if (usageTrackingEnabled) {
        //   usageTracker = new UsageTracker(serverDB, jwtPayload.userId);
        // }
        console.log(
          `🎯 Cost optimization enabled for user ${jwtPayload.userId} (routing: ${intelligentRoutingEnabled}, tracking: ${usageTrackingEnabled})`,
        );
      } catch (error) {
        console.warn(
          '⚠️ Cost optimization initialization failed, proceeding without optimization:',
          error,
        );
      }
    }

    // ============  0.5. Credit Check (Pre-flight)   ============ //
    // Fetch credit balance once — reuse for both pre-flight and tier access checks
    let prefetchedCreditStatus: Awaited<ReturnType<typeof getUserCreditBalance>> = null;
    if (jwtPayload.userId) {
      prefetchedCreditStatus = await getUserCreditBalance(jwtPayload.userId);
      const balance = prefetchedCreditStatus?.balance || 0;

      // PHO-225: block when Phở Points are depleted AND no Tier 1 free quota left.
      // The previous `balance < -10_000` check could never trigger because
      // deductPhoCredits floors balance at 0 via GREATEST(0, ...), so any user
      // who hit 0 kept chatting for free. Tier 1 free quota (5/day) is preserved
      // — users can still send their daily free messages with 0 balance.
      // Free users requesting Tier 2/3 are blocked downstream by canUseTier.
      const FREE_TIER_LIMIT = 5;
      const dailyTier1Usage = prefetchedCreditStatus?.dailyTier1Usage ?? 0;
      const hasFreeTier1Quota = dailyTier1Usage < FREE_TIER_LIMIT;

      if (balance <= 0 && !hasFreeTier1Quota) {
        console.warn(
          `🚫 Blocked: balance ${balance} <= 0 and Tier 1 free quota exhausted ` +
            `(${dailyTier1Usage}/${FREE_TIER_LIMIT}). User: ${jwtPayload.userId}`,
        );
        return createErrorResponse(AgentRuntimeErrorType.InsufficientQuota, {
          error: { message: 'Phở Points đã hết. Vui lòng nạp thêm để tiếp tục.' },
          provider: 'pho-chat',
        });
      }

      console.log(`💰 Credit Check: Balance ${balance} (User: ${jwtPayload.userId})`);
    }

    // ============  1. Parse request & remap provider   ============ //
    const data = (await req.json()) as ChatStreamPayload;
    requestModel = data.model; // Store for catch block access

    // Provider Override: redirect disabled providers (google, openai, etc.)
    // to active ones (vercelaigateway, groq, cerebras).
    // MUST happen BEFORE runtime init — otherwise init tries the original
    // provider's API key (which may not exist).
    const { provider: activeProvider, modelId: activeModelId } = phoGatewayService.remapProvider(
      provider,
      data.model,
    );
    data.model = activeModelId;

    if (activeProvider !== provider) {
      console.log(`[Provider Override] ${provider} → ${activeProvider}, model: ${data.model}`);
    }

    // Sanitize tool schemas for providers with strict validation (Groq, etc.)
    // Groq rejects items.enum arrays, nested descriptions inside array items, etc.
    if (activeProvider === 'groq' && Array.isArray(data.tools)) {
      data.tools = data.tools.map((tool: any) => ({
        ...tool,
        function: {
          ...tool.function,
          parameters: sanitizeToolParameters(tool.function?.parameters),
        },
      }));
      console.log(`[Tool Sanitization] Sanitized ${data.tools.length} tool schemas for Groq`);
    }

    // ============  1.1. Init chat model   ============ //
    console.log(`[Chat API] Initializing model runtime for provider: ${activeProvider}...`);
    let modelRuntime: ModelRuntime;
    if (createRuntime) {
      console.log(`[Chat API] Using custom createRuntime function`);
      modelRuntime = createRuntime(jwtPayload);
    } else {
      console.log(`[Chat API] Using initModelRuntimeWithUserPayload`);
      modelRuntime = await initModelRuntimeWithUserPayload(activeProvider, jwtPayload);
    }
    console.log(`[Chat API] ✅ Model runtime initialized successfully`);

    // ============  2. Tier Access Enforcement   ============ //
    // Check if user's plan allows access to this model tier and daily limits
    let userPlanId = 'vn_free';
    if (jwtPayload.userId) {
      // PHO-241/A1.6: DB is the single source of truth for paid-plan checks.
      // Clerk publicMetadata is display cache only and must never gate authorization.
      userPlanId = await getUserPlanIdFromDB(jwtPayload.userId);

      // ============  2.0. Daily Request Cap (Circuit Breaker)  ============ //
      // Prevents single user from burning excessive cost in one day
      if (prefetchedCreditStatus) {
        const capCheck = checkDailyRequestCap(prefetchedCreditStatus, userPlanId);
        if (!capCheck.allowed) {
          console.warn(
            `🚫 Daily request cap reached: ${capCheck.totalUsedToday}/${capCheck.dailyRequestCap} ` +
              `(Plan: ${userPlanId}, User: ${jwtPayload.userId})`,
          );
          return createErrorResponse(AgentRuntimeErrorType.InsufficientQuota, {
            error: {
              message:
                capCheck.reason ||
                'Bạn đã đạt giới hạn sử dụng hôm nay. Nâng cấp gói để sử dụng thêm.',
            },
            provider: 'pho-chat',
            upgradeUrl: '/settings/subscription',
          });
        }
      }

      const modelTier = getModelTier(data.model);

      // ============  1.5. Per-request input token cap  ============ //
      // Rough estimation: ~4 chars per token. Prevents single expensive requests.
      const INPUT_TOKEN_CAP_BY_TIER: Record<number, number> = { 1: 16_000, 2: 64_000, 3: 200_000 };
      const tokenCap = INPUT_TOKEN_CAP_BY_TIER[modelTier] || 16_000;
      const estimatedInputChars =
        data.messages?.reduce((acc, msg) => acc + String(msg.content || '').length, 0) || 0;
      const estimatedInputTokens = Math.ceil(estimatedInputChars / 4);

      if (estimatedInputTokens > tokenCap) {
        console.warn(
          `🚫 Input token cap exceeded: ~${estimatedInputTokens} tokens > ${tokenCap} cap ` +
            `(Tier ${modelTier}, User: ${jwtPayload.userId})`,
        );
        return createErrorResponse(AgentRuntimeErrorType.ExceededContextWindow, {
          error: {
            message:
              `Input quá dài cho gói hiện tại (~${estimatedInputTokens.toLocaleString()} tokens, ` +
              `giới hạn ${tokenCap.toLocaleString()}). Vui lòng rút ngắn tin nhắn hoặc nâng cấp gói.`,
          },
          provider: 'pho-chat',
        });
      }

      console.log(`[Tier Check] Model: ${data.model}, Tier: ${modelTier}, Plan: ${userPlanId}`);

      // ============  2.0.5. Daily USD Cost Cap (PHO-238 EMERGENCY)  ============ //
      // Hard ceiling on USD spend per (user, plan, tier, day) so the Phở Points
      // generosity (e.g. 379K-credit FREE balance ≈ $760 budget) cannot be burned
      // through expensive Tier 3 models. Pure read — runs BEFORE checkTierAccess
      // so a blocked request does NOT consume an atomic tier slot. Resets at
      // midnight Asia/Ho_Chi_Minh.
      const usdCapCheck = await checkDailyCostCap(jwtPayload.userId, userPlanId, modelTier);
      if (!usdCapCheck.allowed) {
        console.warn(
          `🚫 Daily USD cap blocked: ${usdCapCheck.reasonCode} ` +
            `($${usdCapCheck.dailyCostUsed.toFixed(2)}/$${usdCapCheck.dailyCostCap.toFixed(2)}, ` +
            `Plan: ${userPlanId}, Tier: ${modelTier}, User: ${jwtPayload.userId})`,
        );
        return createErrorResponse(AgentRuntimeErrorType.InsufficientQuota, {
          dailyCostCap: usdCapCheck.dailyCostCap,
          dailyCostUsed: usdCapCheck.dailyCostUsed,
          error: {
            message: usdCapCheck.reason || 'Bạn đã đạt giới hạn chi phí hôm nay cho tier này.',
          },
          provider: 'pho-chat',
          reasonCode: usdCapCheck.reasonCode,
          retryAfter: getSecondsUntilMidnightVN(),
          // PHO-238 frontend: tier of the blocked request — drives `<BillingLimit>`'s
          // tier-specific alternatives list (e.g. T3 block → suggest Sonnet 4.6 / Gemini Pro).
          tier: modelTier,
          upgradeUrl: '/settings/subscription',
        });
      }

      const tierAccess = await checkTierAccess(jwtPayload.userId, modelTier, userPlanId);

      if (!tierAccess.allowed) {
        // ============ Plugin Auto-Fallback ============
        // When Tier 2/3 quota is exhausted but the request has tool/plugin calls,
        // transparently reroute to Tier 1 so plugins keep working.
        // Use Vercel AI Gateway (Gemini 2.0 Flash) — reliable, supports tools, avoids CF Gateway.
        const hasTools = Array.isArray(data.tools) && data.tools.length > 0;
        if (hasTools && modelTier > 1) {
          const PLUGIN_FALLBACK_MODEL = 'google/gemini-2.0-flash';
          const PLUGIN_FALLBACK_PROVIDER = 'vercelaigateway';
          console.log(
            `🔄 [Plugin Fallback] Tier ${modelTier} quota exceeded for user ${jwtPayload.userId}. ` +
              `Rerouting plugin call from "${data.model}" → "${PLUGIN_FALLBACK_MODEL}" (Tier 1 Vercel+Gemini).`,
          );
          data.model = PLUGIN_FALLBACK_MODEL;
          tierFallbackActive = true;
          // Re-init runtime for the fallback provider
          modelRuntime = await initModelRuntimeWithUserPayload(
            PLUGIN_FALLBACK_PROVIDER,
            jwtPayload,
          );
        } else {
          console.warn(
            `🚫 Tier access denied: ${tierAccess.reason} (User: ${jwtPayload.userId}, Model: ${data.model})`,
          );
          return createErrorResponse(AgentRuntimeErrorType.InsufficientQuota, {
            error: { message: tierAccess.reason || 'Model này yêu cầu gói cao hơn.' },
            provider: 'pho-chat',
            upgradeUrl: '/settings/subscription',
          });
        }
      }

      // Log remaining usage for non-unlimited tiers
      if (tierAccess.dailyLimit && tierAccess.dailyLimit !== -1) {
        console.log(
          `📊 Tier ${modelTier} usage: ${tierAccess.dailyLimit - (tierAccess.remaining || 0)}/${tierAccess.dailyLimit} (${tierAccess.remaining} remaining)`,
        );
      }

      // Track if slot was atomically acquired (for processModelUsage)
      tierSlotAcquired = tierAccess.slotAcquired || false;
    }

    // Cost-attribution feature label: the client marks background preset tasks
    // (topic title-gen, translation chains) via `x-pho-feature`. Strict enum
    // allowlist — anything else falls back to 'chat' — so a client cannot
    // invent labels (tag-cardinality spam in the gateway report) and can at
    // worst mislabel its own spend as a known category.
    const FEATURE_ALLOWLIST = new Set(['chat', 'preset-task']);
    const rawFeature = req.headers.get('x-pho-feature');
    const requestFeature = rawFeature && FEATURE_ALLOWLIST.has(rawFeature) ? rawFeature : 'chat';

    const tracePayload = getTracePayload(req);

    let traceOptions = {};
    // If user enable trace
    if (tracePayload?.enabled) {
      traceOptions = createTraceOptions(data, { provider, trace: tracePayload });
    }

    // ============  3. Execute Chat Completion (with Phở Gateway Failover)   ============ //
    // Use the ORIGINAL request model ID for failover lookup (not the remapped API-specific ID).
    // e.g. requestModel = 'mercury-coder-small-2-2' (logical ID in logicalModels map),
    //      data.model  = 'mercury-2' (already remapped to InceptionLabs API model name).
    // Also try the remapped model ID (data.model) for provider-prefixed entries
    // e.g. requestModel = 'claude-opus-4-6' won't match, but data.model = 'anthropic/claude-opus-4-6' will.
    let priorityList = phoGatewayService.resolveProviderList(requestModel, activeProvider);
    if (priorityList.length === 1 && data.model !== requestModel) {
      const remappedList = phoGatewayService.resolveProviderList(data.model, activeProvider);
      if (remappedList.length > 1) {
        priorityList = remappedList;
        console.log(`[Chat API] Failover resolved via remapped model ID: ${data.model}`);
      }
    }

    console.log(
      `[Chat API] Orchestration: Priority List for ${data.model} (${activeProvider}):`,
      priorityList,
    );

    let lastError: any = null;
    let successfulResponse: Response | null = null;
    let actualProviderUsed = activeProvider;
    let actualModelUsed = data.model;

    for (const [index, entry] of priorityList.entries()) {
      const { provider: targetProvider, modelId: targetModelId } = entry;

      console.log(
        `[Chat API] Attempt ${index + 1}: trying ${targetProvider} with model ${targetModelId}`,
      );

      try {
        // Initialize runtime for this specific provider if different from initial
        let currentRuntime = modelRuntime;
        if (targetProvider !== activeProvider) {
          currentRuntime = await initModelRuntimeWithUserPayload(targetProvider, jwtPayload);
        }

        // Sanitize messages for Gemini-based providers (require non-empty content)
        let sanitizedData = data;

        // Sanitize tool schemas for strict providers during failover
        if (targetProvider === 'groq' && Array.isArray(sanitizedData.tools)) {
          sanitizedData = {
            ...sanitizedData,
            tools: sanitizedData.tools.map((tool: any) => ({
              ...tool,
              function: {
                ...tool.function,
                parameters: sanitizeToolParameters(tool.function?.parameters),
              },
            })),
          };
        }

        if (targetProvider === 'vercelaigateway' && targetModelId.startsWith('google/')) {
          const filteredMessages = data.messages?.filter((msg) => {
            if (typeof msg.content === 'string') return msg.content.trim().length > 0;
            if (Array.isArray(msg.content)) return msg.content.length > 0;
            return msg.content !== null && msg.content !== undefined;
          });
          sanitizedData = { ...sanitizedData, messages: filteredMessages };
        }

        const response = await currentRuntime.chat(
          {
            ...sanitizedData,
            model: targetModelId,
          },
          {
            // Cost-attribution tags for the Vercel AI Gateway dashboard (no-op
            // for providers that don't support them). Tier is recomputed from
            // the actual target model so failover/fallback hops stay accurate.
            tags: [
              `feature:${requestFeature}`,
              `plan:${userPlanId}`,
              `tier:${getModelTier(targetModelId)}`,
            ],
            user: jwtPayload.userId,
            ...traceOptions,
            signal: req.signal,
          },
        );

        if (!response.ok) {
          // If it's a provider error, throw it to trigger catch block for failover
          const errorData = await response
            .clone()
            .json()
            .catch(() => ({}));
          throw {
            message: errorData?.error?.message || response.statusText,
            status: response.status,
            type: AgentRuntimeErrorType.ProviderBizError,
          };
        }

        console.log(`[Chat API] ✅ Attempt ${index + 1} successful with ${targetProvider}`);
        successfulResponse = response;
        actualProviderUsed = targetProvider;
        actualModelUsed = targetModelId;
        break; // Exit loop on success
      } catch (e: any) {
        console.warn(
          `[Chat API] Attempt ${index + 1} failed for ${targetProvider}:`,
          e?.message || e,
        );
        lastError = e;

        // Determine if we should retry
        const isRetryable =
          e?.status === 500 ||
          e?.status === 429 ||
          e?.status === 502 ||
          e?.status === 503 ||
          e?.status === 504 ||
          e?.type === AgentRuntimeErrorType.ProviderBizError ||
          e?.code === 'ECONNRESET';

        if (!isRetryable) {
          console.warn(
            `[Chat API] Non-retryable error from ${targetProvider}:`,
            e?.status,
            e?.message,
          );
          throw e; // PHO-226: Stop cascade — failover only for 5xx/429/ECONNRESET
        }

        if (index === priorityList.length - 1) {
          console.error(`[Chat API] All providers failed. Throwing last error.`);
          throw lastError;
        } else {
          console.warn(`[Chat API] Failover triggered: moving to next provider.`);
        }
      }
    }

    if (!successfulResponse) {
      throw lastError || new Error('All providers failed without a specific error.');
    }

    const response = successfulResponse;

    console.log(`[Chat API] ✅ Chat completion successful`);
    console.log('='.repeat(80));

    // ============  4. Usage Tracking & Credit Deduction   ============ //
    // Fetch pricing for the actual model used
    const pricing = await getModelPricing(actualModelUsed);

    // Resolve correct tier via getModelTier()
    const resolvedTier = getModelTier(actualModelUsed);

    // Use DB pricing if available; otherwise fall back to a CONSERVATIVE-HIGH
    // per-tier rate (≈ the priciest model in the tier) so an un-seeded model is
    // billed near its real cost and the daily USD cap still fires. Do NOT use
    // MODEL_TIERS rates here — those are legacy points-per-message estimates
    // (100/300 pts/1M ≈ $0.004/$0.012), ~800x below real flagship cost, which
    // is exactly the leak this fallback guards against.
    const fallbackPricing =
      FALLBACK_TIER_PRICING_POINTS[resolvedTier] ?? FALLBACK_TIER_PRICING_POINTS[2];
    const activePricing = pricing || {
      id: 'default',
      inputCostPer1M: fallbackPricing.inputCostPer1M,
      outputCostPer1M: fallbackPricing.outputCostPer1M,
      tier: resolvedTier,
    };

    if (!pricing) {
      // Loud signal so missing models get seeded promptly (grep Vercel logs).
      console.warn(
        `⚠️ [billing] NO DB pricing for "${actualModelUsed}" (tier ${resolvedTier}) — ` +
          `billing at conservative fallback ${fallbackPricing.inputCostPer1M}/${fallbackPricing.outputCostPer1M} pts/1M. ` +
          `Add it to scripts/seed-model-pricing-gateway.ts and re-seed.`,
      );
    }

    const requestStartTime = Date.now();

    if (data.stream && response.body) {
      // ── UTF-8 Repair for Anthropic via Vercel AI Gateway ──
      // Pipe through repair stream to fix double-encoded Vietnamese/CJK diacritics
      const needsUtf8Repair =
        actualProviderUsed === 'vercelaigateway' && actualModelUsed.startsWith('anthropic/');

      const bodyStream = needsUtf8Repair
        ? response.body.pipeThrough(createUtf8RepairStream())
        : response.body;

      // STREAMING: Tee the stream to audit usage
      const [stream1, stream2] = bodyStream.tee();

      // Process audit in background (don't await).
      // PHO-230: billing runs in `finally` so a mid-stream abort (user disconnect,
      // network drop) still debits the user for tokens already streamed. The
      // gateway has already charged us for those tokens; the previous silent
      // catch here let the user escape billing entirely.
      //
      // Read the audit stream CONCURRENTLY (so ReadableStream.tee() doesn't buffer
      // the entire response body in memory), then hand the resulting promise to
      // Next's `after()` so Vercel keeps the function — and the Neon WebSocket pool
      // connection — alive until billing completes. Previously this was a bare
      // fire-and-forget IIFE: the function froze the instant the response returned,
      // severing the DB connection, so the post-stream billing query failed
      // ("❌ Failed to process model usage: Failed query …") and silently skipped
      // points deduction + usage logging on streamed chats.
      const billingTask = (async () => {
        let accumulatedText = '';
        let completed = false;

        try {
          const reader = stream2.getReader();
          const decoder = new TextDecoder();

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            accumulatedText += decoder.decode(value, { stream: true });
          }
          completed = true;
        } catch (e) {
          console.warn('[Chat API] Stream aborted mid-response, billing partial usage:', {
            accumulatedChars: accumulatedText.length,
            error: e instanceof Error ? e.message : String(e),
          });
        } finally {
          try {
            const responseTimeMs = Date.now() - requestStartTime;

            // Calculate tokens (works for completed and partial streams alike).
            const outputTokens = countTokens(accumulatedText);
            const inputTokens =
              data.messages?.reduce(
                (acc, msg) => acc + countTokens(String(msg.content || '')),
                0,
              ) || 0;

            // Calculate Cost (per 1M tokens).
            // PHO-223: read points-denominated rates (input_cost_per_1m / output_cost_per_1m).
            // inputPrice/outputPrice are legacy VND columns (default 0) — using them yielded cost=0.
            const inputPrice = activePricing.inputCostPer1M ?? 0;
            const outputPrice = activePricing.outputCostPer1M ?? 0;
            const cost = Math.ceil(
              (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000,
            );

            console.log(
              `📉 Streaming Usage${completed ? '' : ' (PARTIAL — aborted)'}: ${inputTokens} in / ${outputTokens} out. Cost: ${cost} Credits. Time: ${responseTimeMs}ms`,
            );

            // Skip only on absolute zero (no input parsed, no output streamed).
            if (jwtPayload.userId && (inputTokens > 0 || outputTokens > 0)) {
              await processModelUsage(
                jwtPayload.userId,
                cost,
                activePricing.tier || 1,
                tierSlotAcquired,
                {
                  feature: requestFeature,
                  inputTokens,
                  model: actualModelUsed,
                  outputTokens,
                  partial: !completed,
                  // PHO-246: forward plan from auth check so PostHog can slice cost-per-plan.
                  planId: userPlanId,
                  provider: actualProviderUsed,
                  responseTimeMs,
                },
              );
            }
          } catch (billingError) {
            console.error('[Chat API] Billing failed after stream:', billingError);
          }
        }
      })();

      // Keep the serverless function alive until billing resolves. Passing the
      // already-running promise (not a deferred callback) means stream2 is consumed
      // as it streams — no tee() buffering — while still surviving the post-response
      // freeze that was severing the Neon connection mid-write.
      after(billingTask);

      const headers = new Headers(response.headers);
      headers.set('X-Pho-Provider', actualProviderUsed);
      headers.set('X-Pho-Model-ID', actualModelUsed);
      if (tierFallbackActive) headers.set('X-Pho-Tier-Fallback', '1');
      // Ensure UTF-8 charset for Vietnamese/CJK text in streaming responses
      headers.set('Content-Type', 'text/event-stream; charset=utf-8');

      return new Response(stream1, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    } else {
      // NON-STREAMING
      try {
        const responseClone = response.clone();
        const responseText = await responseClone.text();

        let responseData: any;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          // Response is SSE/streaming format, not JSON — skip credit tracking
          console.warn('⚠️ Non-streaming credit tracking skipped: response is not valid JSON');
          responseData = null;
        }

        if (responseData) {
          const responseTimeMs = Date.now() - requestStartTime;
          const content = responseData.choices?.[0]?.message?.content || '';

          // Prefer actual token counts from provider response, fall back to estimation
          const providerUsage = responseData.usage;
          const outputTokens = providerUsage?.completion_tokens ?? countTokens(content);
          const inputTokens =
            providerUsage?.prompt_tokens ??
            (data.messages?.reduce((acc, msg) => acc + countTokens(String(msg.content || '')), 0) ||
              0);

          // PHO-223: read points-denominated rates (input_cost_per_1m / output_cost_per_1m).
          // inputPrice/outputPrice are legacy VND columns (default 0) — using them yielded cost=0.
          const inputPrice = activePricing.inputCostPer1M ?? 0;
          const outputPrice = activePricing.outputCostPer1M ?? 0;
          const cost = Math.ceil(
            (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000,
          );

          if (jwtPayload.userId) {
            await processModelUsage(
              jwtPayload.userId,
              cost,
              activePricing.tier || 1,
              tierSlotAcquired,
              {
                feature: requestFeature,
                inputTokens,
                model: actualModelUsed,
                outputTokens,
                // PHO-246: forward plan from auth check so PostHog can slice cost-per-plan.
                planId: userPlanId,
                provider: actualProviderUsed,
                responseTimeMs,
              },
            );
            console.log(`📉 Non-Streaming Usage: ${cost} Credits. Time: ${responseTimeMs}ms`);
          }
        }
      } catch (e) {
        console.error('Failed to process non-streaming response for credits:', e);
      }
    }

    // Return original response for non-streaming (since we cloned)
    if (!data.stream) {
      const headers = new Headers(response.headers);
      headers.set('X-Pho-Provider', actualProviderUsed);
      headers.set('X-Pho-Model-ID', actualModelUsed);
      if (tierFallbackActive) headers.set('X-Pho-Tier-Fallback', '1');
      // Ensure UTF-8 charset for Vietnamese/CJK text in non-streaming responses
      headers.set('Content-Type', 'application/json; charset=utf-8');

      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    }

    // Should be unreachable as we returned in stream block
    return response;
  } catch (e) {
    console.log('='.repeat(80));
    console.error(`[Chat API] ❌ Error occurred:`, e);

    const { errorType = ChatErrorType.InternalServerError, error: errorContent } =
      e as ChatCompletionErrorPayload;

    const error = errorContent || e;

    // ── Enhanced Error Logging (raw details for debugging) ──
    // Log structured error info BEFORE sanitization so we can diagnose
    // provider-specific failures (e.g. Vercel AI Gateway → Anthropic errors)
    const rawErrorInfo = {
      errorType,
      httpStatus: (e as any)?.status || (error as any)?.status || 'unknown',
      model: requestModel,
      provider,
      rawMessage:
        typeof error === 'object' && error !== null
          ? (error as any).message || JSON.stringify(error).slice(0, 500)
          : String(error).slice(0, 500),
      timestamp: new Date().toISOString(),
      userId: jwtPayload?.userId || 'anonymous',
    };
    console.error(`[Chat API] 🔍 RAW ERROR DETAILS:`, JSON.stringify(rawErrorInfo));

    const logMethod = AGENT_RUNTIME_ERROR_SET.has(errorType as string) ? 'warn' : 'error';
    // track the error at server side
    console[logMethod](`Route: [${provider}] ${errorType}:`, error);
    console.log('='.repeat(80));

    // In Phở Chat, all API keys are managed server-side.
    // Never expose InvalidProviderAPIKey / NoOpenAIAPIKey to users — remap to
    // ProviderBizError so the client shows a generic error message instead of
    // the inappropriate "Enter custom API key" form.
    const safeErrorType =
      errorType === AgentRuntimeErrorType.InvalidProviderAPIKey ||
      errorType === AgentRuntimeErrorType.NoOpenAIAPIKey
        ? AgentRuntimeErrorType.ProviderBizError
        : errorType;

    // Sanitize vendor errors — hide provider names, API keys, quota details
    const rawMessage =
      typeof error === 'object' && error !== null
        ? (error as any).message || String(error)
        : String(error);

    // Include model name so user knows which model failed
    const modelHint = requestModel ? ` (${requestModel})` : '';

    // Map vendor-specific messages to user-friendly ones
    let sanitizedMessage = `Đã có lỗi xảy ra${modelHint}. Vui lòng thử lại sau.`;
    if (/quota|rate.?limit|exceeded|too many/i.test(rawMessage)) {
      sanitizedMessage = `Model${modelHint} tạm thời không khả dụng. Vui lòng thử model khác hoặc thử lại sau.`;
    } else if (/unauthorized|invalid.*key|api.?key/i.test(rawMessage)) {
      sanitizedMessage = `Lỗi xác thực${modelHint}. Vui lòng thử lại hoặc liên hệ hỗ trợ.`;
    } else if (/timeout|timed?.?out/i.test(rawMessage)) {
      sanitizedMessage = `Yêu cầu quá thời gian${modelHint}. Vui lòng thử lại.`;
    } else if (/not.?found|does not exist/i.test(rawMessage)) {
      sanitizedMessage = `Model${modelHint} hiện không khả dụng. Vui lòng chọn model khác.`;
    }

    return createErrorResponse(safeErrorType, {
      error: { message: sanitizedMessage },
      provider: 'pho-chat',
    });
  }
});

// ============  Helper Functions for Cost Optimization   ============ //

/**
 * Get user's subscription tier from database or default to starter
 */
/*
async function getUserSubscriptionTier(
  userId: string,
  usageTracker: UsageTracker
): Promise<keyof typeof VND_PRICING_TIERS> {
  try {
    // Try to get from monthly usage summary first
    const serverDB = await getServerDB();
    const summary = await serverDB.execute(`
      SELECT subscription_tier
      FROM monthly_usage_summary
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);

    if (summary.length > 0 && summary[0].subscription_tier) {
      return summary[0].subscription_tier as keyof typeof VND_PRICING_TIERS;
    }

    // Fallback to user cost settings
    const settings = await serverDB.execute(`
      SELECT monthly_budget_vnd
      FROM user_cost_settings
      WHERE user_id = $1
    `, [userId]);

    if (settings.length > 0) {
      const budget = settings[0].monthly_budget_vnd;
      if (budget <= 29_000) return 'starter';
      if (budget <= 58_000) return 'premium';
      return 'ultimate';
    }

    // Default to starter tier
    return 'starter';
  } catch (error) {
    console.warn('Failed to get subscription tier, defaulting to starter:', error);
    return 'starter';
  }
}
*/

// /**
//  * Estimate token count from messages (simplified)
//  */
// function estimateTokens(messages: any[]): number {
//   if (!messages || !Array.isArray(messages)) return 0;
//
//   const totalText = messages
//     .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
//     .join(' ');
//
//   // Rough estimation: ~4 characters per token
//   return Math.ceil(totalText.length / 4);
// }
