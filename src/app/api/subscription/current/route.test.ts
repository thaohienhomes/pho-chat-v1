/**
 * @file route.test.ts
 * @description Unit tests for /api/subscription/current endpoint
 * Tests the subscription prioritization logic that ensures lifetime/paid plans
 * are returned over free plans when a user has multiple subscriptions
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

// Mock auth before importing the route
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

// Mock database
vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

// Mock logger
vi.mock('@/libs/logger', () => ({
  pino: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const createMockSubscription = (overrides = {}) => ({
  billingCycle: 'monthly',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date('2025-12-31'),
  currentPeriodStart: new Date('2024-12-31'),
  id: 'sub_123',
  planId: 'free',
  status: 'active',
  userId: 'user_123',
  ...overrides,
});

const createMockLifetimeSubscription = (overrides = {}) => ({
  billingCycle: 'yearly',
  cancelAtPeriodEnd: true,
  currentPeriodEnd: new Date('2025-12-31T23:59:59Z'),
  currentPeriodStart: new Date('2024-12-31T00:00:00Z'),
  id: 'sub_123',
  planId: 'lifetime',
  status: 'active',
  userId: 'user_123',
  ...overrides,
});

const setupMockDB = async (subscriptions: any[]) => {
  const { auth } = await import('@clerk/nextjs/server');
  const { getServerDB } = await import('@/database/server');

  vi.mocked(auth).mockResolvedValue({ userId: 'user_123' } as any);
  vi.mocked(getServerDB).mockResolvedValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(subscriptions),
      }),
    }),
  } as any);
};

const createSub = (planId: string, start = new Date()) => ({
  billingCycle: 'monthly',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date('2025-12-31'),
  currentPeriodStart: start,
  id: `sub_${planId}`,
  planId,
  status: 'active',
  userId: 'user_123',
});

describe('GET /api/subscription/current', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication', () => {
    it('should return 401 if user is not authenticated', async () => {
      const { auth } = await import('@clerk/nextjs/server');
      vi.mocked(auth).mockResolvedValue({ userId: null } as any);

      const response = await GET();
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });
  });

  describe('No subscription scenarios', () => {
    it('should return 404 if user has no active subscriptions', async () => {
      const { auth } = await import('@clerk/nextjs/server');
      const { getServerDB } = await import('@/database/server');

      vi.mocked(auth).mockResolvedValue({ userId: 'user_123' } as any);
      vi.mocked(getServerDB).mockResolvedValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as any);

      const response = await GET();
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('No active subscription found');
    });
  });

  describe('Subscription prioritization', () => {
    it('should prioritize lifetime subscription over free subscription', async () => {
      const freeSubscription = createMockSubscription({
        currentPeriodStart: new Date('2024-01-01'),
        id: 'sub_free',
        planId: 'free',
      });
      const lifetimeSubscription = createMockSubscription({
        currentPeriodStart: new Date('2024-06-01'),
        id: 'sub_lifetime',
        planId: 'lifetime',
      });

      // Order should not matter - lifetime should be prioritized
      await setupMockDB([freeSubscription, lifetimeSubscription]);

      const response = await GET();
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.planId).toBe('lifetime');
      expect(data.id).toBe('sub_lifetime');
    });

    it('should prioritize gl_lifetime subscription over free subscription', async () => {
      const freeSubscription = createMockSubscription({
        id: 'sub_free',
        planId: 'free',
      });
      const lifetimeSubscription = createMockSubscription({
        id: 'sub_lifetime',
        planId: 'gl_lifetime',
      });

      await setupMockDB([freeSubscription, lifetimeSubscription]);

      const response = await GET();
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.planId).toBe('gl_lifetime');
    });

    it('should prioritize founding_member subscription over free', async () => {
      await setupMockDB([
        createMockSubscription({ id: 'sub_free', planId: 'free' }),
        createMockSubscription({ id: 'sub_founding', planId: 'founding_member' }),
      ]);

      const response = await GET();
      const data = await response.json();
      expect(data.planId).toBe('founding_member');
    });

    it('should prioritize paid subscription over free subscription', async () => {
      await setupMockDB([
        createMockSubscription({ id: 'sub_free', planId: 'free' }),
        createMockSubscription({ id: 'sub_premium', planId: 'gl_premium' }),
      ]);

      const response = await GET();
      const data = await response.json();
      expect(data.planId).toBe('gl_premium');
    });

    it('should prioritize vn_pro over vn_free', async () => {
      await setupMockDB([
        createMockSubscription({ id: 'sub_vn_free', planId: 'vn_free' }),
        createMockSubscription({ id: 'sub_vn_pro', planId: 'vn_pro' }),
      ]);

      const response = await GET();
      const data = await response.json();
      expect(data.planId).toBe('vn_pro');
    });

    it('should prioritize trial-excluded starter as free', async () => {
      await setupMockDB([
        createMockSubscription({ id: 'sub_starter', planId: 'starter' }),
        createMockSubscription({ id: 'sub_premium', planId: 'premium' }),
      ]);

      const response = await GET();
      const data = await response.json();
      expect(data.planId).toBe('premium');
    });

    it('should prefer more recent subscription when priorities are equal', async () => {
      await setupMockDB([
        createMockSubscription({
          currentPeriodStart: new Date('2024-01-01'),
          id: 'sub_old',
          planId: 'vn_basic',
        }),
        createMockSubscription({
          currentPeriodStart: new Date('2024-12-01'),
          id: 'sub_new',
          planId: 'vn_pro',
        }),
      ]);

      const response = await GET();
      const data = await response.json();
      // vn_pro should win because neither is free/lifetime but it's more recent
      expect(data.planId).toBe('vn_pro');
    });

    it('should return the only subscription when user has one', async () => {
      await setupMockDB([createMockSubscription({ id: 'sub_only', planId: 'vn_basic' })]);

      const response = await GET();
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.planId).toBe('vn_basic');
    });

    it('should return free subscription when user only has free', async () => {
      await setupMockDB([createMockSubscription({ id: 'sub_free', planId: 'free' })]);

      const response = await GET();
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.planId).toBe('free');
    });
  });

  describe('Response format', () => {
    it('should return correct subscription fields', async () => {
      const { auth } = await import('@clerk/nextjs/server');
      const { getServerDB } = await import('@/database/server');

      vi.mocked(auth).mockResolvedValue({ userId: 'user_123' } as any);
      vi.mocked(getServerDB).mockResolvedValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([createMockLifetimeSubscription()]),
          }),
        }),
      } as any);

      const response = await GET();
      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('id', 'sub_123');
      expect(data).toHaveProperty('planId', 'lifetime');
      expect(data).toHaveProperty('billingCycle', 'yearly');
      expect(data).toHaveProperty('status', 'active');
      expect(data).toHaveProperty('cancelAtPeriodEnd', true);
      expect(data).toHaveProperty('currentPeriodStart');
      expect(data).toHaveProperty('currentPeriodEnd');
    });

    it('should return ISO date strings for period dates', async () => {
      const { auth } = await import('@clerk/nextjs/server');
      const { getServerDB } = await import('@/database/server');

      const subscription = createMockLifetimeSubscription();
      vi.mocked(auth).mockResolvedValue({ userId: 'user_123' } as any);
      vi.mocked(getServerDB).mockResolvedValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([subscription]),
          }),
        }),
      } as any);

      const response = await GET();
      const data = await response.json();

      // Verify dates are ISO strings
      expect(typeof data.currentPeriodStart).toBe('string');
      expect(typeof data.currentPeriodEnd).toBe('string');
      expect(() => new Date(data.currentPeriodStart)).not.toThrow();
      expect(() => new Date(data.currentPeriodEnd)).not.toThrow();
    });
  });

  describe('Edge cases with lifetime keyword detection', () => {
    it('should detect custom_lifetime_plan as lifetime priority', async () => {
      await setupMockDB([createSub('free'), createSub('custom_lifetime_plan')]);

      const response = await GET();
      const data = await response.json();
      expect(data.planId).toBe('custom_lifetime_plan');
    });

    it('should detect FOUNDING_SPECIAL as lifetime priority', async () => {
      await setupMockDB([createSub('free'), createSub('FOUNDING_SPECIAL')]);

      const response = await GET();
      const data = await response.json();
      expect(data.planId).toBe('FOUNDING_SPECIAL');
    });

    it('should correctly order: lifetime > paid > free', async () => {
      await setupMockDB([
        createSub('free'),
        createSub('vn_pro'),
        createSub('lifetime_founding_member'),
      ]);

      const response = await GET();
      const data = await response.json();
      expect(data.planId).toBe('lifetime_founding_member');
    });
  });
});
