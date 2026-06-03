import { NextRequest, NextResponse } from 'next/server';

import { getApiModels, getModelCost, getValidModelIds } from '@/config/modelCatalog';
import { getModelTier } from '@/config/pricing';
import { getServerDB } from '@/database/server';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import {
  checkDailyRequestCap,
  checkTierAccess,
  getUserCreditBalance,
} from '@/server/services/billing/credits';
import { checkDailyCostCap } from '@/server/services/billing/dailyCostAggregation';
import { getSecondsUntilMidnightVN } from '@/server/services/billing/dailyCostCaps';
import { phoGatewayService } from '@/server/services/phoGateway';
import { getUserPlanIdFromDB } from '@/server/services/subscription/getUserPlanFromDB';

export const maxDuration = 120;

const ALLOWED_MODELS = getValidModelIds();

// ── Rate Limiter (in-memory sliding window) ──────────────────
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

function checkRateLimit(keyHash: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitMap.get(keyHash) || []).filter((t) => t > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  rateLimitMap.set(keyHash, timestamps);
  return true;
}

/**
 * Validate an API key via SHA-256 hash lookup in the phoApiKeys table.
 */
async function validateApiKey(apiKey: string): Promise<{
  clerkUserId: string;
  dbUserId: string;
  keyHash: string;
  planId: string;
} | null> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    const db = await getServerDB();
    const { phoApiKeys, users } = (await import('@/database/schemas')) as any;
    const { eq, and } = await import('drizzle-orm');

    const [keyRecord] = await db
      .select({ clerkUserId: phoApiKeys.clerkUserId, id: phoApiKeys.id })
      .from(phoApiKeys)
      .where(and(eq(phoApiKeys.keyHash, keyHash), eq(phoApiKeys.isActive, true)))
      .limit(1);

    if (!keyRecord) return null;

    // Update lastUsedAt (fire-and-forget)
    db.update(phoApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(phoApiKeys.id, keyRecord.id))
      .catch(() => {
        /* ignore */
      });

    const [user] = await db
      .select({ clerkId: users.clerkId, id: users.id, planId: users.currentPlanId })
      .from(users)
      .where(eq(users.clerkId, keyRecord.clerkUserId))
      .limit(1);

    if (!user) return null;

    return {
      clerkUserId: user.clerkId,
      dbUserId: user.id,
      keyHash,
      planId: user.planId || 'gl_starter',
    };
  } catch {
    return null;
  }
}

/**
 * Atomically deduct Phở Points. Returns true if sufficient balance.
 */
async function deductPoints(clerkUserId: string, cost: number): Promise<boolean> {
  if (cost <= 0) return true;
  try {
    const db = await getServerDB();
    const { phoWallet } = (await import('@/database/schemas')) as any;
    const { sql } = await import('drizzle-orm');

    const result = await db
      .update(phoWallet)
      .set({ balance: sql`${phoWallet.balance} - ${cost}`, updatedAt: new Date() })
      .where(sql`${phoWallet.clerkUserId} = ${clerkUserId} AND ${phoWallet.balance} >= ${cost}`)
      .returning({ newBalance: phoWallet.balance });

    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Log API usage to the usageLogs table.
 */
async function logUsage(params: {
  cost: number;
  inputTokens: number;
  model: string;
  outputTokens: number;
  provider: string;
  responseTimeMs: number;
  userId: string;
}): Promise<void> {
  try {
    const db = await getServerDB();
    const { usageLogs } = (await import('@/database/schemas')) as any;
    const VND_RATE = 24_167;
    const costUSD = params.cost * 0.000_04; // 1 point ≈ $0.00004
    await db.insert(usageLogs).values({
      costUSD,
      costVND: costUSD * VND_RATE,
      inputTokens: params.inputTokens,
      model: params.model,
      modelTier: getModelTier(params.model),
      outputTokens: params.outputTokens,
      pointsDeducted: params.cost,
      provider: params.provider,
      responseTimeMs: params.responseTimeMs,
      totalTokens: params.inputTokens + params.outputTokens,
      userId: params.userId,
    });
  } catch (err) {
    console.error('[api/v1/chat] Failed to log usage:', err);
  }
}

/**
 * POST /api/v1/chat — OpenAI-compatible chat completions
 */
export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const apiKey = request.headers.get('x-api-key');

  if (!apiKey || !apiKey.startsWith('pho_')) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_api_key',
          message: 'Missing or invalid x-api-key header. Format: pho_<key>',
        },
      },
      { status: 401 },
    );
  }

  const user = await validateApiKey(apiKey);
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'API key is not valid or user not found.' } },
      { status: 401 },
    );
  }

  // Rate limiting
  if (!checkRateLimit(user.keyHash)) {
    return NextResponse.json(
      {
        error: { code: 'rate_limited', message: 'Too many requests. Max 60 requests per minute.' },
      },
      { headers: { 'Retry-After': '60' }, status: 429 },
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Invalid JSON body.' } },
      { status: 400 },
    );
  }

  const { model, messages } = body;

  if (!model || !messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'model and messages[] are required.' } },
      { status: 400 },
    );
  }

  if (!ALLOWED_MODELS.includes(model)) {
    return NextResponse.json(
      {
        error: {
          allowed_models: ALLOWED_MODELS,
          code: 'model_not_allowed',
          message: `Model "${model}" not available.`,
        },
      },
      { status: 400 },
    );
  }

  // ── Plan / tier gating + daily cost guardrails (parity with web chat route) ──
  // The public API previously bypassed checkTierAccess and the daily USD cost
  // caps, letting any pho_ key call premium (Tier 2/3) models regardless of plan
  // and with no daily ceiling. Mirror the web route's enforcement here. DB is the
  // single source of truth for the plan (not users.currentPlanId).
  const userPlanId = await getUserPlanIdFromDB(user.dbUserId);
  const modelTier = getModelTier(model);

  // Daily request cap (circuit breaker) — reuses tier counters, no extra query.
  const creditStatus = await getUserCreditBalance(user.dbUserId);
  if (creditStatus) {
    const reqCap = checkDailyRequestCap(creditStatus, userPlanId);
    if (!reqCap.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'daily_request_cap_reached',
            daily_request_cap: reqCap.dailyRequestCap,
            message: reqCap.reason || 'Daily request limit reached. Upgrade your plan.',
          },
        },
        { headers: { 'Retry-After': String(getSecondsUntilMidnightVN()) }, status: 429 },
      );
    }
  }

  // Per-request input token cap by tier (~4 chars/token) — blocks single huge calls.
  const INPUT_TOKEN_CAP_BY_TIER: Record<number, number> = { 1: 16_000, 2: 64_000, 3: 200_000 };
  const tokenCap = INPUT_TOKEN_CAP_BY_TIER[modelTier] || 16_000;
  const estimatedInputTokens = Math.ceil(
    messages.reduce((acc: number, m: any) => acc + String(m?.content ?? '').length, 0) / 4,
  );
  if (estimatedInputTokens > tokenCap) {
    return NextResponse.json(
      {
        error: {
          code: 'input_too_long',
          estimated_input_tokens: estimatedInputTokens,
          input_token_cap: tokenCap,
          message: `Input too long for this tier (~${estimatedInputTokens} tokens > ${tokenCap}). Shorten the prompt or upgrade your plan.`,
        },
      },
      { status: 400 },
    );
  }

  // Daily USD cost cap per (user, plan, tier). reasonCode TIER_BLOCKED => the plan
  // can't use this tier at all (403); DAILY_CAP_EXCEEDED => ceiling hit (429).
  const usdCap = await checkDailyCostCap(user.dbUserId, userPlanId, modelTier);
  if (!usdCap.allowed) {
    const blockedByPlan = usdCap.reasonCode === 'TIER_BLOCKED';
    return NextResponse.json(
      {
        error: {
          code: blockedByPlan ? 'model_not_allowed_for_plan' : 'daily_cost_cap_reached',
          daily_cost_cap: usdCap.dailyCostCap,
          daily_cost_used: usdCap.dailyCostUsed,
          message: usdCap.reason || 'Daily cost limit reached for this tier.',
          tier: modelTier,
        },
      },
      {
        headers: blockedByPlan ? undefined : { 'Retry-After': String(getSecondsUntilMidnightVN()) },
        status: blockedByPlan ? 403 : 429,
      },
    );
  }

  // Tier access + atomic daily-slot acquisition for Tier 2/3 (shared quota with web).
  const tierAccess = await checkTierAccess(user.dbUserId, modelTier, userPlanId);
  if (!tierAccess.allowed) {
    // canUseTier=false / dailyLimit=0 => plan can't use this tier (403);
    // otherwise the daily Tier 2/3 slot quota is exhausted (429).
    const blockedByPlan = !tierAccess.dailyLimit;
    return NextResponse.json(
      {
        error: {
          code: blockedByPlan ? 'model_not_allowed_for_plan' : 'tier_quota_reached',
          daily_limit: tierAccess.dailyLimit,
          message: tierAccess.reason || 'This model requires a higher plan.',
          tier: modelTier,
        },
      },
      {
        headers: blockedByPlan ? undefined : { 'Retry-After': String(getSecondsUntilMidnightVN()) },
        status: blockedByPlan ? 403 : 429,
      },
    );
  }

  // Deduct Phở Points
  const cost = getModelCost(model);
  const hasPoints = await deductPoints(user.clerkUserId, cost);
  if (!hasPoints) {
    return NextResponse.json(
      {
        error: {
          code: 'insufficient_balance',
          cost,
          message: 'Insufficient Phở Points. Top up at pho.chat/subscription.',
          model,
        },
      },
      { status: 402 },
    );
  }

  // Route through AI gateway with multi-provider failover
  const requestStartTime = Date.now();
  const priorityList = phoGatewayService.resolveProviderList(model);
  let lastError: any = null;
  let usedProvider = '';

  for (const [index, entry] of priorityList.entries()) {
    const { provider, modelId } = entry;

    try {
      const runtime = await initModelRuntimeWithUserPayload(provider, {});
      const response = await runtime.chat(
        {
          messages: messages.map((m: any) => ({ content: m.content, role: m.role })),
          model: modelId,
          temperature: body.temperature ?? 0.6,
        } as any,
        { user: user.clerkUserId },
      );

      usedProvider = provider;

      // Collect streamed SSE response
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter((l) => l.startsWith('data:'));
          for (const line of lines) {
            const data = line.replace('data: ', '').trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) fullContent += delta;
            } catch {
              if (data && data !== '[DONE]') fullContent += data;
            }
          }
        }

        const promptTokens = Math.ceil(JSON.stringify(messages).length / 4);
        const completionTokens = Math.ceil(fullContent.length / 4);
        const responseTimeMs = Date.now() - requestStartTime;

        logUsage({
          cost,
          inputTokens: promptTokens,
          model,
          outputTokens: completionTokens,
          provider: usedProvider,
          responseTimeMs,
          userId: user.dbUserId,
        });

        return NextResponse.json({
          'choices': [
            {
              finish_reason: 'stop',
              index: 0,
              message: { content: fullContent, role: 'assistant' },
            },
          ],
          'id': `chatcmpl-${Date.now()}`,
          model,
          'object': 'chat.completion',
          'usage': {
            completion_tokens: completionTokens,
            pho_points_cost: cost,
            prompt_tokens: promptTokens,
            total_tokens: promptTokens + completionTokens,
          },
          'x-pho-provider': usedProvider,
        });
      }

      const text = await response.text();
      const nonStreamResponseTime = Date.now() - requestStartTime;
      const nonStreamPromptTokens = Math.ceil(JSON.stringify(messages).length / 4);
      const nonStreamCompletionTokens = Math.ceil(text.length / 4);
      logUsage({
        cost,
        inputTokens: nonStreamPromptTokens,
        model,
        outputTokens: nonStreamCompletionTokens,
        provider: usedProvider,
        responseTimeMs: nonStreamResponseTime,
        userId: user.dbUserId,
      });
      return NextResponse.json({
        'choices': [
          { finish_reason: 'stop', index: 0, message: { content: text, role: 'assistant' } },
        ],
        'id': `chatcmpl-${Date.now()}`,
        model,
        'object': 'chat.completion',
        'x-pho-provider': provider,
      });
    } catch (e: any) {
      console.error(`[api/v1/chat] Attempt ${index + 1} failed for ${provider}:`, e?.message || e);
      lastError = e;
    }
  }

  // All providers failed — refund points
  try {
    const db = await getServerDB();
    const { phoWallet } = (await import('@/database/schemas')) as any;
    const { sql } = await import('drizzle-orm');
    await db
      .update(phoWallet)
      .set({ balance: sql`${phoWallet.balance} + ${cost}`, updatedAt: new Date() })
      .where(sql`${phoWallet.clerkUserId} = ${user.clerkUserId}`);
  } catch {
    console.error('[api/v1/chat] Failed to refund points');
  }

  return NextResponse.json(
    {
      error: {
        code: 'provider_error',
        message: `All providers failed for "${model}". ${lastError?.message || ''}`,
        model,
      },
    },
    { status: 502 },
  );
}

/**
 * GET /api/v1/chat — API info + available models with pricing
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    docs: 'https://pho.chat/docs/api',
    models: getApiModels().map((m) => ({
      cost_per_message: m.costPerMessage,
      id: m.id,
      name: m.name,
      tier: m.tier,
    })),
    service: 'Phở Chat Public API',
    version: 'v1',
  });
}
