/**
 * Server-side PostHog capture using the public capture endpoint.
 *
 * Why fetch instead of `posthog-node`?
 * - No new runtime dep, no bundle size hit on every Vercel function.
 * - For our use (fire-and-forget $ai_generation events) we don't need the
 *   batching, retry, or shutdown logic that `posthog-node` provides.
 * - Trade-off: a small percentage of events may be lost during serverless
 *   cold-shutdown. Acceptable for observability — not for billing.
 *
 * If we ever need durable delivery, swap this module for `posthog-node`
 * with `waitUntil(client.shutdown())` from `@vercel/functions`.
 */

const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

export interface CaptureAiGenerationParams {
  costPoints: number;
  costUSD?: number;
  /** Feature label so we can split spend in PostHog (chat / embedding / artifact / ...) */
  feature?: string;
  inputTokens: number;
  latencyMs?: number;
  model: string;
  outputTokens: number;
  /** True when a stream aborted before completion (PHO-230). */
  partial?: boolean;
  provider: string;
  userId: string;
}

/**
 * Fire-and-forget PostHog `$ai_generation` event.
 * Returns immediately; failures are logged and swallowed.
 *
 * Caller must NOT await this — billing/inference paths cannot pay the
 * observability tax. The trailing `.catch` exists to keep the unhandled-
 * rejection log clean.
 */
export function captureAiGeneration(params: CaptureAiGenerationParams): void {
  if (!POSTHOG_KEY || !params.userId) return;

  const body = {
    api_key: POSTHOG_KEY,
    distinct_id: params.userId,
    event: '$ai_generation',
    properties: {
      $ai_cost_points: params.costPoints,
      $ai_feature: params.feature ?? 'chat',
      $ai_input_tokens: params.inputTokens,
      $ai_latency_ms: params.latencyMs,
      $ai_model: params.model,
      $ai_output_tokens: params.outputTokens,
      $ai_partial: params.partial ?? false,
      $ai_provider: params.provider,
      ...(params.costUSD !== undefined && { $ai_cost_usd: params.costUSD }),
    },
    timestamp: new Date().toISOString(),
  };

  void fetch(`${POSTHOG_HOST}/capture/`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }).catch((e) => {
    console.warn('[PostHog Server] $ai_generation capture failed:', (e as Error)?.message);
  });
}
