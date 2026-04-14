import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { MODEL_TIERS, getModelTier } from '@/config/pricing';
import { modelPricing } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import {
  checkTierAccess,
  getUserCreditBalance,
  processModelUsage,
} from '@/server/services/billing/credits';
import { phoGatewayService } from '@/server/services/phoGateway';

export const maxDuration = 60;

/**
 * Known model-to-provider mappings.
 */
const MODEL_PROVIDER_HINTS: Record<string, string> = {
  'claude-3-5-sonnet-20241022': 'anthropic',
  'claude-3.5-sonnet': 'anthropic',
  'gemini-2.5-flash': 'google',
  'gemini-2.5-pro': 'google',
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
};

/** Resolve plan ID with Clerk metadata fallback for promo-activated users */
async function resolvePlanId(userId: string, dbPlanId: string): Promise<string> {
  const FREE_PLAN_IDS = new Set(['free', 'trial', 'starter', 'vn_free', 'gl_starter']);
  if (!FREE_PLAN_IDS.has(dbPlanId.toLowerCase())) return dbPlanId;
  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();
    const clerkUser = await client.users.getUser(userId);
    const clerkPlanId = (clerkUser.publicMetadata as any)?.planId;
    if (clerkPlanId && !FREE_PLAN_IDS.has(clerkPlanId.toLowerCase())) return clerkPlanId;
  } catch {
    // Clerk lookup failed, continue with DB planId
  }
  return dbPlanId;
}

/** Token estimation: byte length / 3 (balanced for multilingual BPE) */
function countTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 3);
}

/**
 * POST /api/artifact-ai
 *
 * Allows React artifact iframes to call the LLM from within the artifact.
 * Uses the same Vercel AI Gateway + phoGatewayService infrastructure
 * as the main chat route — with full billing enforcement.
 *
 * Body: { prompt: string; systemPrompt?: string; model?: string }
 * Returns: { text: string }
 */
export async function POST(req: NextRequest) {
  // 1. Auth via Clerk
  let userId: string | null = null;
  try {
    const { auth } = await import('@clerk/nextjs/server');
    const session = await auth();
    userId = session.userId;
  } catch {
    // Clerk auth not available
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse body
  let body: { model?: string; prompt?: string; systemPrompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { model = 'gemini-2.5-flash', prompt, systemPrompt = '' } = body;
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  // 3. Credit & tier access check
  const creditStatus = await getUserCreditBalance(userId);
  const balance = creditStatus?.balance || 0;
  if (balance < -10_000) {
    return NextResponse.json(
      { error: 'Phở Points không đủ. Vui lòng nạp thêm để tiếp tục.' },
      { status: 402 },
    );
  }

  const dbPlanId = creditStatus?.currentPlanId || 'vn_free';
  const userPlanId = await resolvePlanId(userId, dbPlanId);
  const modelTier = getModelTier(model);

  const tierAccess = await checkTierAccess(userId, modelTier, userPlanId);
  if (!tierAccess.allowed) {
    return NextResponse.json(
      { error: tierAccess.reason || 'Model này yêu cầu gói cao hơn.' },
      { status: 403 },
    );
  }
  const tierSlotAcquired = tierAccess.slotAcquired || false;

  // 4. Resolve provider chain via phoGatewayService
  const hintProvider = MODEL_PROVIDER_HINTS[model] || 'google';
  const remapped = phoGatewayService.remapProvider(hintProvider, model);

  const providerList = [
    remapped,
    ...(remapped.provider !== 'vercelaigateway'
      ? [{ modelId: `google/${model.replace('google/', '')}`, provider: 'vercelaigateway' }]
      : []),
  ];

  // 5. Build messages
  const messages = [
    ...(systemPrompt ? [{ content: systemPrompt, role: 'system' as const }] : []),
    { content: prompt, role: 'user' as const },
  ];

  const emptyPayload = {} as any;
  let lastError: any = null;
  const requestStartTime = Date.now();

  for (const [idx, entry] of providerList.entries()) {
    const { provider, modelId } = entry;
    try {
      console.log(`[artifact-ai] Attempt ${idx + 1}: provider=${provider}, model=${modelId}`);
      const runtime = await initModelRuntimeWithUserPayload(provider, emptyPayload);
      const response = await runtime.chat(
        {
          messages,
          model: modelId,
          temperature: 0.7,
        } as any,
        { user: userId },
      );

      if (response.body) {
        // Buffer full response (non-streaming for simplicity)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (
              trimmed.startsWith('id:') ||
              trimmed.startsWith('retry:') ||
              trimmed.startsWith('event:') ||
              trimmed.startsWith(':')
            )
              continue;
            if (/^(stop|output_speed|ping)$/i.test(trimmed)) continue;

            if (trimmed.startsWith('data: ')) {
              const raw = trimmed.slice(6);
              if (raw === '[DONE]') continue;
              try {
                const json = JSON.parse(raw);
                if (typeof json === 'string') {
                  fullContent += json;
                  continue;
                }
                const delta = json?.choices?.[0]?.delta?.content;
                if (delta) {
                  fullContent += delta;
                  continue;
                }
                const text =
                  json?.text || json?.content || json?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) fullContent += text;
              } catch {
                // Skip unparseable data lines
              }
            } else {
              try {
                const json = JSON.parse(trimmed);
                const delta =
                  json?.choices?.[0]?.delta?.content ?? json?.text ?? json?.content ?? '';
                if (delta) fullContent += delta;
              } catch {
                // Not JSON — skip
              }
            }
          }
        }

        // 6. Post-completion credit deduction
        const responseTimeMs = Date.now() - requestStartTime;
        const inputTokens = countTokens(prompt + systemPrompt);
        const outputTokens = countTokens(fullContent);

        const resolvedTier = getModelTier(modelId);
        const tierConfig = MODEL_TIERS[resolvedTier as keyof typeof MODEL_TIERS];

        // Try DB pricing, fall back to tier config
        let inputPrice = tierConfig?.inputCostPer1M ?? 100;
        let outputPrice = tierConfig?.outputCostPer1M ?? 300;
        try {
          const db = await getServerDB();
          const pricing = await db.query.modelPricing.findFirst({
            where: eq(modelPricing.modelId, modelId),
          });
          if (pricing) {
            inputPrice = pricing.inputPrice ?? inputPrice;
            outputPrice = pricing.outputPrice ?? outputPrice;
          }
        } catch {
          // Use tier fallback
        }

        const cost = Math.ceil((inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000);

        await processModelUsage(userId, cost, resolvedTier, tierSlotAcquired, {
          inputTokens,
          model: modelId,
          outputTokens,
          provider,
          responseTimeMs,
        });

        console.log(
          `[artifact-ai] Success via ${provider}, ${fullContent.length} chars, ${cost} Credits deducted`,
        );
        return NextResponse.json({ text: fullContent });
      }

      const text = await response.text();

      // Credit deduction for non-streaming
      const responseTimeMs = Date.now() - requestStartTime;
      const inputTokens = countTokens(prompt + systemPrompt);
      const outputTokens = countTokens(text);
      const resolvedTier = getModelTier(modelId);
      const tierConfig = MODEL_TIERS[resolvedTier as keyof typeof MODEL_TIERS];
      const cost = Math.ceil(
        (inputTokens * (tierConfig?.inputCostPer1M ?? 100) +
          outputTokens * (tierConfig?.outputCostPer1M ?? 300)) /
          1_000_000,
      );
      await processModelUsage(userId, cost, resolvedTier, tierSlotAcquired, {
        inputTokens,
        model: modelId,
        outputTokens,
        provider,
        responseTimeMs,
      });

      return NextResponse.json({ text });
    } catch (e: any) {
      console.error(`[artifact-ai] Attempt ${idx + 1} failed (${provider}):`, e?.message);
      lastError = e;
    }
  }

  return NextResponse.json(
    { error: `All providers failed. ${lastError?.message || ''}` },
    { status: 502 },
  );
}
