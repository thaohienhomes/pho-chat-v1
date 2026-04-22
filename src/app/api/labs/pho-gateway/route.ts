import { AgentRuntimeErrorType, ModelRuntime } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { phoGatewayService } from '@/server/services/phoGateway';
import { ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';

export const maxDuration = 300;

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
  // Benchmark Bypass Logic (for test-failover script)
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  const labsToken = process.env.PHO_GATEWAY_LABS_TOKEN;

  if (!labsToken) {
    console.error('[labs/pho-gateway] PHO_GATEWAY_LABS_TOKEN not configured');
    return new Response(JSON.stringify({ error: 'Service not configured' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 503,
    });
  }

  if (authHeader === `Bearer ${labsToken}`) {
    console.log('[Labs/PhoGateway] ✅ Authorized via PHO_GATEWAY_LABS_TOKEN bypass');
    const data = (await req.json()) as ChatStreamPayload;
    return handleRequest(data, {} as any);
  }

  return authenticatedHandler(req, options);
};
