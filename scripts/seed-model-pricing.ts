/**
 * Seed model_pricing table (PHO-223 — Phase 2.1 P0-1)
 *
 * Populates current production-tier models with VERIFIED provider rates.
 * Existing seed-pricing.ts covers legacy IDs (gpt-4o-mini, claude-3-opus etc.);
 * this script seeds the CURRENT tier 1/2/3 models actually routed by route.ts.
 *
 * Conversion: USD/1M tokens × 25,000 = points/1M tokens (1 pt ≈ $0.00004)
 * Reference: src/server/services/billing/credits.ts:220
 *
 * Rates VERIFIED 2026-04-29 from official provider docs:
 *   - OpenAI:    https://platform.openai.com/docs/pricing
 *   - Anthropic: https://docs.anthropic.com/en/docs/about-claude/pricing
 *   - Google:    https://ai.google.dev/gemini-api/docs/pricing
 *
 * Run:      pnpm tsx scripts/seed-model-pricing.ts
 * Verify:   SELECT count(*) FROM model_pricing WHERE id LIKE 'seed_phase2_%';  -- expect 9
 * Rollback: DELETE FROM model_pricing WHERE id LIKE 'seed_phase2_%';
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

// Standard pricing (≤200K context). Long-context premium handled by PHO-225 pre-flight.
const SEEDS: PricingSeed[] = [
  // ============================================================================
  // Tier 1 — Free / Cheap tier
  // ============================================================================
  { inputUsdPer1M: 0.3, modelId: 'gemini-2.5-flash', outputUsdPer1M: 2.5, tier: 1 },
  { inputUsdPer1M: 0.5, modelId: 'gemini-3-flash', outputUsdPer1M: 3, tier: 1 },
  { inputUsdPer1M: 1.25, modelId: 'gpt-5.2', outputUsdPer1M: 10, tier: 1 },

  // ============================================================================
  // Tier 2 — Standard / Mid tier
  // ============================================================================
  { inputUsdPer1M: 1.25, modelId: 'gemini-2.5-pro', outputUsdPer1M: 10, tier: 2 },
  { inputUsdPer1M: 1.75, modelId: 'gpt-5.3', outputUsdPer1M: 14, tier: 2 },
  { inputUsdPer1M: 3, modelId: 'claude-sonnet-4.5', outputUsdPer1M: 15, tier: 2 },

  // ============================================================================
  // Tier 3 — Premium / Expensive tier
  // ============================================================================
  { inputUsdPer1M: 2.5, modelId: 'gpt-5.4', outputUsdPer1M: 15, tier: 3 },
  { inputUsdPer1M: 2, modelId: 'gemini-3.1-pro-preview', outputUsdPer1M: 12, tier: 3 },
  { inputUsdPer1M: 5, modelId: 'claude-opus-4.6', outputUsdPer1M: 25, tier: 3 },
];

async function seed() {
  console.log(`\n🌱 Seeding model_pricing — ${SEEDS.length} rows\n`);

  let inserted = 0;
  let failed = 0;

  for (const s of SEEDS) {
    const id = `seed_phase2_${s.modelId}`;
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
          target: modelPricing.id,
        });

      console.log(
        `✅ ${s.modelId.padEnd(28)} Tier ${s.tier} | ` +
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

await seed().catch((e) => {
  console.error('\n❌ Seed failed:', e);
  throw e;
});
