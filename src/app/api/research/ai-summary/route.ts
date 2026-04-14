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

export const maxDuration = 300;

/**
 * Known model-to-provider mappings for common research models.
 * Used to correctly resolve providers before calling remapProvider.
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
 * POST /api/research/ai-summary
 *
 * Clerk-authenticated AI completions endpoint for the Research Mode
 * Evidence Summarizer & Multi-Agent Manuscript Reviewer.
 * Full billing enforcement: credit check, tier access, and usage deduction.
 *
 * Body: { model: string; prompt: string; stream?: boolean }
 * Response: { text: string } or SSE stream
 */
export async function POST(req: NextRequest) {
  // ── 1. Auth via Clerk cookies ───────────────────────────────────────────
  let userId: string | null = null;
  try {
    const { auth } = await import('@clerk/nextjs/server');
    const session = await auth();
    userId = session.userId;
  } catch {
    // Clerk auth not available
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized – please sign in' }, { status: 401 });
  }

  // ── 2. Parse body ───────────────────────────────────────────────────────
  let body: { model?: string; prompt?: string; stream?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { model = 'gemini-2.5-flash', prompt, stream: streamMode = false } = body;
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  // ── 3. Credit & tier access check ──────────────────────────────────────
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

  // ── 4. Resolve provider chain ─────────────────────────────────────────
  const hintProvider = MODEL_PROVIDER_HINTS[model] || 'openai';
  const remapped = phoGatewayService.remapProvider(hintProvider, model);

  console.log('[research/ai-summary] Request:', {
    hintProvider,
    model,
    remappedModelId: remapped.modelId,
    remappedProvider: remapped.provider,
    userId,
  });

  const providerList = [
    remapped,
    ...(remapped.provider !== 'vercelaigateway'
      ? [{ modelId: `google/${model.replace('google/', '')}`, provider: 'vercelaigateway' }]
      : []),
  ];

  // ── 5. Try each provider ──────────────────────────────────────────────
  const messages = [{ content: prompt, role: 'user' as const }];
  const emptyPayload = {} as any;
  let lastError: any = null;
  const requestStartTime = Date.now();

  for (const [idx, entry] of providerList.entries()) {
    const { provider, modelId } = entry;
    try {
      console.log(
        `[research/ai-summary] Attempt ${idx + 1}: provider=${provider}, model=${modelId}`,
      );
      const runtime = await initModelRuntimeWithUserPayload(provider, emptyPayload);
      const response = await runtime.chat(
        {
          messages,
          model: modelId,
          temperature: 0.4,
        } as any,
        { user: userId },
      );

      if (response.body) {
        const decoder = new TextDecoder();

        // ── Streaming mode: pipe SSE events to client ──
        if (streamMode) {
          // Tee stream for billing audit
          const [clientStream, auditStream] = response.body.tee();
          const encoder = new TextEncoder();

          // Audit in background — deduct credits after stream completes
          (async () => {
            try {
              const reader = auditStream.getReader();
              let accumulatedText = '';
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                accumulatedText += decoder.decode(value, { stream: true });
              }
              const responseTimeMs = Date.now() - requestStartTime;
              const inputTokens = countTokens(prompt);
              const outputTokens = countTokens(accumulatedText);
              const resolvedTier = getModelTier(modelId);
              const tierConfig = MODEL_TIERS[resolvedTier as keyof typeof MODEL_TIERS];
              const cost = Math.ceil(
                (inputTokens * (tierConfig?.inputCostPer1M ?? 100) +
                  outputTokens * (tierConfig?.outputCostPer1M ?? 300)) /
                  1_000_000,
              );
              await processModelUsage(userId!, cost, resolvedTier, tierSlotAcquired, {
                inputTokens,
                model: modelId,
                outputTokens,
                provider,
                responseTimeMs,
              });
              console.log(
                `[research/ai-summary] Stream billing: ${cost} Credits, ${responseTimeMs}ms`,
              );
            } catch (e) {
              console.error('[research/ai-summary] Stream billing failed:', e);
            }
          })();

          // Forward SSE to client with content extraction
          const readable = new ReadableStream({
            async start(controller) {
              try {
                const reader = clientStream.getReader();
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
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify(json)}\n\n`));
                          continue;
                        }
                        const delta = json?.choices?.[0]?.delta?.content;
                        if (delta) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
                          continue;
                        }
                        const text =
                          json?.text ||
                          json?.content ||
                          json?.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify(text)}\n\n`));
                          continue;
                        }
                      } catch {
                        // Not valid JSON — skip non-text data lines
                      }
                    } else {
                      try {
                        const json = JSON.parse(trimmed);
                        const delta =
                          json?.choices?.[0]?.delta?.content ?? json?.text ?? json?.content ?? '';
                        if (delta)
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify(delta)}\n\n`));
                      } catch {
                        // Not JSON — skip
                      }
                    }
                  }
                }
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
              } catch (err) {
                controller.error(err);
              }
            },
          });

          console.log(`[research/ai-summary] Streaming via ${provider}`);
          return new Response(readable, {
            headers: {
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Content-Type': 'text/event-stream',
            },
          });
        }

        // ── Non-streaming mode: buffer full response ──
        const reader = response.body.getReader();
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
        const inputTokens = countTokens(prompt);
        const outputTokens = countTokens(fullContent);
        const resolvedTier = getModelTier(modelId);
        const tierConfig = MODEL_TIERS[resolvedTier as keyof typeof MODEL_TIERS];

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
          `[research/ai-summary] Success via ${provider}, ${fullContent.length} chars, ${cost} Credits`,
        );
        return NextResponse.json({ model: modelId, provider, text: fullContent });
      }

      // Non-streaming response
      const text = await response.text();
      const responseTimeMs = Date.now() - requestStartTime;
      const inputTokens = countTokens(prompt);
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

      return NextResponse.json({ model: modelId, provider, text });
    } catch (e: any) {
      console.error(`[research/ai-summary] Attempt ${idx + 1} failed (${provider}):`, e?.message);
      lastError = e;
    }
  }

  return NextResponse.json(
    { error: `All providers failed. ${lastError?.message || ''}` },
    { status: 502 },
  );
}
