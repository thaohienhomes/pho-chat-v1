/**
 * Tests for the role-gated labs bypass on /api/labs/pho-gateway.
 *
 * The labs token alone is no longer sufficient — the caller must also
 * present an `X-Admin-User-Id` header that resolves to an admin via
 * `isAdmin()`. This file covers the security paths only; the inference
 * fan-out is exercised by the existing failover script.
 */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(backend)/middleware/auth', () => ({
  checkAuth: (handler: any) => handler,
}));

vi.mock('@/libs/posthog-server', () => ({
  captureServerEvent: vi.fn(),
}));

vi.mock('@/server/services/auth/adminGuard', () => ({
  isAdmin: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeWithUserPayload: vi.fn(),
}));

vi.mock('@/server/services/phoGateway', () => ({
  phoGatewayService: { resolveProviderList: vi.fn(() => []) },
}));

vi.mock('@/utils/errorResponse', () => ({
  createErrorResponse: () => new Response('err', { status: 500 }),
}));

const DEFAULT_BODY = { model: 'm' };
const buildRequest = (headers: Record<string, string>, body?: unknown): Request =>
  new Request('https://pho.chat/api/labs/pho-gateway', {
    body: JSON.stringify(body ?? DEFAULT_BODY),
    headers: { 'content-type': 'application/json', ...headers },
    method: 'POST',
  });

describe('POST /api/labs/pho-gateway — admin-gated bypass', () => {
  const originalToken = process.env.PHO_GATEWAY_LABS_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PHO_GATEWAY_LABS_TOKEN = 'test_token_value';
  });

  afterEach(() => {
    // Assigning `undefined` to a process.env key coerces to the string
    // 'undefined' and leaks state across tests. Delete-or-restore preserves
    // the original-unset case correctly.
    if (originalToken === undefined) {
      delete process.env.PHO_GATEWAY_LABS_TOKEN;
    } else {
      process.env.PHO_GATEWAY_LABS_TOKEN = originalToken;
    }
  });

  it('returns 503 when PHO_GATEWAY_LABS_TOKEN is not configured', async () => {
    delete process.env.PHO_GATEWAY_LABS_TOKEN;
    const { POST } = await import('./route');

    const res = await POST(buildRequest({ Authorization: 'Bearer anything' }), {});
    expect(res.status).toBe(503);
  });

  it('returns 403 when token matches but X-Admin-User-Id header is missing', async () => {
    const { POST } = await import('./route');
    const { captureServerEvent } = await import('@/libs/posthog-server');

    const res = await POST(buildRequest({ Authorization: 'Bearer test_token_value' }), {});

    expect(res.status).toBe(403);
    expect(captureServerEvent).toHaveBeenCalledWith(
      'billing_bypass_denied',
      'anonymous',
      expect.objectContaining({ reason: 'missing_admin_user_id_header' }),
    );
  });

  it('returns 403 when X-Admin-User-Id resolves to a non-admin', async () => {
    const { POST } = await import('./route');
    const { isAdmin } = await import('@/server/services/auth/adminGuard');
    const { captureServerEvent } = await import('@/libs/posthog-server');
    vi.mocked(isAdmin).mockResolvedValue(false);

    const res = await POST(
      buildRequest({
        Authorization: 'Bearer test_token_value',
        'X-Admin-User-Id': 'user_normal',
      }),
      {},
    );

    expect(res.status).toBe(403);
    expect(isAdmin).toHaveBeenCalledWith('user_normal');
    expect(captureServerEvent).toHaveBeenCalledWith(
      'billing_bypass_denied',
      'user_normal',
      expect.objectContaining({ reason: 'non_admin_user_id' }),
    );
  });

  it('logs billing_bypass_used and proceeds when token + admin header are valid', async () => {
    const { POST } = await import('./route');
    const { isAdmin } = await import('@/server/services/auth/adminGuard');
    const { captureServerEvent } = await import('@/libs/posthog-server');
    const { phoGatewayService } = await import('@/server/services/phoGateway');
    vi.mocked(isAdmin).mockResolvedValue(true);
    // Empty priority list → handleRequest falls through to createErrorResponse,
    // which our mock returns as a 500. We're asserting on the bypass log, not
    // on inference success.
    vi.mocked(phoGatewayService.resolveProviderList).mockReturnValue([]);

    await POST(
      buildRequest(
        {
          Authorization: 'Bearer test_token_value',
          'X-Admin-User-Id': 'user_admin',
        },
        { model: 'pho-test-fast', provider: 'groq' },
      ),
      {},
    );

    expect(captureServerEvent).toHaveBeenCalledWith(
      'billing_bypass_used',
      'user_admin',
      expect.objectContaining({
        endpoint: '/api/labs/pho-gateway',
        model: 'pho-test-fast',
        provider: 'groq',
      }),
    );
  });

  it('captures billing_bypass_denied when a Bearer token is presented but does not match', async () => {
    const { POST } = await import('./route');
    const { captureServerEvent } = await import('@/libs/posthog-server');

    // Mismatched token → falls through to authenticatedHandler (which our mock
    // is the identity wrapper around `coreHandler`). The handler reads the
    // body and returns a Response; we assert on the security event AND on
    // the promise resolving (no swallowed rejection).
    const res = await POST(
      buildRequest(
        { Authorization: 'Bearer wrong_token', 'X-Admin-User-Id': 'user_attacker' },
        { model: 'm' },
      ),
      {},
    );

    expect(res).toBeDefined();
    expect(captureServerEvent).toHaveBeenCalledWith(
      'billing_bypass_denied',
      'anonymous',
      expect.objectContaining({
        reason: 'invalid_labs_token',
        untrusted_admin_user_id: 'user_attacker',
      }),
    );
  });
});
