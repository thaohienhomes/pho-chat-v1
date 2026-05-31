/**
 * Minimal shape of the PostHog client methods this module relies on.
 */
interface PostHogLike {
  captureException?: (error: Error, additionalProperties?: Record<string, unknown>) => void;
}

const HOOK_FLAG = '__phoConsoleErrorForwardingInstalled';

/**
 * Build an Error from `console.error(...)` arguments.
 *
 * Prefers a real Error instance among the args (preserving its stack); otherwise
 * synthesizes one from the formatted message. Returns null when there is nothing
 * meaningful to report (e.g. `console.error()` with no/empty args).
 */
const toError = (args: unknown[]): Error | null => {
  const existing = args.find((a): a is Error => a instanceof Error);
  if (existing) return existing;

  const message = args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ')
    .trim()
    .slice(0, 1000);

  return message ? new Error(message) : null;
};

/**
 * Forward `console.error(...)` calls to PostHog error tracking as `$exception`.
 *
 * Why: PostHog's `capture_exceptions` (Exception Autocapture) only covers
 * UNCAUGHT errors (`window.onerror`) and unhandled promise rejections. Errors the
 * app *handles* and logs via `console.error` (caught exceptions, failed fetches,
 * React render errors) never reach the error dashboard. A single session replay
 * showed 16 such console errors while only ~2 `$exception` events landed in a week.
 * This closes that visibility gap.
 *
 * Double-capture is avoided by design:
 *  - We do NOT hook `window.onerror` / `window.onunhandledrejection` — autocapture
 *    already owns those channels, so we only forward the disjoint `console.error`
 *    channel.
 *  - Benign-pattern filtering is applied centrally on the wrapped `posthog.capture`
 *    (see LobeAnalyticsProvider), and `captureException` routes through it, so
 *    `$exception` noise is suppressed there too.
 *  - A re-entrancy guard prevents loops if capture internally logs via console.error.
 *  - Idempotent: installs at most once per page (guarded on `window`).
 */
export const installConsoleErrorForwarding = (posthog: PostHogLike): void => {
  if (typeof window === 'undefined') return;
  if (typeof posthog?.captureException !== 'function') return;
  if ((window as unknown as Record<string, unknown>)[HOOK_FLAG]) return;
  (window as unknown as Record<string, unknown>)[HOOK_FLAG] = true;

  const originalConsoleError = console.error.bind(console);
  let forwarding = false;

  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
    // Always preserve native logging first.
    originalConsoleError(...args);

    if (forwarding) return; // guard against recursion (capture → console.error → ...)
    try {
      forwarding = true;
      const error = toError(args);
      if (error) {
        posthog.captureException!(error, { mechanism: 'console.error' });
      }
    } catch {
      // Error tracking must never break the host app.
    } finally {
      forwarding = false;
    }
  };
};

/**
 * Test-only: reset the install guard and restore the original console.error.
 * Exposed so unit tests can re-exercise installation in isolation.
 */
export const __resetConsoleErrorForwardingForTests = (
  originalConsoleError: typeof console.error,
) => {
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[HOOK_FLAG] = false;
  }
  console.error = originalConsoleError;
};
