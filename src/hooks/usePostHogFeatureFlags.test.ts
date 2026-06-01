import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePostHogFeatureFlags } from './usePostHogFeatureFlags';

type Variants = Record<string, boolean | string>;

/**
 * Build a fake PostHog client. By default the `onFeatureFlags` callback fires
 * immediately with the given variants (mirroring "flags already loaded").
 */
const makePosthog = (variants: Variants, { fireCallback = true, cached = {} as Variants } = {}) => {
  const isFeatureEnabled = vi.fn();
  const getFeatureFlag = vi.fn();
  const onFeatureFlags = vi.fn((cb: (flags: string[], variants: Variants) => void) => {
    if (fireCallback) {
      const enabled = Object.keys(variants).filter((k) => !!variants[k]);
      cb(enabled, variants);
    }
    return () => {};
  });
  const getFlagVariants = vi.fn(() => cached);

  return {
    getFeatureFlag,
    isFeatureEnabled,
    onFeatureFlags,
    ph: {
      featureFlags: { getFlagVariants },
      getFeatureFlag,
      isFeatureEnabled,
      onFeatureFlags,
    },
  };
};

describe('usePostHogFeatureFlags', () => {
  beforeEach(() => {
    delete (window as any).posthog;
  });

  afterEach(() => {
    delete (window as any).posthog;
    vi.restoreAllMocks();
  });

  it('resolves provider flags from the onFeatureFlags variants map', async () => {
    const { ph } = makePosthog({
      'llm-provider-anthropic': true,
      'llm-provider-openai': false,
    });
    (window as any).posthog = ph;

    const { result } = renderHook(() => usePostHogFeatureFlags());

    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.isFeatureEnabled('llm-provider-anthropic')).toBe(true);
    expect(result.current.isFeatureEnabled('llm-provider-openai')).toBe(false);
    // Undefined flag => fail-open (visible).
    expect(result.current.isFeatureEnabled('llm-provider-google')).toBe(true);
  });

  it('does NOT emit per-flag exposure events (PCFIX-1 — no burst)', async () => {
    const { ph, isFeatureEnabled, getFeatureFlag, onFeatureFlags } = makePosthog({
      'llm-provider-anthropic': true,
      'llm-provider-openai': true,
    });
    (window as any).posthog = ph;

    const { result } = renderHook(() => usePostHogFeatureFlags());
    await waitFor(() => expect(result.current.ready).toBe(true));

    // The whole point: flags are read in ONE consolidated pass via onFeatureFlags,
    // never via the per-flag APIs that fire `$feature_flag_called`.
    expect(isFeatureEnabled).not.toHaveBeenCalled();
    expect(getFeatureFlag).not.toHaveBeenCalled();
    expect(onFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it('enables all providers when >60% of defined flags are false (safety)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 3 defined, 3 false => 100% false > 60% => enable all.
    const { ph } = makePosthog({
      'llm-provider-anthropic': false,
      'llm-provider-google': false,
      'llm-provider-openai': false,
    });
    (window as any).posthog = ph;

    const { result } = renderHook(() => usePostHogFeatureFlags());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.isFeatureEnabled('llm-provider-anthropic')).toBe(true);
    expect(result.current.isFeatureEnabled('llm-provider-openai')).toBe(true);
    expect(result.current.isFeatureEnabled('llm-provider-google')).toBe(true);
  });

  it('falls back to getFlagVariants cache when the callback has not fired yet', async () => {
    const { ph, onFeatureFlags } = makePosthog(
      {},
      {
        // 1/3 false (under the 60% safety threshold) so openai stays disabled.
        cached: {
          'llm-provider-anthropic': true,
          'llm-provider-google': true,
          'llm-provider-openai': false,
        },
        fireCallback: false,
      },
    );
    (window as any).posthog = ph;

    const { result } = renderHook(() => usePostHogFeatureFlags());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(onFeatureFlags).toHaveBeenCalledTimes(1);
    expect(result.current.isFeatureEnabled('llm-provider-openai')).toBe(false);
    expect(result.current.isFeatureEnabled('llm-provider-anthropic')).toBe(true);
  });

  it('fails open (everything enabled) while PostHog is not available', () => {
    // No window.posthog set.
    const { result } = renderHook(() => usePostHogFeatureFlags());

    expect(result.current.ready).toBe(false);
    expect(result.current.isFeatureEnabled('llm-provider-anthropic')).toBe(true);
    expect(result.current.isFeatureEnabled('anything-else')).toBe(true);
  });
});
