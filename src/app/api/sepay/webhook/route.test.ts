import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as billingService from '@/server/services/billing/sepay';

import { POST } from './route';

// Mock billing services so no test ever touches the database
vi.mock('@/server/services/billing/sepay', () => ({
  activateUserSubscription: vi.fn(),
  getPaymentByOrderId: vi.fn(),
  updatePaymentStatus: vi.fn(),
}));

vi.mock('@/server/services/billing/credits', () => ({
  addPhoCredits: vi.fn(),
}));

// Mock Sepay gateway
vi.mock('@/libs/sepay', () => ({
  sepayGateway: {
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
  },
}));

// Mock payment metrics collector
vi.mock('@/libs/monitoring/payment-metrics', () => ({
  paymentMetricsCollector: {
    recordError: vi.fn(),
    recordWebhookProcessing: vi.fn(),
  },
}));

const WEBHOOK_SECRET = 'test-webhook-secret-value';

const createWebhookPayload = (overrides = {}) => ({
  amount: 100_000,
  currency: 'VND',
  orderId: 'PHO_QR_123456',
  signature: 'valid_signature_hash',
  status: 'failed',
  timestamp: new Date().toISOString(),
  transactionId: 'TXN_123456',
  ...overrides,
});

const createRequest = (body: object, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/sepay/webhook', {
    body: JSON.stringify(body),
    headers,
    method: 'POST',
  });

describe('POST /api/sepay/webhook (compat route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SEPAY_WEBHOOK_SECRET', WEBHOOK_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('authentication (fail-closed)', () => {
    it('returns 500 and does not process when SEPAY_WEBHOOK_SECRET is not configured', async () => {
      vi.stubEnv('SEPAY_WEBHOOK_SECRET', '');

      const response = await POST(createRequest(createWebhookPayload()) as any);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(billingService.updatePaymentStatus).not.toHaveBeenCalled();
      expect(billingService.activateUserSubscription).not.toHaveBeenCalled();
    });

    it('returns 401 and does not process when no secret is provided', async () => {
      const response = await POST(createRequest(createWebhookPayload()) as any);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(billingService.updatePaymentStatus).not.toHaveBeenCalled();
      expect(billingService.activateUserSubscription).not.toHaveBeenCalled();
    });

    it('returns 401 when x-sepay-webhook-secret header has the wrong value', async () => {
      const response = await POST(
        createRequest(createWebhookPayload(), { 'x-sepay-webhook-secret': 'forged-secret' }) as any,
      );

      expect(response.status).toBe(401);
      expect(billingService.updatePaymentStatus).not.toHaveBeenCalled();
    });

    it('returns 401 when Authorization header carries a wrong Apikey token', async () => {
      const response = await POST(
        createRequest(createWebhookPayload(), { authorization: 'Apikey forged-secret' }) as any,
      );

      expect(response.status).toBe(401);
      expect(billingService.updatePaymentStatus).not.toHaveBeenCalled();
    });

    it('accepts the shared secret via x-sepay-webhook-secret header', async () => {
      const response = await POST(
        createRequest(createWebhookPayload(), { 'x-sepay-webhook-secret': WEBHOOK_SECRET }) as any,
      );

      expect(response.status).toBe(200);
      expect(billingService.updatePaymentStatus).toHaveBeenCalledWith(
        'PHO_QR_123456',
        'failed',
        expect.objectContaining({ transactionId: 'TXN_123456' }),
      );
    });

    it('accepts the shared secret via Authorization: Apikey header', async () => {
      const response = await POST(
        createRequest(createWebhookPayload(), { authorization: `Apikey ${WEBHOOK_SECRET}` }) as any,
      );

      expect(response.status).toBe(200);
      expect(billingService.updatePaymentStatus).toHaveBeenCalled();
    });
  });

  describe('payload validation (after auth)', () => {
    it('returns 400 when orderId is missing', async () => {
      const response = await POST(
        createRequest(createWebhookPayload({ orderId: undefined }), {
          'x-sepay-webhook-secret': WEBHOOK_SECRET,
        }) as any,
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain('orderId');
      expect(billingService.updatePaymentStatus).not.toHaveBeenCalled();
    });

    it('returns 400 when transactionId is missing', async () => {
      const response = await POST(
        createRequest(createWebhookPayload({ transactionId: undefined }), {
          'x-sepay-webhook-secret': WEBHOOK_SECRET,
        }) as any,
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain('transactionId');
      expect(billingService.updatePaymentStatus).not.toHaveBeenCalled();
    });
  });
});
