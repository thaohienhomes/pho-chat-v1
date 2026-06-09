/**
 * Seed model_pricing — gateway-prefixed modelIds (PHO-256)
 *
 * Companion to seed-model-pricing.ts (PR #24). PR #24 seeded 9 rows with
 * UN-prefixed modelIds (e.g. 'gpt-5.4'). However, src/app/(backend)/webapi/
 * chat/[provider]/route.ts:669 calls getModelPricing(actualModelUsed) where
 * actualModelUsed is the gateway-routed form returned by phoGatewayService
 * (e.g. 'openai/gpt-5.4'). The lookup at route.ts:78 is exact-match
 * (eq(modelPricing.modelId, modelId)) — so the prefix mismatch causes every
 * Vercel-AI-Gateway-routed call to log "No DB pricing for model X, using
 * Tier N fallback" and bill at the tier fallback rate instead of the exact
 * per-model rate.
 *
 * Vercel logs (2026-05-02): warning observed for openai/gpt-5.4 ($6.91/week).
 * PostHog 7-day data shows 12 active models with the same shape.
 *
 * This script seeds gateway-prefixed mirror entries so the lookup hits.
 * Existing PR #24 rows are left untouched (they may still serve direct-
 * provider routes that pass un-prefixed IDs).
 *
 * Conversion: USD/1M tokens × 25,000 = points/1M tokens (1 pt ≈ $0.00004)
 * Reference: src/server/services/billing/credits.ts:220
 *
 * Rates VERIFIED 2026-05-02 from official provider docs:
 *   - OpenAI:    https://openai.com/api/pricing
 *   - Anthropic: https://docs.anthropic.com/en/docs/about-claude/pricing
 *   - Google:    https://ai.google.dev/gemini-api/docs/pricing
 *   - DeepSeek:  https://api-docs.deepseek.com/quick_start/pricing
 *
 * Run:      bunx tsx scripts/seed-model-pricing-gateway.ts
 * Verify:   SELECT count(*) FROM model_pricing WHERE id LIKE 'seed_gateway_%';  -- expect 18
 * Rollback: DELETE FROM model_pricing WHERE id LIKE 'seed_gateway_%';
 */
import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { modelPricing } from '../packages/database/src/schemas/pricing';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not defined');
}

const pool = new Pool({ connectionString });
const db = drizzle(pool);

const USD_TO_POINTS = 25_000;

interface PricingSeed {
  inputUsdPer1M: number;
  modelId: string;
  outputUsdPer1M: number;
  tier: number;
}

// All entries use the gateway-prefixed modelId form that route.ts:669 passes
// to getModelPricing(). Tier classifications mirror PR #24 (seed-model-pricing.ts).
const SEEDS: PricingSeed[] = [
  // ============================================================================
  // Tier 1 — Free / Cheap tier
  // ============================================================================
  // Mirrors of PR #24 entries (same tier + same rate, prefixed modelId)
  { inputUsdPer1M: 0.3, modelId: 'google/gemini-2.5-flash', outputUsdPer1M: 2.5, tier: 1 },
  { inputUsdPer1M: 0.5, modelId: 'google/gemini-3-flash', outputUsdPer1M: 3, tier: 1 },
  { inputUsdPer1M: 1.25, modelId: 'openai/gpt-5.2', outputUsdPer1M: 10, tier: 1 },

  // New models observed in PostHog 7-day data, not in PR #24
  { inputUsdPer1M: 0.15, modelId: 'openai/gpt-4o-mini', outputUsdPer1M: 0.6, tier: 1 },
  { inputUsdPer1M: 0.1, modelId: 'google/gemini-2.0-flash', outputUsdPer1M: 0.4, tier: 1 },
  {
    inputUsdPer1M: 0.25,
    modelId: 'google/gemini-3.1-flash-lite-preview',
    outputUsdPer1M: 1.5,
    tier: 1,
  },
  { inputUsdPer1M: 0.14, modelId: 'deepseek/deepseek-chat', outputUsdPer1M: 0.28, tier: 1 },

  // ============================================================================
  // Tier 2 — Standard / Mid tier
  // ============================================================================
  { inputUsdPer1M: 1.25, modelId: 'google/gemini-2.5-pro', outputUsdPer1M: 10, tier: 2 },
  { inputUsdPer1M: 1.75, modelId: 'openai/gpt-5.3', outputUsdPer1M: 14, tier: 2 },
  { inputUsdPer1M: 3, modelId: 'anthropic/claude-sonnet-4.5', outputUsdPer1M: 15, tier: 2 },

  // PHO cost-leak fix (2026-06): these gateway IDs were ACTIVE in production but
  // ABSENT from this seed, so getModelPricing() fell back to the MODEL_TIERS
  // default (100/300 pts ≈ $0.004/$0.012 per 1M) — ~800x under the real rate.
  // PostHog 30-day data: claude-sonnet-4.6 alone billed $0.12 vs $102 real cost,
  // and the daily USD cap (which reads usage_logs.cost_usd) never fired because
  // the recorded cost was ~0. modelIds below are the EXACT $ai_model strings
  // observed in telemetry so the exact-match lookup at route.ts hits.
  { inputUsdPer1M: 3, modelId: 'anthropic/claude-sonnet-4.6', outputUsdPer1M: 15, tier: 2 },
  { inputUsdPer1M: 3, modelId: 'claude-sonnet-4-20250514', outputUsdPer1M: 15, tier: 2 },
  { inputUsdPer1M: 1.75, modelId: 'openai/gpt-5.3-codex', outputUsdPer1M: 14, tier: 2 },
  { inputUsdPer1M: 0.55, modelId: 'deepseek/deepseek-r1', outputUsdPer1M: 2.19, tier: 2 },
  // Un-prefixed legacy IDs still reach getModelPricing() on some routes.
  { inputUsdPer1M: 0.3, modelId: 'gemini-2.5-flash', outputUsdPer1M: 2.5, tier: 1 },

  // ============================================================================
  // Tier 3 — Premium / Expensive tier
  // ============================================================================
  { inputUsdPer1M: 2.5, modelId: 'openai/gpt-5.4', outputUsdPer1M: 15, tier: 3 },
  { inputUsdPer1M: 2, modelId: 'google/gemini-3.1-pro-preview', outputUsdPer1M: 12, tier: 3 },
  { inputUsdPer1M: 5, modelId: 'anthropic/claude-opus-4.6', outputUsdPer1M: 25, tier: 3 },
];

async function seed() {
  console.log(`\n🌱 Seeding model_pricing (gateway-prefixed) — ${SEEDS.length} rows\n`);

  let inserted = 0;
  let failed = 0;

  for (const s of SEEDS) {
    // Replace '/' so the PK stays well-formed and easy to query/rollback.
    const id = `seed_gateway_${s.modelId.replace('/', '_')}`;
    const inputPts = Math.round(s.inputUsdPer1M * USD_TO_POINTS);
    const outputPts = Math.round(s.outputUsdPer1M * USD_TO_POINTS);

    try {
      await db
        .insert(modelPricing)
        .values({
          id,
          inputCostPer1M: inputPts,
          inputPrice: 0,
          isActive: true,
          modelId: s.modelId,
          outputCostPer1M: outputPts,
          outputPrice: 0,
          perMsgFee: 0,
          tier: s.tier,
        })
        .onConflictDoUpdate({
          set: {
            inputCostPer1M: inputPts,
            isActive: true,
            outputCostPer1M: outputPts,
            tier: s.tier,
          },
          // Conflict on model_id (the unique business key the chat route looks
          // up), NOT id. A model can already exist under a different id from the
          // un-prefixed PR #24 seed (e.g. 'gemini-2.5-flash'); conflicting on id
          // would hit the model_pricing_model_id_unique constraint and abort.
          target: modelPricing.modelId,
        });

      console.log(
        `✅ ${s.modelId.padEnd(40)} Tier ${s.tier} | ` +
          `in: ${inputPts.toLocaleString().padStart(9)} pts | ` +
          `out: ${outputPts.toLocaleString().padStart(9)} pts`,
      );
      inserted++;
    } catch (e: any) {
      console.error(`❌ ${s.modelId} FAILED: ${e?.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Summary: ${inserted} inserted/updated, ${failed} failed\n`);
  await pool.end();
  if (failed > 0) throw new Error(`${failed} seed insertions failed`);
}

// Top-level await fails on tsx default CJS output (Node v24.x). Wrap in async IIFE
// for CJS compat. process.exit is intentional for CLI exit-code propagation.
// eslint-disable-next-line unicorn/prefer-top-level-await
(async () => {
  try {
    await seed();
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  } catch (e) {
    console.error('\n❌ Seed failed:', e);
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  }
})();
