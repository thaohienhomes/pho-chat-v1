# Cost Phase 2 — Implementation Plan

**Findings:** `docs/audit/cost-audit-phase-2-2026-04-28.md` (132 lines) | **Branch:** `cost-audit-phase-2-2026-04-27` | **Linear:** PHO-222 | **Effort:** 4–5 ngày dev solo. Plan only — KHÔNG implement code trong session này.

---

## Phase 2.1 — Quick Wins (P0, 1 ngày, dependency-ordered)

### Fix 1: PHO-223 — Seed `model_pricing` table

- **File mới:** `scripts/seed-model-pricing.ts`. Đọc `MODEL_TIERS` (`pricing.ts:678-874`) → `INSERT INTO model_pricing` với rates correct (USD/1M × 25K → points). Mark `created_by='phase-2-seed'`.
- **Run:** `pnpm tsx scripts/seed-model-pricing.ts` | **Test:** `SELECT count(*) FROM model_pricing WHERE is_active=true` ≥ 13 rows
- **Rollback:** `DELETE FROM model_pricing WHERE created_by='phase-2-seed'`
- **Side fix:** `route.ts:731-732` đổi `inputPrice/outputPrice` → `inputCostPer1M/outputCostPer1M` (1 dòng, schema-aligned)

### Fix 2: PHO-225 — Phở Points pre-flight (depends Fix 1)

**Files:** `credits.ts:73, 147, 191` + `route.ts:353`

```diff
- phoPointsBalance: sql`GREATEST(0, ${users.phoPointsBalance} - ${amount})`
+ phoPointsBalance: sql`${users.phoPointsBalance} - ${amount}`
- if (balance < -10_000) {
+ const estimatedCost = await estimateRequestCost(model, inputTokens);
+ if (balance < estimatedCost) {
    return createErrorResponse(InsufficientQuota, { code: 'INSUFFICIENT_POINTS', balance, required: estimatedCost });
  }
```

- **Test:** Free balance=50K + gpt-5.4 → 402; paying user → balance giảm đúng; cost==balance → pass | **Rollback:** revert 2 commits

### Fix 3: PHO-226 — Retry fail-open cascade (`route.ts:637-651`)

```diff
  if (!isRetryable) {
+   throw e; // Stop cascade — failover chỉ 5xx/429/ECONNRESET
  }
```

- **Test:** simulate 400 từ provider 1 → response trả ngay, KHÔNG charge provider 2+3

### Fix 4: PHO-227 — `atomicAcquireTierSlot` fail-CLOSED (`credits.ts:406-410`)

```diff
  } catch (e) {
    console.error('❌ atomicAcquireTierSlot failed', e);
+   posthog.capture({ event: 'tier_slot_db_error', distinctId: userId, properties: { tier, error: String(e) } });
-   return { acquired: true, newUsage: 0 };
+   return { acquired: false, newUsage: 0, error: 'DB_ERROR' };
  }
```

- **Test:** simulate DB timeout → 503 reject. UX risk: cần alert PHO-231 đi kèm để Hien biết khi DB flaky.

### Fix 5: PHO-224 — `processModelUsage` skip (INVESTIGATE first)

⚠️ KHÔNG có diff sẵn — investigate paths a/b/c (P0-2) trước:

1. PostHog query `properties.$current_url` cho user-A's `send_message` → xác định endpoint
2. Tail Vercel logs grep `Stream parse error|processModelUsage failed|Non-streaming credit tracking skipped`
3. Reproduce locally 3 paths → choose **A** (best-effort partial bill capture token đến time-of-abort) hoặc **B** (migrate sang Vercel AI SDK `streamText({ onFinish })` callback)

- **Test post-fix:** 1 tuần soak, query `usage_logs` cho 5 random Tier 3 users → coverage ≥ 95% requests

---

## Phase 2.2 — Hardening (P1, 2 ngày)

### Fix 6: PHO-228 — TZ standardize sang Vietnam (UTC+7)

**Files:** `credits.ts` (4 sites) + `cron/reset-lifetime-points/route.ts` + Neon SQL function

1. **Neon SQL:** `CREATE OR REPLACE FUNCTION vietnam_date_string() RETURNS DATE AS $$ SELECT (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE; $$ LANGUAGE SQL IMMUTABLE;`
2. **`credits.ts:336-410`** `atomicAcquireTierSlot` thay `CURRENT_DATE` → `vietnam_date_string()` (3 sites Tier 3 + 3 sites Tier 2)
3. **`credits.ts:128-132`** `processModelUsage` thay JS `isSameDay` (Date.getDate compare) → helper `toVietnamDateString(lastDate) === toVietnamDateString(now)`
4. **Cron** đổi schedule `0 0 * * *` (UTC) → `0 17 * * *` (= 00:00 VN next day), hoặc dùng cron timezone field nếu Vercel hỗ trợ

- **Test:** Reproduce race window 06:50 VN → 07:10 VN (UTC midnight crossing). Trước fix: counter Tier 3 reset từ 10 về 1. Sau fix: vẫn 10.
- **Rollback:** revert 4 commits + `DROP FUNCTION vietnam_date_string`

### Fix 7: PHO-229 — Embedding/RAG meter

**File:** `src/server/routers/lambda/chunk.ts:146-220` (semantic search) + file upload auto-embed paths

1. Add `processModelUsage` call sau mỗi `agentRuntime.embeddings()` với `tier=1`, `inputTokens=usage.prompt_tokens`, `outputTokens=0`
2. **Extension Fix 1:** seed `model_pricing` rows cho `text-embedding-3-small` ($0.02/1M = 500 pts/1M) và `gemini-embedding-001` ($0.15/1M = 3,750 pts/1M)
3. Verify routes: semantic search tRPC + `/api/files/...` auto-embed batches (50 chunks × 10 concurrent)

- **Test:** Free user upload 100-chunk PDF → expect \~50K tokens × 500/1M = \~25 pts deducted. Verify `usage_logs` row với `model='text-embedding-3-small'`, `tier=1`.
- **Rollback:** revert 1 commit + delete embedding pricing rows

### Fix 8: PHO-230 — Mid-stream abort handler

**File:** `route.ts:709-758` (streaming IIFE)

**Option A (preferred, minimal refactor):** Wrap IIFE trong try/finally với partial bill

```diff
  (async () => {
+   let accumulatedText = '';
    try {
      const reader = stream2.getReader();
      for (;;) { /* drain */ accumulatedText += decoder.decode(value, { stream: true }); }
+     await processModelUsage(userId, fullCost, tier, true, { ... });
+   } catch (e) {
+     const partialTokens = countTokens(accumulatedText);
+     const partialCost = computePartialCost(partialTokens, activePricing);
+     await processModelUsage(userId, partialCost, tier, true, { ... }).catch(() => {});
+     console.warn('[Mid-stream abort] partial bill', { partialTokens, partialCost });
    }
  })();
```

**Option B (cleaner long-term):** Migrate sang Vercel AI SDK `streamText({ onFinish, onAbort })` callbacks. Larger refactor — defer Phase 2.4 hoặc sau.

- **Test:** Curl chat API + abort connection sau 500ms → verify `usage_logs` có row với partial tokens. Compare gateway charge vs deducted points → ratio ≥ 80%.
- **Rollback:** revert 1 commit, behaviour về fail-open (no burn on abort)

---

## Phase 2.3 — Observability (P1, 1 ngày)

### Fix 9: PHO-231 — PostHog `$ai_*` events + Cost dashboard

**File:** `src/server/services/billing/credits.ts:processModelUsage` (thêm sau line 234, sau khi `usage_logs` insert thành công)

```typescript
import { PostHog } from 'posthog-node';

const posthog = new PostHog(env.POSTHOG_API_KEY, { host: 'https://us.i.posthog.com' });

posthog.capture({
  distinctId: userId,
  event: '$ai_generation',
  properties: {
    $ai_provider: usageLog.provider,
    $ai_model: usageLog.model,
    $ai_input_tokens: usageLog.inputTokens,
    $ai_output_tokens: usageLog.outputTokens,
    $ai_latency: (usageLog.responseTimeMs ?? 0) / 1000,
    $ai_total_cost_usd: costUSD, // computed line 220
    pho_tier: tier,
    pho_points_deducted: finalCost,
    pho_plan_id: userPlanId, // lookup từ creditStatus
  },
});
```

**PostHog dashboard `Phở Cost Audit` (setup manual):**

1. Daily total $ by provider × model (`$ai_total_cost_usd` sum, breakdown by `$ai_model`)
2. Top users by $ spend / 30d (group by `distinctId`)
3. Avg cost/req by plan × tier (matrix)
4. `tier_slot_db_error` rate by hour (alert if >5/hour)
5. Token distribution (input vs output) by model

- **Test:** Send 5 chat reqs trong dev → verify PostHog `$ai_generation` events có full properties hiển thị tại `https://us.posthog.com/project/306983/llm-observability`
- **Rollback:** revert 1 commit + delete dashboard

### Fix 10: PHO-232 — `$exception` tracking với non-null properties

**File:** `src/lib/posthog.ts` (client init) + React Error Boundary wrapper

1. Verify init: `posthog.init(apiKey, { capture_exceptions: true, capture_pageleave: true, ... })` — yêu cầu PostHog SDK v1.95+
2. Nếu auto-capture không work → wire manual `posthog.captureException(error, context)` trong React Error Boundary `componentDidCatch` + `window.addEventListener('error')` + `window.addEventListener('unhandledrejection')`
3. Reproduce: throw Error trong dev component → verify PostHog event có `$exception_message`, `$exception_type`, `$exception_stack_trace` populated (không null)

- **Test:** Trigger client error trong staging → PostHog query `$exception` 24h → tất cả rows có message + stack trace
- **Rollback:** revert 1 commit, fallback current behavior (null props)

---

## Phase 2.4 — Special cases + business decisions (1 ngày)

### Fix 11: PHO-233 — Downgrade user-A → `vn_free` clean

**Tiền điều kiện:** Anh handle communication với user trước (email giải thích / refund nếu cần).

1. **Clerk Dashboard:** User `user_REDACTED_A` → publicMetadata: remove `planId` override (set null hoặc `'vn_free'`)
2. **SQL:** `UPDATE users SET current_plan_id='vn_free', pho_points_balance=50000, daily_tier1_usage=0, daily_tier2_usage=0, daily_tier3_usage=0 WHERE id='user_REDACTED_A';`
3. **Test post Phase 2.1 ship:** user request gpt-5.4 → expect 402 InsufficientQuota

- **Rollback:** restore Clerk metadata + SQL undo (Hien snapshot trước khi run)

### Fix 12: PHO-234 — `vn_premium` cap inversion typo (`pricing.ts:1174-1175`)

```diff
- vn_premium: 500,
- vn_pro: 200,
+ vn_premium: 100,  // intermediate giữa vn_basic (100) và vn_pro (350)
+ vn_pro: 350,      // cao hơn vn_premium, thấp hơn vn_ultimate (1000)
```

- **Test:** vn_premium user → request 101 Tier 1 trong day → expect 429. vn_pro → 350 OK, 351 reject.
- **Rollback:** revert 1 commit (config-only, không DB migrate)

### Fix 13: PHO-235 — Orphan plan IDs audit + migrate

1. **Generate audit:** `SELECT current_plan_id, COUNT(*) FROM users GROUP BY current_plan_id ORDER BY count DESC;` → identify legacy IDs (`lifetime_*`, `gl_*`, custom)
2. Hien review → quyết định mapping (eg `lifetime_early_bird` → `vn_ultimate`)
3. **Migration SQL:** `UPDATE users SET current_plan_id=<new> WHERE current_plan_id IN (<old list>);`
4. **Add validation:** `pricing.ts:getDailyTierLimit` throw warning nếu planId not in known set (hiện silent fallback 0)

- **Test:** Re-run audit query → all `current_plan_id` ∈ known set
- **Rollback:** SQL undo từ snapshot

### Fix 14: PHO-236 — Article gen 31% fail rate (INVESTIGATION)

⚠️ KHÔNG fix trực tiếp — cần data trước:

1. Add structured error logging trong `/api/research/ai-summary` article gen path → categorize: JSON parse / citation validation / token limit / provider error
2. Soak 7 ngày → analyze logs
3. Sau khi xác định root cause → fix theo category (likely Phase 1.5.x regression)

- **Estimated savings:** $2–5/tháng (low priority)

### Fix 15: PHO-237 — Allocation redesign (DEFERRED — sau Phase 2.1 ship)

⚠️ **Em (Claude Opus 4.7) propose số mới SAU KHI:**

- Phase 2.1 fixes (PHO-223, 225) ship lên prod ổn định
- Có 7 ngày `usage_logs` sạch (correct rates + correct metering)
- Verify `1 pt = $0.00004` consistent across 5+ users × 4 Tier 3 models

**Khi đó em sẽ propose:**

- Monthly allocation per plan (table 6 plans × tradeoff)
- Burn formula final: confirm `points = USD × 25,000` hoặc adjust constant `credits.ts:220`
- Hien review approve → Linear ticket update `pricing.ts:VN_PLANS.*.monthlyPoints` values

---

## Implementation Timeline

```
DAY 1 — Phase 2.1 P0 (parallel-safe):
  Sáng:  PHO-223 (seed) + PHO-226 (retry) + PHO-227 (atomic fail-closed)
  Chiều: PHO-224 (investigate paths a/b/c)
  Tối:   PHO-225 (pre-flight, depends PHO-223)
  Deploy: Canary 5% → 1h monitor → 100%

DAY 2-3 — Phase 2.2 P1:
  Day 2 sáng:  PHO-228 (TZ standardize, SQL function + 4 sites)
  Day 2 chiều: PHO-229 (embedding meter)
  Day 3:       PHO-230 (stream abort — Option A)

DAY 4 — Phase 2.3 P1:
  Sáng:  PHO-231 (PostHog $ai_*) + dashboard setup
  Chiều: PHO-232 ($exception tracking)

DAY 5 — Phase 2.4 P2:
  Sáng:  PHO-233 (user-A downgrade — sau Hien comm) + PHO-234 (vn_premium swap)
  Chiều: PHO-235 (orphan plan audit) + PHO-236 (article gen logging only)

DAY 6+ — Post-deploy:
  - 7 ngày soak → analyze usage_logs
  - PHO-237 allocation redesign (em propose, Hien approve)
```

## PR Strategy — 4 PRs (1 per Phase)

- **PR1:** `feat(billing): cost audit Phase 2.1 P0 quick wins` (5 fixes)
- **PR2:** `feat(billing): cost audit Phase 2.2 hardening` (3 fixes)
- **PR3:** `feat(observability): cost audit Phase 2.3 PostHog tracking` (2 fixes)
- **PR4:** `chore(billing): cost audit Phase 2.4 special cases` (4 fixes)

**Why split:** review nhanh (300–500 LoC/PR), rollback granular, canary deploy độc lập từng phase.

## Deploy Strategy (per PR)

1. Merge PR → Vercel auto preview deploy
2. Smoke test preview URL: 5 chat reqs (Tier 1/2/3) + 1 file upload
3. Promote → production canary 5% traffic
4. Monitor 1h — PostHog: error rate <0.5%, `tier_slot_db_error`=0, `$ai_generation` events flowing
5. Promote 100% nếu OK; revert nếu metric anomaly
6. Watch 24h — Vercel AI Gateway dashboard `$/h` trend

## Post-deploy Verification Checklist

- [ ] Vercel AI Gateway monthly cost giảm ≥40% (vs 30 ngày trước)
- [ ] DB `model_pricing` ≥13 active rows (`SELECT count(*) WHERE is_active=true`)
- [ ] Free user + Tier 3 model → expect 402 InsufficientQuota
- [ ] user-A downgrade succeed (PHO-233 SQL applied)
- [ ] PostHog `$ai_generation` events flowing (LLM observability dashboard populated)
- [ ] PostHog `$exception` events có `$exception_message` + `$exception_stack_trace` populated
- [ ] Counter reset đúng 00:00 VN (race test 06:50 → 07:10 VN, counter giữ nguyên)
- [ ] `usage_logs` coverage ≥95% requests (sample 5 random Tier 3 users 7 ngày)
- [ ] Conversion verify: 5 users × 4 T3 models → pts/USD ≈ 25,000 (±10%)
- [ ] No paid user complaint nghiêm trọng trong 7 ngày sau deploy

## Rollback Procedure (per Phase)

- **Phase 2.1:** `git revert <sha> && git push` + `DELETE FROM model_pricing WHERE created_by='phase-2-seed';`. User balances KHÔNG restore (data đúng vẫn giữ).
- **Phase 2.2:** `git revert <sha>` + `DROP FUNCTION IF EXISTS vietnam_date_string();`.
- **Phase 2.3:** revert PR3 (config-only, no DB change).
- **Phase 2.4:** restore Clerk metadata + SQL undo từ snapshot trước khi run.

## Communication Plan

⚠️ **Hien handle, KHÔNG Claude draft user-facing message.**

Touchpoints cần Hien:

- user-A (trước Fix 11): explain downgrade + refund nếu cần
- vn_premium user (sau Fix 12): explain cap reduction nếu họ complain
- All paying users (post 2.1, optional): announce Phở Points enforcement đã active

Channels: Email, Zalo, X/Facebook (build-in-public mode).
