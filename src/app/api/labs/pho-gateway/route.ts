import { AgentRuntimeErrorType, ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';
import { timingSafeEqual } from 'node:crypto';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { pino } from '@/libs/logger';
import { captureServerEvent } from '@/libs/posthog-server';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { isAdmin } from '@/server/services/auth/adminGuard';
import { phoGatewayService } from '@/server/services/phoGateway';
import { ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';

export const maxDuration = 300;

/**
 * Constant-time string equality. JS `===` short-circuits on the first
 * differing byte, which would let a network-adjacent attacker recover a
 * shared secret one byte at a time via response-latency measurements.
 *
 * Length is leaked (different-length strings return immediately), which is
 * fine here: the expected value is `Bearer <fixed-token>`, so the length
 * is structural rather than secret.
 */
const constantTimeEqual = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
};

async function handleRequest(data: ChatStreamPayload, jwtPayload: any) {
  const { model, provider: requestedProvider } = data;

  console.log(
    `[Labs/PhoGateway] Request received for model: ${model}, requested provider: ${requestedProvider}`,
  );

  // 1. Resolve Priority List
  const priorityList = phoGatewayService.resolveProviderList(model, requestedProvider);

  console.log(`[Labs/PhoGateway] Priority List:`, priorityList);

  let lastError: any = null;

  // 2. Iterative Execution (Retry Loop)
  for (const [index, entry] of priorityList.entries()) {
    const { provider, modelId } = entry;

    console.log(
      `[Labs/PhoGateway] Attempt ${index + 1}: trying provider ${provider} with model ${modelId}`,
    );

    try {
      // Initialize runtime for this specific provider
      const runtime: ModelRuntime = await initModelRuntimeWithUserPayload(provider, jwtPayload);

      // Execute chat with updated modelId
      const response = await runtime.chat({
        ...data,
        model: modelId,
      });

      // Add a custom header to report which provider was used
      const headers = new Headers(response.headers);
      headers.set('X-Pho-Provider', provider);
      headers.set('X-Pho-Model-ID', modelId);

      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    } catch (e: any) {
      console.error(
        `[Labs/PhoGateway] Attempt ${index + 1} failed for ${provider}:`,
        e?.message || e,
      );
      lastError = e;

      // Determine if we should retry
      // We retry on 500s, 429s (rate limits), and timeouts
      const isRetryable =
        e?.status === 500 ||
        e?.status === 429 ||
        e?.type === AgentRuntimeErrorType.ProviderBizError ||
        e?.code === 'ECONNRESET';

      if (!isRetryable && index < priorityList.length - 1) {
        console.warn(
          `[Labs/PhoGateway] Error might not be retryable, but continuing failover as safety measure.`,
        );
      }

      if (index === priorityList.length - 1) {
        console.error(`[Labs/PhoGateway] All providers failed. Returning last error.`);
      } else {
        console.warn(`[Labs/PhoGateway] Failover triggered: moving to next provider.`);
      }
    }
  }

  // 3. Fallback Error Response
  const errorType = lastError?.type || ChatErrorType.InternalServerError;
  return createErrorResponse(errorType, {
    error: lastError,
    message: `All prioritized providers failed for logical model ${model}. Last error: ${lastError?.message}`,
    provider: requestedProvider,
  });
}

const coreHandler = async (req: Request, { jwtPayload }: any) => {
  const data = (await req.json()) as ChatStreamPayload;
  return handleRequest(data, jwtPayload);
};

const authenticatedHandler = checkAuth(coreHandler);

export const POST = async (req: Request, options: any) => {
  // Benchmark bypass for the CI test-failover script. Two-factor:
  //   1. Shared `PHO_GATEWAY_LABS_TOKEN` (env-only, rotatable).
  //   2. `X-Admin-User-Id` header → must resolve to an admin via Clerk
  //      (`isAdmin()` checks env allowlist + Clerk role metadata).
  // Token alone is NOT sufficient — that was the cost-leak we're closing.
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  const labsToken = process.env.PHO_GATEWAY_LABS_TOKEN;
  const adminUserIdHeader = req.headers.get('x-admin-user-id');
  const tokenPresented = !!authHeader && authHeader.startsWith('Bearer ');

  if (!labsToken) {
    pino.error(
      { endpoint: '/api/labs/pho-gateway' },
      'PHO_GATEWAY_LABS_TOKEN not configured — labs bypass disabled',
    );
    return new Response(JSON.stringify({ error: 'Service not configured' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 503,
    });
  }

  const tokenMatches = !!authHeader && constantTimeEqual(authHeader, `Bearer ${labsToken}`);

  if (tokenMatches) {
    if (!adminUserIdHeader) {
      captureServerEvent('billing_bypass_denied', 'anonymous', {
        endpoint: '/api/labs/pho-gateway',
        reason: 'missing_admin_user_id_header',
      });
      pino.warn(
        { endpoint: '/api/labs/pho-gateway' },
        'Labs bypass denied: token presented without X-Admin-User-Id header',
      );
      return new Response(
        JSON.stringify({ error: 'X-Admin-User-Id header required for labs bypass' }),
        { headers: { 'Content-Type': 'application/json' }, status: 403 },
      );
    }

    const adminAuthorized = await isAdmin(adminUserIdHeader);
    if (!adminAuthorized) {
      captureServerEvent('billing_bypass_denied', adminUserIdHeader, {
        endpoint: '/api/labs/pho-gateway',
        reason: 'non_admin_user_id',
      });
      pino.warn(
        { adminUserIdHeader, endpoint: '/api/labs/pho-gateway' },
        'Labs bypass denied: claimed userId is not an admin',
      );
      return new Response(
        JSON.stringify({ error: 'Forbidden: admin role required for labs bypass' }),
        { headers: { 'Content-Type': 'application/json' }, status: 403 },
      );
    }

    const data = (await req.json()) as ChatStreamPayload;
    captureServerEvent('billing_bypass_used', adminUserIdHeader, {
      endpoint: '/api/labs/pho-gateway',
      model: data?.model,
      provider: data?.provider,
    });
    pino.info(
      { adminUserId: adminUserIdHeader, model: data?.model, provider: data?.provider },
      'Labs bypass authorized via PHO_GATEWAY_LABS_TOKEN',
    );
    return handleRequest(data, { userId: adminUserIdHeader } as any);
  }

  // Token mismatch with a Bearer header — likely an attacker probing the
  // endpoint. Capture for security visibility, then fall through to the
  // standard authenticated handler so legitimate Clerk-JWT callers still work.
  // Distinct-id is fixed to 'anonymous' because no identity has been verified
  // yet — using the attacker-controlled header as identity would let probes
  // pollute another user's PostHog timeline. The header is preserved as an
  // explicitly untrusted property for forensics.
  if (tokenPresented) {
    captureServerEvent('billing_bypass_denied', 'anonymous', {
      endpoint: '/api/labs/pho-gateway',
      reason: 'invalid_labs_token',
      untrusted_admin_user_id: adminUserIdHeader || null,
    });
  }

  return authenticatedHandler(req, options);
};
