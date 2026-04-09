import { ModelProvider } from '@lobechat/model-runtime';
import { TRPCLink, createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import debug from 'debug';
import superjson from 'superjson';

import { isDesktop } from '@/const/version';
import type { LambdaRouter } from '@/server/routers/lambda';

const log = debug('lobe-image:lambda-client');

// Retry once on UNAUTHORIZED — waits for Clerk auth hydration via store polling
// Prevents SSO callback race condition where Lambda calls fire before token is ready
const retryOnUnauthorizedLink: TRPCLink<LambdaRouter> = () => {
  return ({ op, next }) =>
    observable((observer) => {
      let retried = false;
      const attempt = () =>
        next(op).subscribe({
          complete: () => observer.complete(),
          error: async (err) => {
            const status = (err as any).data?.httpStatus as number | undefined;
            if (status === 401 && !retried) {
              retried = true;
              const { useUserStore } = await import('@/store/user');
              const state = useUserStore.getState();

              // If Clerk already loaded but user not signed in, don't retry — genuinely unauthenticated
              if (state.isLoaded && !state.isSignedIn) {
                observer.error(err);
                return;
              }

              // Poll useUserStore for Clerk auth readiness (extended timeout for slow regions)
              await new Promise<void>((resolve) => {
                const check = () => {
                  const s = useUserStore.getState();
                  if (s.isLoaded) return resolve();
                  setTimeout(check, 200);
                };
                check();
                setTimeout(resolve, 8000); // Max 8s wait (Clerk CDN slow in VN)
              });

              // Try to silently refresh the Clerk session token
              try {
                const clerk = (window as any).Clerk;
                if (clerk?.session) {
                  await clerk.session.getToken({ skipCache: true });
                }
              } catch {
                // Token refresh failed — will fall through to error
              }

              // After waiting, only retry if user is actually signed in
              const updated = useUserStore.getState();
              if (updated.isSignedIn) {
                attempt();
                return;
              }
            }
            observer.error(err);
          },
          next: (value) => observer.next(value),
        });
      attempt();
    });
};

// handle error
const errorHandlingLink: TRPCLink<LambdaRouter> = () => {
  return ({ op, next }) =>
    observable((observer) =>
      next(op).subscribe({
        complete: () => observer.complete(),
        error: async (err) => {
          // Check if this is an abort error and should be ignored
          const isAbortError =
            err.message.includes('aborted') ||
            err.name === 'AbortError' ||
            err.cause?.name === 'AbortError' ||
            err.message.includes('signal is aborted without reason');

          const showError = (op.context?.showNotification as boolean) ?? true;

          // Don't show notifications for abort errors
          if (showError && !isAbortError) {
            const status = err.data?.httpStatus as number;
            const { fetchErrorNotification } =
              await import('@/components/Error/fetchErrorNotification');

            // Don't show notification for 401 errors - let the message error handler display ClerkLogin component
            // This allows proper error handling in the catch block to create ChatErrorType.InvalidClerkUser
            switch (status) {
              case 401: {
                // Track expired sessions via PostHog
                (window as any).posthog?.capture('auth_session_expired', {
                  pathname: window.location.pathname,
                  url: window.location.href,
                });
                break;
              }

              default: {
                // Don't show notification for transient network errors
                const isNetworkError =
                  err.message === 'Failed to fetch' ||
                  err.message.includes('NetworkError') ||
                  err.message.includes('Load failed');

                if (!isNetworkError) {
                  fetchErrorNotification.error({ errorMessage: err.message, status });
                }
              }
            }
          }

          observer.error(err);
        },
        next: (value) => observer.next(value),
      }),
    );
};

// 2. httpBatchLink
const customHttpBatchLink = httpBatchLink({
  fetch: async (input, init) => {
    if (isDesktop) {
      const { desktopRemoteRPCFetch } = await import('@/utils/electron/desktopRemoteRPCFetch');

      // eslint-disable-next-line no-undef
      const res = await desktopRemoteRPCFetch(input as string, init as RequestInit);

      if (res) return res;
    }

    // eslint-disable-next-line no-undef
    return await fetch(input, init as RequestInit);
  },
  headers: async () => {
    // dynamic import to avoid circular dependency
    const { createHeaderWithAuth } = await import('@/services/_auth');

    let provider: ModelProvider = ModelProvider.OpenAI;
    // for image page, we need to get the provider from the store
    log('Getting provider from store for image page: %s', location.pathname);
    if (location.pathname === '/image') {
      const { getImageStoreState } = await import('@/store/image');
      const { imageGenerationConfigSelectors } =
        await import('@/store/image/slices/generationConfig/selectors');
      provider = imageGenerationConfigSelectors.provider(getImageStoreState()) as ModelProvider;
      log('Getting provider from store for image page: %s', provider);
    }

    // TODO: we need to support provider select for chat page
    const headers = await createHeaderWithAuth({ provider });
    log('Headers: %O', headers);
    return headers;
  },
  maxURLLength: 2083,
  transformer: superjson,
  url: '/trpc/lambda',
});

// 3. assembly links
const links = [retryOnUnauthorizedLink, errorHandlingLink, customHttpBatchLink];

export const lambdaClient = createTRPCClient<LambdaRouter>({
  links,
});

export const lambdaQuery = createTRPCReact<LambdaRouter>();

export const lambdaQueryClient = lambdaQuery.createClient({ links });
