// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAnalyticsConfig } from '../analytics';

beforeEach(() => {
  // 在每个测试用例之前,清除所有的 console.warn mock
  console.warn = vi.fn();
});

afterEach(() => {
  // 在每个测试用例之后,恢复所有的环境变量
  vi.resetModules();
});

describe('getAnalyticsConfig', () => {
  it('should return the correct analytics config', () => {
    // 设置环境变量
    process.env.PLAUSIBLE_DOMAIN = 'example.com';
    process.env.POSTHOG_KEY = 'posthog_key';
    process.env.UMAMI_WEBSITE_ID = 'umami_id';
    process.env.CLARITY_PROJECT_ID = 'clarity_id';
    process.env.ENABLE_VERCEL_ANALYTICS = '1';
    process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID = 'ga_id';
    process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID = 'tiktok_pixel_id';

    const config = getAnalyticsConfig();

    expect(config).toEqual({
      CLARITY_PROJECT_ID: 'clarity_id',
      DEBUG_POSTHOG_ANALYTICS: false,
      DEBUG_VERCEL_ANALYTICS: false,
      ENABLED_CLARITY_ANALYTICS: true,
      ENABLED_PLAUSIBLE_ANALYTICS: true,
      ENABLED_TIKTOK_PIXEL: true,
      ENABLED_UMAMI_ANALYTICS: true,
      ENABLE_GOOGLE_ANALYTICS: true,
      ENABLE_VERCEL_ANALYTICS: true,
      GOOGLE_ANALYTICS_MEASUREMENT_ID: 'ga_id',
      NEXT_PUBLIC_POSTHOG_ENABLED: false,
      NEXT_PUBLIC_POSTHOG_HOST: 'https://app.posthog.com',
      NEXT_PUBLIC_POSTHOG_KEY: undefined,
      PLAUSIBLE_DOMAIN: 'example.com',
      PLAUSIBLE_SCRIPT_BASE_URL: 'https://plausible.io',
      REACT_SCAN_MONITOR_API_KEY: undefined,
      TIKTOK_ACCESS_TOKEN: undefined,
      TIKTOK_PIXEL_ID: 'tiktok_pixel_id',
      TIKTOK_TEST_EVENT_CODE: undefined,
      UMAMI_SCRIPT_URL: 'https://analytics.umami.is/script.js',
      UMAMI_WEBSITE_ID: 'umami_id',
    });
  });
});
