import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { analyticsEnv } from '@/envs/analytics';

import {
  identifyTikTokUser,
  isTikTokPixelEnabled,
  trackAddPaymentInfo,
  trackClickButton,
  trackCompleteRegistration,
  trackSearch,
  trackSubscribe,
  trackTikTokEvent,
  trackViewContent,
} from '../tiktok-events';

// Mock analytics environment
vi.mock('@/envs/analytics', () => ({
  analyticsEnv: {
    TIKTOK_PIXEL_ID: 'test-pixel-id',
  },
}));

// Mock window.ttq
const mockTtq = {
  identify: vi.fn(),
  page: vi.fn(),
  track: vi.fn(),
};

describe('TikTok Events Utils', () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Reset analytics env
    vi.mocked(analyticsEnv).TIKTOK_PIXEL_ID = 'test-pixel-id';

    // Mock window object
    Object.defineProperty(window, 'ttq', {
      value: mockTtq,
      writable: true,
    });

    // Mock console methods
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isTikTokPixelEnabled', () => {
    it('should return true when pixel ID exists and ttq is available', () => {
      expect(isTikTokPixelEnabled()).toBe(true);
    });

    it('should return false when ttq is not available', () => {
      Object.defineProperty(window, 'ttq', {
        value: undefined,
        writable: true,
      });
      expect(isTikTokPixelEnabled()).toBe(false);
    });
  });

  describe('trackTikTokEvent', () => {
    it('should track event when pixel is enabled', () => {
      const eventParams = { currency: 'VND', value: 100 };

      trackTikTokEvent('Subscribe', eventParams);

      expect(mockTtq.track).toHaveBeenCalledWith('Subscribe', eventParams);
      expect(console.debug).toHaveBeenCalledWith('Tracking TikTok event: Subscribe', eventParams);
    });

    it('should not track event when pixel is disabled', () => {
      // Pixel enablement is driven by window.ttq presence, not the env var.
      Object.defineProperty(window, 'ttq', { value: undefined, writable: true });

      trackTikTokEvent('Subscribe');

      expect(mockTtq.track).not.toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith(
        'TikTok Pixel not enabled or loaded, skipping event: Subscribe',
      );
    });

    it('should handle tracking errors gracefully', () => {
      mockTtq.track.mockImplementation(() => {
        throw new Error('Tracking failed');
      });

      trackTikTokEvent('Subscribe');

      expect(console.error).toHaveBeenCalledWith(
        'Failed to track TikTok event:',
        expect.any(Error),
      );
    });
  });

  describe('identifyTikTokUser', () => {
    it('should identify user when pixel is enabled', () => {
      const userParams = { email: 'hashed-email', external_id: 'hashed-id' };

      identifyTikTokUser(userParams);

      expect(mockTtq.identify).toHaveBeenCalledWith(userParams);
    });

    it('should not identify user when pixel is disabled', () => {
      // Pixel enablement is driven by window.ttq presence, not the env var.
      Object.defineProperty(window, 'ttq', { value: undefined, writable: true });

      identifyTikTokUser({ email: 'test' });

      expect(mockTtq.identify).not.toHaveBeenCalled();
    });
  });

  describe('trackCompleteRegistration', () => {
    it('should track registration without plan info', () => {
      trackCompleteRegistration();

      expect(mockTtq.track).toHaveBeenCalledWith('CompleteRegistration', {
        currency: 'VND',
      });
    });

    it('should track registration with plan info', () => {
      trackCompleteRegistration('premium', 'Premium Plan');

      expect(mockTtq.track).toHaveBeenCalledWith('CompleteRegistration', {
        contents: [
          {
            content_id: 'premium',
            content_name: 'Premium Plan',
            content_type: 'product',
          },
        ],
        currency: 'VND',
      });
    });
  });

  describe('trackSubscribe', () => {
    it('should track subscription with correct parameters', () => {
      trackSubscribe('premium', 'Premium Plan', 129_000, 'monthly');

      expect(mockTtq.track).toHaveBeenCalledWith('Subscribe', {
        contents: [
          {
            content_id: 'premium',
            content_name: 'Premium Plan (monthly)',
            content_type: 'product',
            price: 129_000,
          },
        ],
        currency: 'VND',
        value: 129_000,
      });
    });
  });

  describe('trackViewContent', () => {
    it('should track content view with value', () => {
      trackViewContent('premium', 'Premium Plan', 129_000);

      expect(mockTtq.track).toHaveBeenCalledWith('ViewContent', {
        contents: [
          {
            content_id: 'premium',
            content_name: 'Premium Plan',
            content_type: 'product',
            price: 129_000,
          },
        ],
        currency: 'VND',
        value: 129_000,
      });
    });

    it('should track content view without value', () => {
      trackViewContent('premium', 'Premium Plan');

      expect(mockTtq.track).toHaveBeenCalledWith('ViewContent', {
        contents: [
          {
            content_id: 'premium',
            content_name: 'Premium Plan',
            content_type: 'product',
            price: undefined,
          },
        ],
        currency: 'VND',
        value: undefined,
      });
    });
  });

  describe('trackClickButton', () => {
    it('should track button click with description', () => {
      trackClickButton('Upgrade Now', 'From pricing page');

      expect(mockTtq.track).toHaveBeenCalledWith('ClickButton', {
        button_text: 'Upgrade Now',
        description: 'From pricing page',
      });
    });

    it('should track button click without description', () => {
      trackClickButton('Upgrade Now');

      expect(mockTtq.track).toHaveBeenCalledWith('ClickButton', {
        button_text: 'Upgrade Now',
        description: undefined,
      });
    });
  });

  describe('trackAddPaymentInfo', () => {
    it('should track payment info with plan details', () => {
      trackAddPaymentInfo('premium', 'Premium Plan');

      expect(mockTtq.track).toHaveBeenCalledWith('AddPaymentInfo', {
        contents: [
          {
            content_id: 'premium',
            content_name: 'Premium Plan',
            content_type: 'product',
          },
        ],
        currency: 'VND',
      });
    });

    it('should track payment info without plan details', () => {
      trackAddPaymentInfo();

      expect(mockTtq.track).toHaveBeenCalledWith('AddPaymentInfo', {
        currency: 'VND',
      });
    });
  });

  describe('trackSearch', () => {
    it('should track search with query string', () => {
      trackSearch('AI models');

      expect(mockTtq.track).toHaveBeenCalledWith('Search', {
        search_string: 'AI models',
      });
    });
  });
});
