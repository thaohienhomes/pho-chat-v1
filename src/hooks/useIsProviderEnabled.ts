'use client';

import { useFeatureFlagEnabled } from 'posthog-js/react';

import { getProviderFlag, getProviderGroupFlag } from '@/config/featureFlagConfig';

/**
 * Hook to check if a provider should be visible based on feature flags.
 *
 * Logic:
 * 1. Check individual provider flag (llm-provider-{id})
 * 2. If no individual flag, check group flag (llm-group-{group})
 * 3. If no flags defined, provider is visible by default
 *
 * @param providerId - The provider identifier (e.g., 'groq', 'openai')
 * @returns true if the provider should be visible
 */
export const useIsProviderEnabled = (providerId: string): boolean => {
  const providerFlag = getProviderFlag(providerId);
  const groupFlag = getProviderGroupFlag(providerId);

  // TODO(PCFIX-1): useFeatureFlagEnabled emits a `$feature_flag_called` event per
  // call. Left as-is on purpose — this hook is not on the per-load chat path that
  // PCFIX-1 de-bursted (usePostHogFeatureFlags now reads the consolidated variants
  // map). If this hook starts rendering on a hot path, switch to that pattern.
  // Check individual provider flag
  const providerEnabled = useFeatureFlagEnabled(providerFlag || '__no_flag__');
  // Check group flag
  const groupEnabled = useFeatureFlagEnabled(groupFlag || '__no_flag__');

  // If no flags are configured, show by default
  if (!providerFlag && !groupFlag) {
    return true;
  }

  // Individual flag takes precedence
  if (providerFlag) {
    // If flag exists but returns undefined (not loaded), default to true
    return providerEnabled !== false;
  }

  // Fall back to group flag
  if (groupFlag) {
    return groupEnabled !== false;
  }

  return true;
};
