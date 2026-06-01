'use client';

import {
  GoogleAnalyticsProviderConfig,
  PostHogProviderAnalyticsConfig,
  createSingletonAnalytics,
} from '@lobehub/analytics';
import { AnalyticsProvider } from '@lobehub/analytics/react';
import { ReactNode, memo, useEffect, useState } from 'react';

import { BUSINESS_LINE } from '@/const/analytics';
import { isDesktop } from '@/const/version';
import { isDev } from '@/utils/env';

import { installConsoleErrorForwarding } from './consoleErrorForwarding';

type Props = {
  children: ReactNode;
  ga4Config: GoogleAnalyticsProviderConfig;
  postHogConfig: PostHogProviderAnalyticsConfig;
};

let analyticsInstance: ReturnType<typeof createSingletonAnalytics> | null = null;

export const LobeAnalyticsProvider = memo(
  ({ children, ga4Config, postHogConfig }: Props) => {
    // Defer analytics initialization until after first paint
    // This prevents PostHog (~150KB) and GA4 from blocking FCP/LCP
    const [analytics, setAnalytics] = useState<typeof analyticsInstance>(analyticsInstance);

    useEffect(() => {
      if (analyticsInstance) {
        setAnalytics(analyticsInstance);
        return;
      }

      // Use requestIdleCallback to initialize after browser is idle
      const init = () => {
        analyticsInstance = createSingletonAnalytics({
          business: BUSINESS_LINE,
          debug: isDev,
          providers: {
            ga4: ga4Config,
            posthog: postHogConfig,
          },
        });
        setAnalytics(analyticsInstance);
      };

      if (typeof requestIdleCallback !== 'undefined') {
        const id = requestIdleCallback(init, { timeout: 3000 });
        return () => cancelIdleCallback(id);
      } else {
        // Fallback for Safari — defer to next frame
        const timer = setTimeout(init, 100);
        return () => clearTimeout(timer);
      }
    }, []);

    if (!analytics) return children;

    return (
      <AnalyticsProvider
        client={analytics}
        onInitializeSuccess={() => {
          // Determine environment from Vercel or fallback
          const environment =
            process.env.NEXT_PUBLIC_VERCEL_ENV || // 'production', 'preview', 'development'
            (isDev ? 'development' : 'production');

          analyticsInstance?.setGlobalContext({
            environment,
            platform: isDesktop ? 'desktop' : 'web',
          });

          const posthog = analyticsInstance?.getProvider('posthog')?.getNativeInstance();

          if (posthog) {
            // Expose PostHog to window for debugging and external access
            if (typeof window !== 'undefined') {
              (window as any).posthog = posthog;
            }

            // Filter benign exceptions from PostHog error tracking
            // These are noise that pollute error dashboards without actionable value
            const benignPatterns = [
              'ResizeObserver loop', // Browser layout recalc noise
              'signal is aborted', // User navigated away during fetch
              'zaloJSV2', // Zalo in-app browser injection
              'zalo_h5_event_handler', // Zalo WebView event handler
              'Cannot prefetch', // Next.js external URL prefetch
              'Attempted to assign to readonly property', // Safari strict mode quirk
            ];
            const origCapture = posthog.capture.bind(posthog);
            posthog.capture = (eventName: string, properties?: any, options?: any) => {
              if (eventName === '$exception') {
                const exList = properties?.$exception_list;
                if (Array.isArray(exList) && exList.length > 0) {
                  const msg = (exList[0]?.value || '') + ' ' + (exList[0]?.type || '');
                  if (benignPatterns.some((p) => msg.includes(p))) {
                    return; // Suppress — do not send to PostHog
                  }
                }
              }
              return origCapture(eventName, properties, options);
            };

            // TASK 0: forward handled `console.error` calls to PostHog error
            // tracking. `capture_exceptions` only autocaptures UNCAUGHT errors
            // (window.onerror) + unhandled rejections; handled errors logged via
            // console.error never became `$exception`. Routed through the wrapped
            // `posthog.capture` above, so the benign-pattern filter applies and no
            // double-capture occurs (we intentionally do NOT hook window.onerror).
            installConsoleErrorForwarding(posthog);

            // Ensure properties are available for instant Feature Flag evaluation
            posthog.setPersonPropertiesForFlags({
              environment,
              platform: isDesktop ? 'desktop' : 'web',
            });

            // Register as super property (event property)
            const isZaloBrowser =
              typeof navigator !== 'undefined' && /zalo/i.test(navigator.userAgent);

            posthog.register({
              ...(isZaloBrowser && { browser_app: 'zalo' }),
              environment,
              platform: isDesktop ? 'desktop' : 'web',
            });

            // Set as Person Property for backend persistence and long-term targeting
            posthog.people.set({
              environment,
            });

            // Reload flags to ensure new context is used
            posthog.reloadFeatureFlags();
          }
        }}
      >
        {children}
      </AnalyticsProvider>
    );
  },
  () => true,
);
