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

/** Map of flagKey -> resolved value, as delivered by PostHog. */
type FlagVariants = Record<string, boolean | string>;

/**
 * Hook to access PostHog feature flags on the CLIENT side.
 *
 * PCFIX-1: flags are read in a SINGLE consolidated pass from the variants map
 * delivered by `onFeatureFlags(cb)` (with `posthog.featureFlags.getFlagVariants()`
 * as the already-loaded fallback). We deliberately avoid calling
 * `isFeatureEnabled()` / `getFeatureFlag()` per flag, because each such call emits
 * a `$feature_flag_called` event — previously ~12 events per page load (one per
 * provider flag), a synchronous burst that contributed to INP/CLS. Reading from
 * the variants map fires ZERO per-flag events while preserving identical values.
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

    const readFlags = (variants: FlagVariants | undefined) => {
      const flags: Record<string, boolean> = {};
      let falseCount = 0;
      let definedCount = 0;

      for (const key of LLM_PROVIDER_FLAGS) {
        // `variants` holds the resolved value for every evaluated flag.
        // undefined => flag not defined in project => treat as true (fail-open).
        const value = variants?.[key];
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
      // Single consolidated read: onFeatureFlags delivers the full variants map at
      // once (and fires immediately if flags are already loaded). No per-flag
      // isFeatureEnabled() calls => no `$feature_flag_called` burst (PCFIX-1).
      ph.onFeatureFlags((_enabledKeys: string[], variants: FlagVariants) => {
        readFlags(variants);
      });

      // Belt-and-suspenders: if flags were already cached before the listener was
      // attached, read them straight from the local cache (no network, no events).
      try {
        const cached: FlagVariants | undefined = ph.featureFlags?.getFlagVariants?.();
        if (cached && Object.keys(cached).length > 0) {
          readFlags(cached);
        }
      } catch {
        // getFlagVariants might not exist in all PostHog versions — onFeatureFlags covers it.
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
