import { AuthObject } from '@clerk/backend';
import {
  AgentRuntimeError,
  ChatCompletionErrorPayload,
  ModelRuntime,
} from '@lobechat/model-runtime';
import { ChatErrorType, ClientSecretPayload } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';
import { NextRequest } from 'next/server';

import {
  LOBE_CHAT_AUTH_HEADER,
  LOBE_CHAT_OIDC_AUTH_HEADER,
  OAUTH_AUTHORIZED,
  enableClerk,
} from '@/const/auth';
import { ClerkAuth } from '@/libs/clerk-auth';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';
import { createErrorResponse } from '@/utils/errorResponse';

import { checkAuthMethod } from './utils';

// NOTE: Database imports are done dynamically inside the function to avoid
// bundling Node.js modules for edge runtime routes that use this middleware

type CreateRuntime = (jwtPayload: ClientSecretPayload) => ModelRuntime;
type RequestOptions = { createRuntime?: CreateRuntime; params: Promise<{ provider: string }> };

export type RequestHandler = (
  req: Request,
  options: RequestOptions & {
    createRuntime?: CreateRuntime;
    jwtPayload: ClientSecretPayload;
  },
) => Promise<Response>;

export const checkAuth =
  (handler: RequestHandler) => async (req: Request, options: RequestOptions) => {
    // we have a special header to debug the api endpoint in development mode
    const isDebugApi = req.headers.get('lobe-auth-dev-backend-api') === '1';
    if (process.env.NODE_ENV === 'development' && isDebugApi) {
      return handler(req, { ...options, jwtPayload: { userId: 'DEV_USER' } });
    }

    let jwtPayload: ClientSecretPayload;

    try {
      // get Authorization from header
      const authorization = req.headers.get(LOBE_CHAT_AUTH_HEADER);
      const oauthAuthorized = !!req.headers.get(OAUTH_AUTHORIZED);

      if (!authorization) throw AgentRuntimeError.createError(ChatErrorType.Unauthorized);

      // check the Auth With payload and clerk auth
      let clerkAuth = {} as AuthObject;

      // TODO: V2 完整移除 client 模式下的 clerk 集成代码
      if (enableClerk) {
        const clerkAuthHelper = new ClerkAuth();
        const data = await clerkAuthHelper.getAuthFromRequest(req as NextRequest);
        clerkAuth = data.clerkAuth as unknown as AuthObject;
      }

      jwtPayload = getXorPayload(authorization);

      const oidcAuthorization = req.headers.get(LOBE_CHAT_OIDC_AUTH_HEADER);
      let isUseOidcAuth = false;
      if (!!oidcAuthorization) {
        const oidc = await validateOIDCJWT(oidcAuthorization);

        isUseOidcAuth = true;

        jwtPayload = {
          ...jwtPayload,
          userId: oidc.userId,
        };
      }

      if (!isUseOidcAuth)
        checkAuthMethod({
          accessCode: jwtPayload.accessCode,
          apiKey: jwtPayload.apiKey,
          clerkAuth,
          fallbackUserId: jwtPayload.userId,
          nextAuthAuthorized: oauthAuthorized,
        });
    } catch (e) {
      // if the error is not a ChatCompletionErrorPayload, it means the application error
      if (!(e as ChatCompletionErrorPayload).errorType) {
        if ((e as any).code === 'ERR_JWT_EXPIRED')
          return createErrorResponse(ChatErrorType.SystemTimeNotMatchError, e);

        // other issue will be internal server error
        console.error(e);
        return createErrorResponse(ChatErrorType.InternalServerError, {
          error: { message: 'Đã có lỗi xảy ra. Vui lòng thử lại sau.' },
          provider: 'pho-chat',
        });
      }

      const { errorType = ChatErrorType.InternalServerError } = e as ChatCompletionErrorPayload;

      return createErrorResponse(errorType, {
        error: { message: 'Đã có lỗi xảy ra. Vui lòng thử lại sau.' },
        provider: 'pho-chat',
      });
    }

    // ============  Subscription & Trial Validation   ============ //
    // Check if user can access AI models (paid subscription OR free trial)
    // NOTE: Using dynamic imports to avoid bundling Node.js modules for edge runtime
    if (jwtPayload.userId) {
      try {
        // Dynamic import to avoid edge runtime bundling issues
        const { getServerDB } = await import('@/database/server');
        const { SubscriptionService } = await import('@/server/services/subscription');

        const db = await getServerDB();
        const subscriptionService = new SubscriptionService(db);

        // Check trial access with the requested model
        const trialAccess = await subscriptionService.checkTrialAccess(jwtPayload.userId);

        if (!trialAccess.allowed) {
          const plan = await subscriptionService.getSubscriptionPlan(jwtPayload.userId);
          console.warn('[Subscription Auth] Trial expired - user needs to upgrade:', {
            messagesRemaining: trialAccess.messagesRemaining,
            planId: plan.planId,
            reason: trialAccess.reason,
            tokensRemaining: trialAccess.tokensRemaining,
            userId: jwtPayload.userId,
          });

          return createErrorResponse(ChatErrorType.Unauthorized, {
            error: new Error(trialAccess.reason || 'Free trial expired. Please upgrade your plan.'),
            isTrialExpired: true,
            message:
              trialAccess.reason || 'Bạn đã sử dụng hết quota miễn phí. Nâng cấp để tiếp tục chat.',
            upgradeUrl: '/settings/subscription',
          });
        }

        // Log and track trial user access
        if (trialAccess.isTrialUser) {
          console.log('[Subscription Auth] 🆓 Trial user access granted:', {
            messagesRemaining: trialAccess.messagesRemaining,
            tokensRemaining: trialAccess.tokensRemaining,
            userId: jwtPayload.userId,
          });

          // Trial usage is tracked as a pre-flight marker only.
          // Actual token counts, model tier, and response time are logged
          // by processModelUsage() after the chat completion finishes.
          const remaining = (trialAccess.messagesRemaining ?? 0) - 1;
          console.log(`📊 Trial user: ${jwtPayload.userId} (${remaining} messages remaining)`);
        } else {
          console.log(
            '[Subscription Auth] ✅ Paid subscription validated for user:',
            jwtPayload.userId,
          );
        }
      } catch (error) {
        // PHO-249/A1.11: Fail closed when subscription/trial validation infra is down.
        // Returning 503 prevents free-trial enforcement bypass during DB outages and
        // signals clients to retry instead of silently granting elevated access.
        console.error('[Subscription Auth] DB error — failing closed (PHO-249/A1.11):', error);
        return new Response(
          JSON.stringify({
            error: 'AUTH_SERVICE_UNAVAILABLE',
            message: 'Hệ thống đang bảo trì, vui lòng thử lại sau.',
          }),
          {
            headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
            status: 503,
          },
        );
      }
    }

    return handler(req, { ...options, jwtPayload });
  };
