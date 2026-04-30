import { processModelUsage } from './credits';

/**
 * Phở Points cost per 1M input tokens for known embedding models.
 * Conservative defaults — refine once embedding rows land in `model_pricing`.
 */
const EMBEDDING_INPUT_COST_PER_1M: Record<string, number> = {
  'embedding-001': 3750,
  'gemini-embedding-001': 3750,
  'text-embedding-3-large': 3300,
  'text-embedding-3-small': 500,
  'text-embedding-ada-002': 500,
};

const DEFAULT_EMBEDDING_COST_PER_1M = 500;

interface MeterEmbeddingParams {
  inputs: string | string[];
  model: string;
  provider: string;
  userId?: string;
}

/**
 * Record an embedding call against the user's Phở Points balance.
 *
 * Embeddings are always Tier 1 (no atomic slot, no daily tier limits).
 * Token estimate uses chars/4 — coarse but better than zero, which is what
 * we charged before (PHO-229: embeddings had no metering at all and the
 * provider cost was eaten by the company).
 *
 * Failures are logged and swallowed. Embedding metering must never break
 * the underlying request — the user already got their search/index result.
 */
export async function meterEmbeddingUsage({
  inputs,
  model,
  provider,
  userId,
}: MeterEmbeddingParams): Promise<void> {
  if (!userId) return;

  const texts = Array.isArray(inputs) ? inputs : [inputs];
  const totalChars = texts.reduce((sum, t) => sum + (t?.length ?? 0), 0);
  if (totalChars === 0) return;

  const inputTokens = Math.ceil(totalChars / 4);
  const costPer1M = EMBEDDING_INPUT_COST_PER_1M[model] ?? DEFAULT_EMBEDDING_COST_PER_1M;
  const cost = Math.ceil((inputTokens * costPer1M) / 1_000_000);

  try {
    await processModelUsage(userId, cost, 1, false, {
      feature: 'embedding',
      inputTokens,
      model,
      outputTokens: 0,
      provider,
    });
  } catch (e) {
    console.warn('[Embedding Metering] failed to record usage:', e);
  }
}
