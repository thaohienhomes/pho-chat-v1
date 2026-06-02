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
import { getUserPlanFromDB } from '@/server/services/subscription/getUserPlanFromDB';

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
  /**
   * PHO-246: resolved user plan ID. Pass when caller already authorized the
   * request (chat / artifact / research routes) — saves a DB lookup. If
   * omitted, the capture function asynchronously falls back to
   * `getUserPlanFromDB(userId)` and logs a warning so we can migrate the
   * caller later.
   */
  planId?: string;
  /** PHO-246: source of the plan resolution for drift telemetry. */
  planSource?: string;
  provider: string;
  /** PHO-246: model tier (1/2/3) for cost-per-tier breakdowns. */
  tier?: number;
  /**
   * PCFIX-4: time-to-first-token in ms. Streaming paths set this when the first
   * content chunk arrives; undefined for non-streaming / unmeasured calls.
   * `$ai_latency_ms` (total wall-clock) minus this approximates stream duration,
   * so we can tell "stalled before first token" from "long stream".
   */
  ttftMs?: number;
  userId: string;
}

/**
 * Build the event body and POST it to PostHog. Async so we can optionally
 * resolve the user's plan via DB lookup when the caller didn't pass one.
 *
 * PHO-246: even though this is fire-and-forget, the DB lookup is cheap
 * (single SELECT, optional Clerk fetch in soft mode) and runs after the
 * request has returned to the user. The warning log helps us migrate
 * legacy callers that should be passing `planId` from their authorization
 * context for free.
 */
async function emitAiGeneration(params: CaptureAiGenerationParams): Promise<void> {
  let { planId, planSource } = params;

  if (!planId) {
    try {
      const result = await getUserPlanFromDB(params.userId);
      planId = result.planId;
      planSource = result.source;
      console.warn(
        `[PostHog Server] $ai_generation: planId not passed by caller for user ${params.userId}; ` +
          `looked up DB plan=${planId} (source=${planSource}). ` +
          `Migrate caller to pass planId for performance.`,
      );
    } catch (err) {
      // DB lookup failed — emit the event without plan info rather than drop it.
      console.warn(
        '[PostHog Server] getUserPlanFromDB failed in $ai_generation fallback:',
        (err as Error)?.message,
      );
    }
  }

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
      // PCFIX-4: time-to-first-token (stream paths). Undefined values are dropped by JSON.stringify.
      $ai_ttft_ms: params.ttftMs,
      ...(params.costUSD !== undefined && { $ai_cost_usd: params.costUSD }),
      // PHO-246: cost-per-plan / cost-per-tier breakdowns.
      ...(planId !== undefined && { planId }),
      ...(planSource !== undefined && { plan_source: planSource }),
      ...(params.tier !== undefined && { tier: params.tier }),
    },
    timestamp: new Date().toISOString(),
  };

  await fetch(`${POSTHOG_HOST}/capture/`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
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

  void emitAiGeneration(params).catch((e) => {
    console.warn('[PostHog Server] $ai_generation capture failed:', (e as Error)?.message);
  });
}

/**
 * Fire-and-forget capture of an arbitrary server-side event.
 *
 * Used for security/audit events where we need a durable trail but cannot
 * block the request path. Examples: `billing_bypass_used`,
 * `billing_bypass_denied`. Distinct-id is required so PostHog can attribute
 * the event to a person; pass `'anonymous'` for unauthenticated callers.
 *
 * Event names MUST NOT start with `$` — that prefix is reserved for PostHog
 * built-in events and will be silently filtered in some queries.
 */
export function captureServerEvent(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
): void {
  if (!POSTHOG_KEY) {
    // Audit events for billing/security must not vanish silently when PostHog
    // is misconfigured — that's exactly the failure mode where we most need
    // to know. Loud warning, but still non-blocking.
    console.warn(
      `[PostHog Server] NEXT_PUBLIC_POSTHOG_KEY missing — dropping event '${event}' for distinctId '${distinctId}'`,
    );
    return;
  }
  if (event.startsWith('$')) {
    console.warn(`[PostHog Server] event name '${event}' uses reserved $ prefix; skipping.`);
    return;
  }

  const body = {
    api_key: POSTHOG_KEY,
    distinct_id: distinctId || 'anonymous',
    event,
    properties,
    timestamp: new Date().toISOString(),
  };

  void fetch(`${POSTHOG_HOST}/capture/`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
    .then((response) => {
      if (!response.ok) {
        // PostHog rejected the event — surface so misconfigured projects /
        // rate limits show up in the function logs instead of disappearing.
        console.warn(
          `[PostHog Server] ${event} capture rejected: ${response.status} ${response.statusText}`,
        );
      }
    })
    .catch((e) => {
      console.warn(`[PostHog Server] ${event} capture failed:`, (e as Error)?.message);
    });
}
