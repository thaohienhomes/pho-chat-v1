import { ReactNode, memo } from 'react';

import { LobeAnalyticsProvider } from '@/components/Analytics/LobeAnalyticsProvider';
import { analyticsEnv } from '@/envs/analytics';
import { isDev } from '@/utils/env';

type Props = {
  children?: ReactNode;
};

export const LobeAnalyticsProviderWrapper = memo<Props>(({ children }) => {
  return (
    <LobeAnalyticsProvider
      ga4Config={{
        debug: isDev,
        enabled: analyticsEnv.ENABLE_GOOGLE_ANALYTICS,
        gtagConfig: {
          debug_mode: isDev,
        },
        measurementId: analyticsEnv.GOOGLE_ANALYTICS_MEASUREMENT_ID ?? '',
      }}
      postHogConfig={{
        // PHO-232: enable browser exception autocapture so $exception events
        // ship with non-null payloads. Read these via `properties.$exception_list`
        // (array) — the legacy flat fields ($exception_type/_message/_stack)
        // were removed in PostHog JS ≥ 1.95.
        capture_exceptions: true,
        capture_performance: { web_vitals: true },
        debug: analyticsEnv.DEBUG_POSTHOG_ANALYTICS,
        enabled: analyticsEnv.NEXT_PUBLIC_POSTHOG_ENABLED,
        // Use local proxy to bypass ad blockers
        host: '/ingest',
        key: analyticsEnv.NEXT_PUBLIC_POSTHOG_KEY ?? '',
        person_profiles: 'always',
      }}
    >
      {children}
    </LobeAnalyticsProvider>
  );
});

LobeAnalyticsProviderWrapper.displayName = 'LobeAnalyticsProviderWrapper';
