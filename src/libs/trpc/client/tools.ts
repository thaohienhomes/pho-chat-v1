import { TRPCLink, createTRPCClient, httpBatchLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import superjson from 'superjson';

import { isDesktop } from '@/const/version';
import type { ToolsRouter } from '@/server/routers/tools';
import { fetchWithDesktopRemoteRPC } from '@/utils/electron/desktopRemoteRPCFetch';

import { forceReauth, shouldForceReauth, silentRefresh } from './authRecovery';

// Mirrors the lambda + edge clients' retryOnUnauthorizedLink so plugin-router
// 401s share the same singleflight Clerk refresh and force-reauth escalation.
// A previous "unify across all clients" commit (6153353958) introduced a
// shared factory file that no longer exists in the tree, leaving tools.ts as
// the only client that bubbled up 401s without auto-retry — restoring the
// guard inline keeps the patch small and avoids reintroducing a missing file.
const retryOnUnauthorizedLink: TRPCLink<ToolsRouter> = () => {
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

              // If Clerk already loaded but user not signed in, don't retry —
              // genuinely unauthenticated.
              if (state.isLoaded && !state.isSignedIn) {
                observer.error(err);
                return;
              }

              // Poll useUserStore for Clerk auth readiness. PHO-259: cap at 2s —
              // silentRefresh typically resolves <1s, so a generous 2s wins back
              // the unrecoverable user-facing latency the previous 5s wait was
              // burning on every 401. Past 2s the recovery is treated as failed
              // and shouldForceReauth() escalates on the next failure. The
              // `settled` guard stops the recursive poll from running as a
              // zombie timer after the safety cap fires.
              await new Promise<void>((resolve) => {
                let settled = false;
                const finish = () => {
                  if (settled) return;
                  settled = true;
                  resolve();
                };
                const check = () => {
                  if (settled) return;
                  if (useUserStore.getState().isLoaded) return finish();
                  setTimeout(check, 100);
                };
                check();
                setTimeout(finish, 2000);
              });

              // Singleflight refresh shared with lambda + edge clients.
              const refreshed = await silentRefresh();
              const updated = useUserStore.getState();

              if (refreshed && updated.isSignedIn) {
                attempt();
                return;
              }

              if (shouldForceReauth()) {
                forceReauth();
              }
            } else if (
              status === 401 &&
              retried && // PHO-252: second 401 after a successful client-side refresh.
              // Server still rejects the fresh JWT — count it so
              // shouldForceReauth() can escalate.
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

export const toolsClient = createTRPCClient<ToolsRouter>({
  links: [
    retryOnUnauthorizedLink,
    httpBatchLink({
      fetch: isDesktop
        ? // eslint-disable-next-line no-undef
          (input, init) => fetchWithDesktopRemoteRPC(input as string, init as RequestInit)
        : undefined,
      headers: async () => {
        // dynamic import to avoid circular dependency
        const { createHeaderWithAuth } = await import('@/services/_auth');

        return createHeaderWithAuth();
      },
      maxURLLength: 2083,
      transformer: superjson,
      url: '/trpc/tools',
    }),
  ],
});
