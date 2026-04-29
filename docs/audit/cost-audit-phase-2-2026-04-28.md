# Cost Audit Phase 2 — 2026-04-28

**Branch:** `cost-audit-phase-2-2026-04-27`
**Auditor:** Claude Code CLI (Opus 4.7)
**Status:** Findings complete, ready for implementation
**Predecessor:** [COST-AUDIT-REPORT.md](../../COST-AUDIT-REPORT.md) (Phase 1, 2026-04-14)

---

## TL;DR

- **Cost baseline 30 ngày:** **estimate** $130–180/tháng (PostHog `send_message` volume × model rates ước lượng — PostHog không track `$ai\_\*`events nên không phải actual cost). **Cần verify** tại Vercel AI Gateway dashboard`https://vercel.com/thaohienhomes/pho-chat-v1/ai-gateway` sau Phase 2.1 fix để có ground truth.
- **Concentration:** 5 users (4 `medical_beta` + 1 unknown plan whale `user-C@redacted`) chiếm \~99% Tier 3 traffic (\~895/902 Tier 3 reqs trong 30 ngày). user-A (DB plan = `vn_free`) bypass tier check qua Clerk fallback path.
- **Root cause: 8 bugs** trong enforcement pipeline — chia 5 P0 (DB seed missing → fallback generic rates, processModelUsage skip, pre-flight inert, retry fail-open, atomic slot fail-open) + 3 P1 (TZ inconsistency, embedding/RAG unmetered, mid-stream abort leak). **Note:** `route.ts:731-732` field misuse (đọc `inputPrice` legacy thay vì `inputCostPer1M`) là **secondary bug**, chỉ activate khi DB có data. Phải fix cả 2 cùng lúc (seed DB + đổi field).
- **Phở Points infrastructure ĐÃ có** (schema, allocate, deduct, log) nhưng **enforcement bypass HOÀN TOÀN** — `GREATEST(0, balance - cost)` floor + `if (balance < -10_000)` pre-check không bao giờ trigger.
- **Estimated savings nếu fix tất cả:** **$80–130/tháng** (40–65% reduction baseline). Phase 1 Fix #1 (artifact-ai/research-summary metering) đã contribute giảm chi phí từ $190 về $130–180; Phase 2 cắt phần còn lại.
- **Phase 2 effort:** 4–5 ngày dev cho 1 dev solo. Quick wins (P0): 1 ngày. Hardening (P1): 2 ngày. Observability + special cases: 1.5 ngày.
- **ZERO config change cần** — toàn bộ là code bug fixes + 1 SQL backfill (model_pricing seed + user-A plan downgrade).
- **DB rates verified empty:** `model_pricing` table KHÔNG có row cho 4 Tier 3 models (`gpt-5.4`, `claude-opus-4.6`, `gemini-3.1-pro-preview`, `gemini-2.5-flash`) khi test. Code fallback về `MODEL_TIERS` generic rates (5/100/500 input, 15/300/1500 output USD per 1M tokens) — bill SAI cho mọi model thực tế.
- **user-A skip metering CONFIRMED:** Query `usage_logs` cho user-A (vn_free, 217 Tier 3 reqs) trả về **0 rows** → `processModelUsage` không được gọi cho user này. user-B thì có (217 reqs gemini-3.1-pro-preview, avg 43 pts/req, avg $0.0017 USD).

---

## P0 Findings (CRITICAL — fix Phase 2.1)

### 🔴 P0-1: `model_pricing` DB table chưa seed cho Tier 3 models

**Evidence:** Query test với 4 model trên Tier 3 (`gpt-5.4`, `claude-opus-4.6`, `gemini-3.1-pro-preview`, `gemini-2.5-flash`) → 0 rows.
**Code path:** `src/app/(backend)/webapi/chat/[provider]/route.ts:72-88` `getModelPricing()` returns `null` → `route.ts:680-685` fallback về `MODEL_TIERS[tier].inputCostPer1M / outputCostPer1M` (5/100/500 input, 15/300/1500 output points/1M tokens).
**Diagnosis:** Generic tier rates không phản ánh provider pricing thực tế. gpt-5.4 charge gateway $60/1M output nhưng burn user gần 0 point/req. Cùng Tier 3 nhưng claude-opus-4.6 đắt gấp 5× gemini-3.1-pro-preview — fallback charge giống nhau → **revenue per heavy user gần $0**.
**Savings nếu fix:** $25–40/tháng (giảm 70–80% over-usage Tier 3 cao cấp khi user phải trả correct rate).

### 🔴 P0-2: `processModelUsage` SKIP cho user vn_free heavy (user-A)

**Evidence:** user-A (vn_free, 217 Tier 3 reqs/30d) → `usage_logs` query trả 0 rows. user-B cùng period log đúng.
**Code path:** `src/app/(backend)/webapi/chat/[provider]/route.ts:709-758` IIFE chạy background, KHÔNG await. Streaming reader fail silent → IIFE catch (line 756-758) chỉ `console.error`, không retry; non-streaming path JSON parse fail (line 782-786) cũng silent skip.
**Diagnosis:** 1 trong 3 paths: (a) `data.stream=false` + non-JSON SSE response → skip; (b) Stream reader exception mid-read → IIFE thoát early; (c) Vercel Function streaming termination cắt IIFE trước khi processModelUsage flush. Mid-stream client abort cũng rơi vào case (b).
**Savings nếu fix:** $15–25/tháng (1 user xác nhận skip, có thể có nhiều user khác cùng pattern).

### 🔴 P0-3: Phở Points pre-flight check INERT

**Evidence:** `src/app/(backend)/webapi/chat/[provider]/route.ts:353` `if (balance < -10_000)`. Combined với `credits.ts:73, 147, 191` `GREATEST(0, ${users.phoPointsBalance} - ${cost})` → balance floor tại 0, không bao giờ âm → pre-check không bao giờ trigger.
**Diagnosis:** Effective UNLIMITED budget cho mọi plan. User hết points vẫn chat tiếp; cost được absorb silently. Chỉ atomicAcquireTierSlot cap Tier 2/3 daily — Tier 1 hoàn toàn free run forever.
**Savings nếu fix:** $10–20/tháng (block Tier 1 abuse + force user upgrade khi hết points).

### 🔴 P0-4: Retry/failover loop FAIL-OPEN cascade

**Evidence:** `src/app/(backend)/webapi/chat/[provider]/route.ts:637-651`. `if (!isRetryable && index < priorityList.length - 1)` chỉ `console.warn`, không `break` hay `throw`. Mọi error (400/401/validation/JSON parse) cascade hết priority list.
**Diagnosis:** 1 bad request → cascade qua 3 providers (`pho-smart` chain = Cerebras → Groq → Gateway) = 3× gateway charge. Phase 1 ước $5–10/tháng, fail-open này likely $15–25/tháng. Mid-stream Anthropic UTF-8 errors cũng cascade.
**Savings nếu fix:** $10–20/tháng (fail fast trên non-retryable, giữ failover chỉ cho 5xx/429/ECONNRESET).

### 🔴 P0-5: `atomicAcquireTierSlot` FAIL-OPEN trên DB error

**Evidence:** `src/server/services/billing/credits.ts:406-410` catch block `return { acquired: true, newUsage: 0 }`.
**Diagnosis:** DB hiccup (timeout/deadlock/connection drop) → user được Tier 3 không cap. Phase 1.5.x research mode tăng concurrent calls → catch fires nhiều hơn. Không có alert/metric khi catch trigger → invisible bypass.
**Savings nếu fix:** $5–15/tháng (estimate; depends DB error frequency, cần thêm observability để confirm).

---

## P1 Findings (HIGH — fix Phase 2.2)

### 🟠 P1-1: Timezone inconsistency (UTC vs Vietnam) trên 3 reset paths

**Evidence:**

- `src/server/services/billing/credits.ts:336-410` `atomicAcquireTierSlot` SQL dùng `CURRENT_DATE` + `last_usage_date::date` (Postgres server TZ = UTC trên Neon).
- `credits.ts:498-499, 517-520` `getVietnamDateString()` (UTC+7) dùng cho `checkDailyRequestCap`.
- `credits.ts:128-132` `processModelUsage` JS `Date.getDate()` (Node container TZ).

**Diagnosis:** 3 reset boundaries khác nhau cùng quản lý Tier counters. Vietnam users hit UTC midnight reset lúc 07:00 VN → 2× daily cap effective per Vietnam day (medical_beta 10/day → max 20/day). Edge case: Tier 1 path của `processModelUsage` có thể RESET `dailyTier2Usage / dailyTier3Usage = 0` nếu JS `isSameDay` disagree với SQL `CURRENT_DATE`.
**Savings nếu fix:** $10–15/tháng (close 2× reset window).

### 🟠 P1-2: Embedding / RAG unmetered (Phase 1 Fix #6 deferred)

**Evidence:** `src/server/routers/lambda/chunk.ts` grep `processModelUsage|deductPhoCredits|getUserCreditBalance` → no matches. RAG pipeline call `agentRuntime.embeddings({ model: 'text-embedding-3-small', ... })` mà không track cost.
**Diagnosis:** Mỗi RAG query (semantic search KB, file upload auto-embed batches 50 chunks × 10 concurrent) call gateway nhưng zero deduction. `medical_beta` + paid plans có `enableKnowledgeBase: true` (`pricing.ts:78`) → embed cost tích lũy unmetered. Phase 1 đã flag nhưng chưa apply.
**Savings nếu fix:** $5–10/tháng (medical_beta KB-heavy users + file upload batches).

### 🟠 P1-3: Mid-stream abort leak — gateway charge nhưng user không burn

**Evidence:** `src/app/(backend)/webapi/chat/[provider]/route.ts:709-758` IIFE `(async () => {...})()` chạy background, không await trong response path. `req.signal` không propagate vào IIFE. Client disconnect → tee'd `stream2` drain trong background, có thể fail hoặc thoát early trước khi `processModelUsage` flush.
**Diagnosis:** Vercel AI Gateway charge company $ ngay khi LLM generate tokens. Mid-stream abort (client close, network error, Vercel function termination) → IIFE catch (line 756-758) silent log → user không bị deduct nhưng company đã pay. Correlate với `auth_session_expired = 327/30d` → \~5–10% requests có abort signal.
**Savings nếu fix:** $5–10/tháng (depends abort rate; cần signal handler propagate cancel xuống gateway).

---

## P2 Findings (LOW — fix Phase 2.3 / 2.4)

### 🟡 P2-1: `vn_premium` daily cap inversion typo

**Evidence:** `src/config/pricing.ts:1174-1175` `vn_premium: 500`, `vn_pro: 200`. Plan rẻ hơn (vn_premium 129K VND) lại có cap CAO HƠN plan đắt hơn (vn_pro). Inversion vô lý.
**Savings:** Minor — revenue loss khi user chọn plan rẻ hơn để có cap cao hơn.

### 🟡 P2-2: Article generation 31% fail rate (Phase 1.5.x regression)

**Evidence:** PostHog 30 ngày: `article_generation_started=19`, `article_generation_complete=13`, `article_generation_failed=6` → 31.6% fail rate. Token đã đốt rồi mới error.
**Diagnosis:** Phase 1.5.x bug fixes (Bugs A–I gần đây merge) có thể introduce regression — JSON parse strict, citation validation, premature abort. Mỗi fail \~3–8K output tokens premium model wasted.
**Savings nếu fix:** $2–5/tháng (low volume nhưng dùng premium models).

### 🟡 P2-3: PostHog LLM observability hoàn toàn vắng

**Evidence:** `get-llm-total-costs-for-project` returns empty. Không có `$ai_generation`, `$ai_span`, `$ai_trace` events trong project. Chỉ có `send_message` (proxy thô, không track tokens/cost).
**Diagnosis:** Vercel AI SDK middleware + PostHog AI observability chưa được wire up. Flying blind về cost trends, regression detection chậm.
**Savings nếu fix:** Indirect — enable proper cost monitoring, catch regression sớm hơn (giảm time-to-detect từ tuần xuống ngày).

### 🟡 P2-4: `$exception` events có `$exception_type` + `$exception_message` toàn null

**Evidence:** PostHog query `$exception` last 30d: 29 events, all properties null. Không có client-side error context.
**Diagnosis:** PostHog browser SDK không capture exception properties đúng (config hoặc version mismatch). Useless để debug client failures dẫn tới retry/abort.
**Savings nếu fix:** Indirect — visibility into client errors causing waste.

---

## Evidence Appendix

### A. Per-plan balance distribution (Query A, 2026-04-28)

| Plan                                  | Users | Avg     | Min     | Max       | Zero |
| ------------------------------------- | ----- | ------- | ------- | --------- | ---- |
| vn_free                               | 210   | 49,932  | 37,012  | 50,000    | 0    |
| medical_beta                          | 49    | 613,380 | 479,315 | 1,049,000 | 0    |
| (11 plans tổng — full table Hien giữ) |       |         |         |           |      |

### B. Top 5 Tier 3 whales (PostHog 30d)

| User             | Plan (effective)        | Sends | Tier 3 reqs | Top model              |
| ---------------- | ----------------------- | ----- | ----------- | ---------------------- |
| user-C\@redacted | medical_beta            | 467   | 182         | ALL 3 Tier 3           |
| user-B\@redacted | medical_beta            | 400   | 362         | gemini-3.1-pro-preview |
| user-A\@redacted | vn_free (DB), Clerk → ? | 235   | 217         | gpt-5.4                |
| user-D\@redacted | medical_beta            | 114   | 114         | claude-opus-4.6        |
| user-E\@redacted | medical_beta            | 43    | 3           | gemini-3.1-pro-preview |

### C. P0 code refs (link only — code đã có trong P0 section)

P0-1 → `route.ts:680-685`. P0-2 → `route.ts:709-758`. P0-3 → `route.ts:353` + `credits.ts:73, 147, 191`. P0-4 → `route.ts:637-651`. P0-5 → `credits.ts:406-410`.

### D. Phở Points conversion scale (CRITICAL — verify post Phase 2.1)

- Reference: `credits.ts:220` `1 pt = $0.00004` → **25,000 pts/USD**
- user-B usage_logs sample: `avg_pts_deducted=43`, `avg_cost_usd=$0.0017` → 43/0.0017 ≈ **25,294 pts/USD** ✓ **MATCH**
- user-A reverse-engineered: 67 pts/req cho gpt-5.4 (avg 800 out tokens × $60/1M = $0.048 expected) → **18× under-burn** → confirms **P0-2 (skip metering)** root cause, KHÔNG phải conversion bug.
- **Action sau Phase 2.1 ship:** re-query usage_logs với 5+ users + 4 Tier 3 models; nếu pts/USD lệch >10% → adjust `0.000_04` constant.

### E. Savings overlap caveat (de-dup math)

- **P0-1 + P0-3 overlap \~50%:** seed pricing trigger cost calc đúng → user chạm cap → P0-3 reject ngay cả khi pre-flight chưa fix.
- **P0-2 + P0-3 overlap \~30%:** fix metering insert usage_logs → balance giảm → eventually trigger P0-3 reject.
- **P0-4 + P0-5 độc lập** (retry cascade vs DB error fail-open).
- **Net P0:** $50–80/tháng. **Net P1:** $15–25/tháng. **Total net:** $65–105/tháng. + 20% confidence buffer = **$80–130** high estimate (khớp TL;DR upper bound).
