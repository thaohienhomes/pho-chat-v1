import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logWebhookEvent } from '@/libs/webhookLogger';

// WebhookVerificationError must be the same reference the route imports so its
// `instanceof` check works. validateEvent is the seam we drive per-test.
class WebhookVerificationError extends Error {}
const validateEvent = vi.fn();

vi.mock('@polar-sh/sdk/webhooks', () => ({
  validateEvent: (...args: unknown[]) => validateEvent(...args),
  WebhookVerificationError,
}));

vi.mock('@/libs/webhookLogger', () => ({
  logWebhookEvent: vi.fn(),
}));

vi.mock('@/libs/analytics', () => ({
  serverAnalytics: { track: vi.fn() },
}));

const buildRequest = (body: object) =>
  new Request('http://localhost/api/payment/polar/webhook', {
    body: JSON.stringify(body),
    headers: { 'webhook-id': 'msg_1', 'webhook-signature': 'sig', 'webhook-timestamp': '1' },
    method: 'POST',
  });

// Import after mocks are registered.
const { POST } = await import('./route');

describe('POST /api/payment/polar/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.POLAR_WEBHOOK_SECRET = 'whsec_test';
  });

  it('returns 403 when the signature is invalid', async () => {
    validateEvent.mockImplementation(() => {
      throw new WebhookVerificationError('bad signature');
    });

    const res = await POST(buildRequest({ type: 'order.created' }) as any);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid signature' });
  });

  it('acknowledges with 200 when the signature is valid but the event type is unknown to the SDK', async () => {
    // validateEvent verifies the signature first, THEN parses the schema. An unknown
    // event type (e.g. member.created) means the signature was valid — it must not be
    // treated as a signature failure (which would make Polar retry).
    const schemaErr = new Error('Unknown event type: member.created');
    schemaErr.name = 'SDKValidationError';
    validateEvent.mockImplementation(() => {
      throw schemaErr;
    });

    const res = await POST(buildRequest({ data: {}, type: 'member.created' }) as any);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    // Recorded on the benign "other events" path, not as an error.
    expect(logWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'other', provider: 'polar', status: 'ignored' }),
    );
  });

  it('still rejects with 401 for unexpected errors thrown before the signature is confirmed', async () => {
    validateEvent.mockImplementation(() => {
      throw new Error('unexpected failure before verification');
    });

    const res = await POST(buildRequest({ type: 'order.created' }) as any);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'WEBHOOK_SIGNATURE_INVALID' });
  });
});
