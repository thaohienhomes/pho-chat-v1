import { useCallback, useEffect, useMemo, useRef } from 'react';
import useSWR from 'swr';

import { getModelTier } from '@/config/pricing';
import { silentRefresh } from '@/libs/trpc/client/authRecovery';

interface AllowedModelsData {
  allowedModels: string[];
  allowedTiers: number[];
  /** True when the server fell back to vn_free because a signed-in session failed verification. */
  authError?: boolean;
  dailyLimits?: Record<string, number>;
  defaultModel: string;
  defaultProvider: string;
  planCode: string;
}

interface UsageStatsData {
  dailyTier2Count: number;
  dailyTier2Limit: number;
  dailyTier3Count: number;
  dailyTier3Limit: number;
}

const fetchModelAccess = async (): Promise<AllowedModelsData | null> => {
  const response = await fetch('/api/subscription/models/allowed');
  if (!response.ok) return null;
  const data = await response.json();
  if (data.success && data.data) return data.data;
  return null;
};

const fetchUsageStats = async (): Promise<UsageStatsData | null> => {
  try {
    const response = await fetch('/api/subscription/usage-stats');
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
};

/**
 * Shared hook for model access checks.
 * Uses SWR to deduplicate and cache the /api/subscription/models/allowed call
 * across all components that mount simultaneously.
 *
 * Also fetches daily usage stats to enforce daily quota limits client-side.
 */
export const useModelAccess = () => {
  const { data, isLoading, mutate } = useSWR('model-access-allowed', fetchModelAccess, {
    dedupingInterval: 300_000, // 5 minutes — don't refetch within this window
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const { data: usageStats } = useSWR('model-access-usage-stats', fetchUsageStats, {
    dedupingInterval: 60_000, // 1 minute — usage changes more frequently
    revalidateOnFocus: true,
    revalidateOnReconnect: false,
  });

  // The endpoint flags `authError` when a signed-in client's session failed
  // server verification and it fell back to vn_free — which would grey out
  // PRO/FLAGSHIP for a paid user as if they lost their plan. Attempt a one-shot
  // silent token refresh and revalidate so a recoverable session self-heals and
  // the models un-grey, instead of showing a misleading "not authorized" state.
  // Hard failures (kid/instance mismatch) are escalated to re-auth by the tRPC
  // layer; we deliberately don't redirect from here.
  const recoveryAttempted = useRef(false);
  useEffect(() => {
    if (!data?.authError || recoveryAttempted.current) return;
    recoveryAttempted.current = true;
    void silentRefresh().then((refreshed) => {
      if (refreshed) void mutate();
    });
  }, [data?.authError, mutate]);

  const allowedTiers = data?.allowedTiers ?? [1];
  const isGuest = !data;

  const canUseModel = useCallback(
    (modelId: string) => {
      if (modelId.toLowerCase().includes('auto')) {
        return allowedTiers.includes(2);
      }
      const tier = getModelTier(modelId);
      if (!allowedTiers.includes(tier)) return false;

      // Check daily quota for Tier 2/3
      if (usageStats && tier === 2 && usageStats.dailyTier2Limit > 0 && usageStats.dailyTier2Count >= usageStats.dailyTier2Limit) return false;
      if (usageStats && tier === 3 && usageStats.dailyTier3Limit > 0 && usageStats.dailyTier3Count >= usageStats.dailyTier3Limit) return false;

      return true;
    },
    [allowedTiers, usageStats],
  );

  // Check tier access including daily quota
  const canUseTier = useCallback(
    (modelId: string) => {
      const tier = modelId.toLowerCase().includes('auto') ? 0 : getModelTier(modelId);
      if (tier === 0) return true;
      if (!allowedTiers.includes(tier)) return false;

      // Check daily quota for Tier 2/3
      if (usageStats && tier === 2 && usageStats.dailyTier2Limit > 0 && usageStats.dailyTier2Count >= usageStats.dailyTier2Limit) return false;
      if (usageStats && tier === 3 && usageStats.dailyTier3Limit > 0 && usageStats.dailyTier3Count >= usageStats.dailyTier3Limit) return false;

      return true;
    },
    [allowedTiers, usageStats],
  );

  const needsUpgrade = useMemo(() => {
    return isGuest || (allowedTiers.length === 1 && allowedTiers[0] === 1);
  }, [allowedTiers, isGuest]);

  return {
    allowedTiers,
    // Surface broken-session state so UIs can prompt re-login instead of
    // rendering greyed models as if it were a plan/upgrade limit.
    authError: data?.authError ?? false,
    canUseModel,
    canUseTier,
    isGuest,
    loading: isLoading,
    needsUpgrade,
    usageStats,
  };
};
