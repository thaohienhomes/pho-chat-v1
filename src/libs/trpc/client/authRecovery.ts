// Shared auth recovery helpers for the lambda + edge tRPC clients.
//
// Why this exists: PHO-187 added per-request silent token refresh inside the
// tRPC retry links. In production that fires 8+ parallel refreshes when a
// burst of queries all 401 at once (inbox load = many parallel calls), and if
// the session is actually dead server-side the retry never recovers — leaving
// the user on a silently broken page. This module singleflights the refresh,
// throttles the PostHog event, and escalates to a hard re-auth once the loop
// is clearly stuck.

let refreshInflight: Promise<boolean> | null = null;
let recentFailures: number[] = [];
let lastCaptureAt = 0;
let reauthScheduled = false;

const FAILURE_WINDOW_MS = 30_000;
const FAILURE_THRESHOLD = 2;
const CAPTURE_THROTTLE_MS = 30_000;
const REAUTH_TOAST_DELAY_MS = 1500;

/**
 * Singleflight Clerk session refresh. Parallel 401s coalesce onto one refresh.
 * Resolves true iff a fresh token was obtained.
 */
export const silentRefresh = (): Promise<boolean> => {
  if (refreshInflight) return refreshInflight;

  const promise = (async () => {
    if (typeof window === 'undefined') return false;
    const clerk = (window as any).Clerk;
    if (!clerk?.session) return false;

    // reload() forces Clerk to re-fetch session state from the server, so a
    // session that was invalidated server-side flips to null here instead of
    // silently returning another doomed JWT.
    try {
      await clerk.session.reload();
    } catch {
      // fall through — getToken below will surface the real failure
    }

    if (!clerk.session) return false;

    try {
      const token = await clerk.session.getToken({ skipCache: true });
      return !!token;
    } catch {
      return false;
    }
  })();

  refreshInflight = promise;
  promise.finally(() => {
    // Hold the promise slot briefly so a burst of parallel 401s lands on the
    // same refresh instead of kicking off a new one.
    setTimeout(() => {
      if (refreshInflight === promise) refreshInflight = null;
    }, 250);
  });
  return promise;
};

/**
 * Record an auth recovery failure. Returns true once the failure count in the
 * rolling window crosses the threshold — caller should then escalate.
 */
export const shouldForceReauth = (): boolean => {
  const now = Date.now();
  recentFailures = recentFailures.filter((t) => now - t < FAILURE_WINDOW_MS);
  recentFailures.push(now);
  return recentFailures.length >= FAILURE_THRESHOLD;
};

/** Call after a known-good response so a later stray 401 doesn't tip us over. */
export const resetAuthFailures = () => {
  recentFailures = [];
};

/** Throttled PostHog capture of auth_session_expired (1 per window). */
export const captureAuthExpired = () => {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - lastCaptureAt < CAPTURE_THROTTLE_MS) return;
  lastCaptureAt = now;
  try {
    (window as any).posthog?.capture?.('auth_session_expired', {
      pathname: window.location.pathname,
      url: window.location.href,
    });
  } catch {
    // posthog unavailable — ignore
  }
};

/**
 * Escalate to a full re-auth: toast the user, sign out of Clerk, redirect to
 * /login. Idempotent per page load — subsequent calls are no-ops.
 */
export const forceReauth = () => {
  if (typeof window === 'undefined') return;
  if (reauthScheduled) return;
  reauthScheduled = true;

  const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
  const loginUrl = `/login?reason=session_expired&callbackUrl=${returnTo}`;

  // Non-blocking toast so the redirect isn't abrupt.
  void (async () => {
    try {
      const { notification } = await import('@/components/AntdStaticMethods');
      notification.warning({
        description:
          'Để tiếp tục, vui lòng đăng nhập lại. Hệ thống sẽ tự động chuyển hướng trong giây lát.',
        duration: 3,
        message: 'Phiên đăng nhập đã hết hạn',
      });
    } catch {
      // notification unavailable — fall through to redirect
    }
  })();

  setTimeout(() => {
    const clerk = (window as any).Clerk;
    const hardRedirect = () => {
      window.location.href = loginUrl;
    };
    try {
      if (clerk?.signOut) {
        // signOut triggers its own navigation; fall back to hard redirect if it
        // rejects (e.g. already signed out).
        Promise.resolve(clerk.signOut({ redirectUrl: loginUrl })).catch(hardRedirect);
        return;
      }
    } catch {
      // ignore
    }
    hardRedirect();
  }, REAUTH_TOAST_DELAY_MS);
};
