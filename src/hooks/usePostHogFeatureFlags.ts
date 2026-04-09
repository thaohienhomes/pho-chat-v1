'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * All llm-provider-* flags we check.
 */
const LLM_PROVIDER_FLAGS = [
  'llm-provider-vercelaigateway',
  'llm-provider-anthropic',
  'llm-provider-openai',
  'llm-provider-google',
  'llm-provider-deepseek',
  'llm-provider-xai',
  'llm-provider-meta-llama',
  'llm-provider-groq',
  'llm-provider-cerebras',
  'llm-provider-fireworksai',
  'llm-provider-togetherai',
  'llm-provider-perplexity',
];

/** Safety: if >60% flags are false, treat as misconfiguration and enable all */
const MISCONFIGURATION_THRESHOLD = 0.6;

/**
 * Hook to access PostHog feature flags on the CLIENT side.
 *
 * Uses `window.posthog` (exposed by LobeAnalyticsProvider) with the
 * official `onFeatureFlags()` callback and `isFeatureEnabled()` API.
 *
 * FAIL-OPEN: If PostHog is not loaded or flags haven't been fetched yet,
 * `isFeatureEnabled` returns TRUE so all providers remain visible.
 *
 * The LobeAnalyticsProvider already calls `setPersonPropertiesForFlags({ environment })`
 * so property-based flag conditions (e.g., "environment = preview") work correctly
 * for the current user.
 */
export const usePostHogFeatureFlags = () => {
  const [flagState, setFlagState] = useState<{
    flags: Record<string, boolean>;
    ready: boolean;
  }>({ flags: {}, ready: false });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const readFlags = (ph: any) => {
      const flags: Record<string, boolean> = {};
      let falseCount = 0;
      let definedCount = 0;

      for (const key of LLM_PROVIDER_FLAGS) {
        // isFeatureEnabled returns true/false/undefined
        // undefined means flag not defined → treat as true (fail-open)
        const value = ph.isFeatureEnabled(key);
        flags[key] = value === undefined ? true : !!value;
        if (value !== undefined) {
          definedCount++;
          if (!value) falseCount++;
        }
      }

      // Safety: if >60% defined flags are false, likely misconfiguration — enable all
      if (definedCount > 0 && falseCount / definedCount > MISCONFIGURATION_THRESHOLD) {
        console.warn(
          '[FeatureFlags] Safety fallback triggered: %d/%d flags are false — enabling all providers',
          falseCount,
          definedCount,
        );
        for (const key of LLM_PROVIDER_FLAGS) {
          flags[key] = true;
        }
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[FeatureFlags]', { definedCount, falseCount, flags });
      }

      setFlagState({ flags, ready: true });
    };

    const setupFlags = (ph: any) => {
      // onFeatureFlags fires when flags are loaded (or immediately if already loaded)
      ph.onFeatureFlags(() => {
        readFlags(ph);
      });

      // Also check if flags are already available right now
      // (onFeatureFlags might not fire if flags were loaded before this hook mounts)
      try {
        const existingFlags = ph.featureFlags?.getFlags?.();
        if (existingFlags && existingFlags.length > 0) {
          readFlags(ph);
        }
      } catch {
        // getFlags might not exist in all PostHog versions
      }
    };

    const ph = (window as any).posthog;
    if (ph) {
      setupFlags(ph);
    } else {
      // PostHog not yet initialized — poll until ready
      const timer = setInterval(() => {
        const ph2 = (window as any).posthog;
        if (ph2) {
          clearInterval(timer);
          setupFlags(ph2);
        }
      }, 500);

      // Stop polling after 10 seconds
      const timeout = setTimeout(() => clearInterval(timer), 10_000);
      return () => {
        clearInterval(timer);
        clearTimeout(timeout);
      };
    }
  }, []);

  const isFeatureEnabled = useCallback(
    (flagKey: string): boolean => {
      if (!flagState.ready) return true; // fail-open: show all while loading
      if (!(flagKey in flagState.flags)) return true; // flag not defined → show
      return flagState.flags[flagKey];
    },
    [flagState],
  );

  return { isFeatureEnabled, ready: flagState.ready };
};
