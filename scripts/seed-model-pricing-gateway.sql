-- Seed model_pricing — gateway-prefixed modelIds (PHO-256)
-- Equivalent of scripts/seed-model-pricing-gateway.ts. Run on Neon Console
-- when you don't want to run the bunx script against prod DATABASE_URL.
--
-- Conversion: USD/1M tokens × 25,000 = points/1M tokens
-- Rates verified 2026-05-02 from official provider docs.
--
-- Verify:   SELECT count(*) FROM model_pricing WHERE id LIKE 'seed_gateway_%';  -- expect 18
-- Rollback: DELETE FROM model_pricing WHERE id LIKE 'seed_gateway_%';

INSERT INTO model_pricing
  (id, model_id, input_cost_per_1m, output_cost_per_1m, input_price, output_price, per_msg_fee, tier, is_active)
VALUES
  -- Tier 1 — mirrors of PR #24 with provider prefix
  ('seed_gateway_google_gemini-2.5-flash',                'google/gemini-2.5-flash',                7500,    62500,  0, 0, 0, 1, true),
  ('seed_gateway_google_gemini-3-flash',                  'google/gemini-3-flash',                  12500,   75000,  0, 0, 0, 1, true),
  ('seed_gateway_openai_gpt-5.2',                         'openai/gpt-5.2',                         31250,   250000, 0, 0, 0, 1, true),
  -- Tier 1 — new models not in PR #24
  ('seed_gateway_openai_gpt-4o-mini',                     'openai/gpt-4o-mini',                     3750,    15000,  0, 0, 0, 1, true),
  ('seed_gateway_google_gemini-2.0-flash',                'google/gemini-2.0-flash',                2500,    10000,  0, 0, 0, 1, true),
  ('seed_gateway_google_gemini-3.1-flash-lite-preview',   'google/gemini-3.1-flash-lite-preview',   6250,    37500,  0, 0, 0, 1, true),
  ('seed_gateway_deepseek_deepseek-chat',                 'deepseek/deepseek-chat',                 3500,    7000,   0, 0, 0, 1, true),
  -- Tier 2 — mirrors of PR #24
  ('seed_gateway_google_gemini-2.5-pro',                  'google/gemini-2.5-pro',                  31250,   250000, 0, 0, 0, 2, true),
  ('seed_gateway_openai_gpt-5.3',                         'openai/gpt-5.3',                         43750,   350000, 0, 0, 0, 2, true),
  ('seed_gateway_anthropic_claude-sonnet-4.5',            'anthropic/claude-sonnet-4.5',            75000,   375000, 0, 0, 0, 2, true),
  -- Tier 3 — mirrors of PR #24
  ('seed_gateway_openai_gpt-5.4',                         'openai/gpt-5.4',                         62500,   375000, 0, 0, 0, 3, true),
  ('seed_gateway_google_gemini-3.1-pro-preview',          'google/gemini-3.1-pro-preview',          50000,   300000, 0, 0, 0, 3, true),
  ('seed_gateway_anthropic_claude-opus-4.6',              'anthropic/claude-opus-4.6',              125000,  625000, 0, 0, 0, 3, true),
  -- PHO-287 cost-leak fix: active-but-unseeded gateway IDs (billed ~0 + bypassed
  -- the daily USD cap). claude-sonnet-4.6 alone leaked $102 over 30 days.
  ('seed_gateway_anthropic_claude-sonnet-4.6',            'anthropic/claude-sonnet-4.6',            75000,   375000, 0, 0, 0, 2, true),
  ('seed_gateway_claude-sonnet-4-20250514',               'claude-sonnet-4-20250514',               75000,   375000, 0, 0, 0, 2, true),
  ('seed_gateway_openai_gpt-5.3-codex',                   'openai/gpt-5.3-codex',                   43750,   350000, 0, 0, 0, 2, true),
  ('seed_gateway_deepseek_deepseek-r1',                   'deepseek/deepseek-r1',                   13750,   54750,  0, 0, 0, 2, true),
  -- Un-prefixed legacy ID still reaches getModelPricing() on some routes.
  ('seed_gateway_gemini-2.5-flash',                       'gemini-2.5-flash',                       7500,    62500,  0, 0, 0, 1, true)
-- Conflict on model_id (the unique business key the route looks up), NOT id:
-- a model can already exist under a different id from the un-prefixed PR #24
-- seed, which would trip model_pricing_model_id_unique if we arbitrated on id.
ON CONFLICT (model_id) DO UPDATE SET
  input_cost_per_1m = EXCLUDED.input_cost_per_1m,
  output_cost_per_1m = EXCLUDED.output_cost_per_1m,
  tier = EXCLUDED.tier,
  is_active = true;
