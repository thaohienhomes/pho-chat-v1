import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Never hit a real DB/Clerk even if a test omits planId and the capture path
// falls back to getUserPlanFromDB.
vi.mock('@/server/services/subscription/getUserPlanFromDB', () => ({
  getUserPlanFromDB: vi.fn().mockResolvedValue({ planId: 'fallback_plan', source: 'db' }),
}));

/**
 * PCFIX-4: pin the $ai_ttft_ms contract on the server-side `$ai_generation`
 * capture. TTFT is what lets dashboards tell "stalled before first token" apart
 * from "long stream" — so it must be emitted when present and absent (not null)
 * when the caller did not measure it (e.g. non-streaming paths).
 */
describe('captureAiGeneration — $ai_ttft_ms (PCFIX-4)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const baseParams = {
    costPoints: 10,
    inputTokens: 100,
    latencyMs: 5000,
    model: 'anthropic/claude-sonnet-4.6',
    outputTokens: 800,
    planId: 'medical_beta', // pass plan to skip the DB fallback lookup
    provider: 'vercelaigateway',
    tier: 2,
    userId: 'user_123',
  };

  beforeEach(() => {
    // POSTHOG_KEY is read at module-load time, so stub env BEFORE the dynamic import.
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test_key');
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  const importFresh = async () => {
    vi.resetModules();
    return import('../posthog-server');
  };

  const capturedProperties = async () => {
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0][1] as { body: string };
    return JSON.parse(init.body).properties;
  };

  it('emits $ai_ttft_ms when ttftMs is provided (streaming path)', async () => {
    const { captureAiGeneration } = await importFresh();

    captureAiGeneration({ ...baseParams, ttftMs: 1234 });

    const props = await capturedProperties();
    expect(props.$ai_ttft_ms).toBe(1234);
    // total wall-clock stays available for comparison.
    expect(props.$ai_latency_ms).toBe(5000);
  });

  it('omits $ai_ttft_ms (not null) when ttftMs is undefined (non-streaming path)', async () => {
    const { captureAiGeneration } = await importFresh();

    captureAiGeneration({ ...baseParams }); // no ttftMs

    const props = await capturedProperties();
    expect('$ai_ttft_ms' in props).toBe(false);
    expect(props.$ai_latency_ms).toBe(5000);
  });

  it('stamps ttftMs=0 explicitly rather than dropping it', async () => {
    const { captureAiGeneration } = await importFresh();

    // A first chunk arriving in the same millisecond yields ttftMs=0; that is a
    // real measurement and must survive (0 !== undefined).
    captureAiGeneration({ ...baseParams, ttftMs: 0 });

    const props = await capturedProperties();
    expect(props.$ai_ttft_ms).toBe(0);
  });
});
