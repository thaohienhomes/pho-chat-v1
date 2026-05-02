import { ModelProvider } from '@lobechat/model-runtime';
import { TRPCLink, createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import debug from 'debug';
import superjson from 'superjson';

import { isDesktop } from '@/const/version';
import type { LambdaRouter } from '@/server/routers/lambda';

import { captureAuthExpired, forceReauth, shouldForceReauth, silentRefresh } from './authRecovery';

const log = debug('lobe-image:lambda-client');

// Retry once on UNAUTHORIZED — waits for Clerk auth hydration via store polling
// Prevents SSO callback race condition where Lambda calls fire before token is ready.
// NOTE: In the link chain this MUST sit inside errorHandlingLink so that a
// successful retry swallows the 401 before errorHandlingLink sees it — otherwise
// every parallel 401 in an inbox burst fires auth_session_expired even when
// recovery is still in progress.
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

              // Poll useUserStore for Clerk auth readiness. PHO-259: cap at 2s —
              // silentRefresh typically resolves <1s, so a generous 2s wins back
              // the 6s of unrecoverable user-facing latency the previous 8s wait
              // was burning on every 401. Past 2s the recovery is treated as
              // failed; shouldForceReauth() escalates on the next failure rather
              // than keeping the user stuck. The `settled` guard stops the
              // recursive poll from running as a zombie timer after the safety
              // cap fires.
              await new Promise<void>((resolve) => {
                let settled = false;
                const finish = () => {
                  if (settled) return;
                  settled = true;
                  resolve();
                };
                const check = () => {
                  if (settled) return;
                  const s = useUserStore.getState();
                  if (s.isLoaded) return finish();
                  setTimeout(check, 100);
                };
                check();
                setTimeout(finish, 2000);
              });

              // Singleflight refresh — parallel 401s share one Clerk call.
              const refreshed = await silentRefresh();
              const updated = useUserStore.getState();

              if (refreshed && updated.isSignedIn) {
                attempt();
                return;
              }

              // Recovery failed: count the failure and escalate if we're stuck.
              if (shouldForceReauth()) {
                forceReauth();
              }
            } else if (
              status === 401 &&
              retried && // PHO-252: second 401 after a successful client-side refresh.
              // The fresh JWT didn't satisfy the server (Clerk session
              // server-side dead, instance/kid mismatch, kid rotation lag
              // between client and edge). Without counting this, the link
              // bubbled the error to errorHandlingLink which only captures
              // the PostHog event — forceReauth() never fired, leaving the
              // user permanently broken across many sessions. Counting it
              // here lets shouldForceReauth() escalate after the threshold.
              shouldForceReauth()
            ) {
              forceReauth();
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
                // Only reached after retryOnUnauthorizedLink has already tried
                // to refresh + replay the request. Capture is throttled to
                // avoid the "8 events in 15ms" storm we saw in production.
                captureAuthExpired();
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
// Order matters: errorHandlingLink is OUTSIDE retryOnUnauthorizedLink so the
// retry gets a chance to recover before the 401 reaches the error handler.
// If retry succeeds, errorHandlingLink never sees a 401.
const links = [errorHandlingLink, retryOnUnauthorizedLink, customHttpBatchLink];

export const lambdaClient = createTRPCClient<LambdaRouter>({
  links,
});

export const lambdaQuery = createTRPCReact<LambdaRouter>();

export const lambdaQueryClient = lambdaQuery.createClient({ links });
