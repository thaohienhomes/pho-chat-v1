/**
 * Tests for the bypassPayment hotfix on /api/subscription/upgrade.
 *
 * Pre-fix: any authenticated user could send `{ bypassPayment: true }` to
 * skip the Sepay payment step and self-promote to a paid plan. The fix
 * removes the flag from the public contract entirely and rejects any
 * request that still includes it with a 403 + PostHog audit event.
 */
// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/libs/logger', () => ({
  pino: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/libs/posthog-server', () => ({
  captureServerEvent: vi.fn(),
}));

const buildRequest = (body: unknown): NextRequest =>
  ({
    headers: new Headers({ host: 'pho.chat', 'x-forwarded-proto': 'https' }),
    json: async () => body,
  }) as unknown as NextRequest;

describe('POST /api/subscription/upgrade — bypassPayment hotfix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when caller is not authenticated', async () => {
    const { auth } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: null } as any);

    const res = await POST(buildRequest({ newPlanId: 'vn_pro', billingCycle: 'monthly' }));
    expect(res.status).toBe(401);
  });

  it('rejects authenticated request that includes bypassPayment:true with 403', async () => {
    const { auth } = await import('@clerk/nextjs/server');
    const { captureServerEvent } = await import('@/libs/posthog-server');
    vi.mocked(auth).mockResolvedValue({ userId: 'user_normal' } as any);

    const res = await POST(
      buildRequest({ newPlanId: 'vn_pro', billingCycle: 'monthly', bypassPayment: true }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/bypassPayment/i);
    expect(captureServerEvent).toHaveBeenCalledWith(
      'billing_bypass_denied',
      'user_normal',
      expect.objectContaining({
        endpoint: '/api/subscription/upgrade',
        reason: 'client_supplied_bypass_payment_flag',
      }),
    );
  });

  it('rejects bypassPayment:false (still client-supplied) with 403', async () => {
    // Defense-in-depth: even a falsy value means the client knows about the
    // flag. We treat the presence of the key as the signal, not the value.
    const { auth } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: 'user_normal' } as any);

    const res = await POST(
      buildRequest({ newPlanId: 'vn_pro', billingCycle: 'monthly', bypassPayment: false }),
    );

    expect(res.status).toBe(403);
  });

  it('does not reject a normal upgrade request that omits bypassPayment', async () => {
    const { auth } = await import('@clerk/nextjs/server');
    vi.mocked(auth).mockResolvedValue({ userId: 'user_normal' } as any);

    const res = await POST(buildRequest({ newPlanId: '', billingCycle: '' }));
    // Missing fields → 400, not the 403 from the bypass guard. This proves
    // the bypass guard does not false-positive on legitimate traffic.
    expect(res.status).toBe(400);
  });
});
