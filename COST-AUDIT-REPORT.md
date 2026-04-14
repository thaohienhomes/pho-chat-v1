# PHO.CHAT V1 — COST CONTROL AUDIT REPORT

**Date:** 2026-04-14
**Auditor:** Claude Opus 4.6 (automated code audit)
**Scope:** All AI-related API routes, billing logic, subscription gating, and provider configuration
**Codebase:** `pho-chat-v1` (Next.js + Vercel AI Gateway)

---

## 1. EXECUTIVE SUMMARY

| Metric                            | Value                   |
| --------------------------------- | ----------------------- |
| **Total Spend (observed period)** | \~$561.97               |
| **Estimated Monthly Run Rate**    | \~$190/month            |
| **Critical Issues Found**         | 3                       |
| **High Issues Found**             | 3                       |
| **Medium Issues Found**           | 3                       |
| **Estimated Recoverable Savings** | $60–$100/month (31–53%) |

### Top Issues by Cost Impact

| #   | Issue                                                                            | Severity | Est. Monthly Impact |
| --- | -------------------------------------------------------------------------------- | -------- | ------------------- |
| 1   | `medical_beta` users have FULL Tier 1+2+3 access for $3.50/month (999k VND/year) | CRITICAL | \~$40–60 waste      |
| 2   | `/api/artifact-ai` — no credit deduction (fire-and-forget)                       | CRITICAL | Unknown (unmetered) |
| 3   | `/api/research/ai-summary` — no credit deduction (fire-and-forget)               | CRITICAL | Unknown (unmetered) |
| 4   | No per-user spending cap (single user spent $171 in observed period)             | HIGH     | \~$20–40 overspend  |
| 5   | `/api/v1/chat` missing `user` param in AI SDK call (untagged gateway requests)   | HIGH     | Telemetry gap       |
| 6   | Embedding costs not tracked or deducted from user credits                        | HIGH     | \~$5–10 unmetered   |
| 7   | `medical_beta` Tier 3 limit (10/day) allows Claude Opus 4.6 + GPT-5.4 access     | MEDIUM   | \~$15–25            |
| 8   | Retry/failover loop can make 3+ provider calls per user request                  | MEDIUM   | \~$5–10 extra       |
| 9   | Token estimation in `/api/v1/chat` uses `length/4` heuristic (inaccurate)        | LOW      | Minor               |

---

## 2. ARCHITECTURE MAP

### 2.1 API Routes (Complete)

```
Client Request
    │
    ├── POST /webapi/chat/[provider]     ← MAIN CHAT (95%+ of AI spend)
    │       │
    │       ├── Auth: checkAuth() → Clerk JWT validation
    │       ├── Subscription: checkTrialAccess()
    │       ├── Credits: getUserCreditBalance() → prefetch
    │       ├── Tier: checkTierAccess() → atomicAcquireTierSlot()
    │       ├── Model: phoGatewayService.resolveProviderList()
    │       ├── Call: runtime.chat() → Vercel AI Gateway
    │       └── Deduct: processModelUsage() → post-completion
    │
    ├── POST /api/v1/chat               ← PUBLIC REST API (API key auth)
    │       │
    │       ├── Auth: x-api-key header → SHA-256 hash lookup
    │       ├── Rate Limit: 60 req/min per key
    │       ├── Credits: deductPhoCredits() → PRE-FLIGHT atomic deduction
    │       ├── Model: phoGatewayService.resolveProviderList()
    │       ├── Call: runtime.chat() → Vercel AI Gateway
    │       └── Refund: if all providers fail → refund points
    │
    ├── POST /api/artifact-ai            ← ARTIFACT IFRAMES (⚠️ NO BILLING)
    │       │
    │       ├── Auth: Clerk session
    │       ├── Credits: ❌ NONE
    │       ├── Model: gemini-2.5-flash (default)
    │       └── Call: runtime.chat() → phoGateway failover
    │
    ├── POST /api/research/ai-summary    ← RESEARCH MODE (⚠️ NO BILLING)
    │       │
    │       ├── Auth: Clerk session
    │       ├── Credits: ❌ NONE
    │       ├── Model: gemini-2.5-flash (default)
    │       └── Call: runtime.chat() → phoGateway failover
    │
    ├── POST /api/ai-rendering           ← FAL API (image gen, virtual staging)
    │       │
    │       ├── Auth: Clerk session
    │       ├── Credits: Fixed Pho Points per action (20–80 pts)
    │       ├── Daily Limit: 10 renders/user/day (in-memory)
    │       └── Call: FAL API (not Vercel AI Gateway)
    │
    └── tRPC chunk.semanticSearchForChat  ← RAG EMBEDDINGS (⚠️ NO BILLING)
            │
            ├── Auth: subscriptionAuth middleware
            ├── Credits: ❌ NONE (embedding cost not tracked)
            ├── Model: text-embedding-3-small (OpenAI → remapped to gateway)
            └── Cache: YES (messageQueries table)
```

### 2.2 Provider Configuration

**Primary Gateway:** Vercel AI Gateway (`https://ai-gateway.vercel.sh/v1`)

All direct providers are disabled and remapped through the gateway:

| Provider      | Status          | Remapping                                  |
| ------------- | --------------- | ------------------------------------------ |
| `google`      | Disabled direct | → `vercelaigateway` (prefix: `google/`)    |
| `openai`      | Disabled direct | → `vercelaigateway` (prefix: `openai/`)    |
| `anthropic`   | Disabled direct | → `vercelaigateway` (prefix: `anthropic/`) |
| `deepseek`    | Disabled direct | → `vercelaigateway` (prefix: `deepseek/`)  |
| `xai`         | Disabled direct | → `vercelaigateway` (prefix: `xai/`)       |
| `vertexai`    | Disabled direct | → `vercelaigateway`                        |
| `groq`        | Active          | Direct API via Cloudflare Gateway          |
| `cerebras`    | Active          | Direct API via Cloudflare Gateway          |
| `fireworksai` | Active          | Direct API                                 |
| `togetherai`  | Active          | Direct API                                 |

**File:** `src/server/services/phoGateway/index.ts:258-265`

**Environment Variables (key ones):**

- `AI_GATEWAY_API_KEY` — Vercel AI Gateway
- `GROQ_API_KEY` — Groq inference
- `CEREBRAS_API_KEY` — Cerebras inference
- `FIREWORKS_API_KEY` — Fireworks AI
- `TOGETHER_API_KEY` — Together AI

### 2.3 Model Router — Logical Model Mapping

| Logical Model | Primary Provider                    | Failover Chain                                                    |
| ------------- | ----------------------------------- | ----------------------------------------------------------------- |
| `pho-fast`    | Groq (`llama-3.1-8b-instant`)       | → Cerebras (`llama3.1-8b`) → Gateway (`gemini-2.0-flash`)         |
| `pho-pro`     | Groq (`llama-3.3-70b-versatile`)    | → Gateway (`gemini-2.5-flash`)                                    |
| `pho-smart`   | Cerebras (`llama3.1-70b`)           | → Groq (`llama-3.3-70b-versatile`) → Gateway (`gemini-2.5-flash`) |
| `pho-vision`  | Gateway (`google/gemini-2.5-flash`) | (single provider)                                                 |

**File:** `src/server/services/phoGateway/index.ts:130-176`

### 2.4 Tier System — Model Classification

| Tier                  | Points/Message | Input Cost/1M tokens | Output Cost/1M tokens | Example Models                                             |
| --------------------- | -------------- | -------------------- | --------------------- | ---------------------------------------------------------- |
| **Tier 1** (Budget)   | 5 pts          | 5 pts                | 15 pts                | Gemini 2.0 Flash, Llama 3.1 8B, GPT-4o-mini, DeepSeek Chat |
| **Tier 2** (Standard) | 150 pts        | 100 pts              | 300 pts               | Claude Sonnet 4.6, GPT-5.2, Gemini 2.5 Flash/Pro, Grok 4   |
| **Tier 3** (Premium)  | 1,000 pts      | 500 pts              | 1,500 pts             | Claude Opus 4.6, GPT-5.4, Gemini 3.1 Pro, o3               |

**File:** `src/config/pricing.ts:678-874`

---

## 3. VULNERABILITY ANALYSIS

### 3.1 \[CRITICAL] Unmetered Routes — `/api/artifact-ai` and `/api/research/ai-summary`

**Files:**

- `src/app/api/artifact-ai/route.ts` (162 lines)
- `src/app/api/research/ai-summary/route.ts` (234 lines)

**Issue:** Both routes call Vercel AI Gateway (via `phoGatewayService.remapProvider()`) but have **zero credit deduction, zero tier checking, zero rate limiting**. Any authenticated user can call these endpoints unlimited times.

**Evidence (artifact-ai):**

- Line 30: `POST` handler starts
- Line 53: Default model is `gemini-2.5-flash` (Tier 2 — 150 pts/msg equivalent)
- Line 60-67: Builds provider chain with gateway failover
- Line 83: Calls `runtime.chat()` — **incurs Vercel AI Gateway cost**
- Lines 30-161: **No `getUserCreditBalance()`, no `processModelUsage()`, no `checkTierAccess()`**

**Evidence (research/ai-summary):**

- Line 53: Default model is `gemini-2.5-flash` (Tier 2)
- Line 91: Calls `runtime.chat()` — **incurs gateway cost**
- Lines 30-234: **No billing logic at all**

**Impact:** Every artifact iframe interaction and every research summary is a free gateway call. If a medical_beta user triggers 100 research summaries/day using `gemini-2.5-flash`, that's \~$0.50–$2.00/day unbilled per user.

**Estimated Monthly Impact:** Unknown but potentially $20–50/month across all users.

---

### 3.2 \[CRITICAL] `medical_beta` Plan — Excessive Access for Revenue

**File:** `src/config/pricing.ts:601-607`

**Issue:** `medical_beta` users pay 999,000 VND/year (\~$41/year, \~$3.42/month) but receive:

```typescript
// pricing.ts:601-607
medical_beta: {
    allowedTiers: [1, 2, 3],        // ← ALL tiers including premium
    dailyLimits: { tier2: -1, tier3: 10 },  // ← Unlimited Tier 2, 10x Tier 3/day
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS, ...TIER3_MODELS],  // ← ALL models
}
```

**What medical_beta users can access:**

- **Unlimited Tier 2/day:** Claude Sonnet 4.6, GPT-5.2, Gemini 2.5 Pro, Grok 4 — each costing $0.003–$0.015/1K output tokens
- **10 Tier 3/day:** Claude Opus 4.6 ($0.075/1K output), GPT-5.4 ($0.06/1K output) — the most expensive models
- **1,000,000 Pho Points/month** (equivalent to vn_premium which costs 149k VND/month)

**Actual cost data from your top users:**

| User                   | Plan                | Spend         | Revenue from Plan           |
| ---------------------- | ------------------- | ------------- | --------------------------- |
| nga.ntv@               | medical_beta (FREE) | $128.02       | $0                          |
| bachcvp1316@           | medical_beta (FREE) | $80.06        | $0                          |
| bshuyenks@             | medical_beta (FREE) | $44.40        | $0                          |
| vuvannga1510@          | medical_beta (FREE) | $15.32        | $0                          |
| **Total medical_beta** |                     | **\~$267.80** | **\~$14** (4 users × $3.50) |

**Net loss from medical_beta:** \~$253/month (71% of total spend!)

**Root cause:** `medical_beta` was designed as a promotional tier for doctors (promo code activation, `src/app/api/promo/activate/route.ts:22`) but grants premium-tier access at a fraction of the cost.

---

### 3.3 \[CRITICAL] No Per-User Spending Cap

**Issue:** There is no mechanism to cap individual user spend. A single user (`vuthanhhuong120898@`) accumulated $171.43 in the observed period.

**Current safeguards (insufficient):**

- Pho Points balance: Users can overdraft to -10,000 VND (`src/app/(backend)/webapi/chat/[provider]/route.ts:352-360`)
- Daily Tier 3 limit: 10–100 requests/day per plan
- Monthly Pho Points: 1M for medical_beta, 2M for pro

**Missing:**

- No hard $ spending cap per user per month
- No alert when user exceeds cost threshold
- Pho Points don't accurately reflect actual $ cost (5 pts vs $0.003 for Tier 2 output)

---

### 3.4 \[HIGH] Missing User Tag in `/api/v1/chat` SDK Calls

**File:** `src/app/api/v1/chat/route.ts:235-240`

**Issue:** The AI SDK call does not include the `user` parameter:

```typescript
// Line 235-240 — NO user ID in the chat call
const runtime = await initModelRuntimeWithUserPayload(provider, {});
const response = await runtime.chat({
  messages: messages.map((m: any) => ({ content: m.content, role: m.role })),
  model: modelId,
  temperature: body.temperature ?? 0.6,
} as any);
```

**Compare with main route** (`src/app/(backend)/webapi/chat/[provider]/route.ts:577`):

```typescript
// Line 577 — User ID IS passed
const response = await currentRuntime.chat({ ... }, { user: jwtPayload.userId, ...traceOptions, signal: req.signal });
```

**Impact:** Requests from `/api/v1/chat` appear as untagged in Vercel AI Gateway telemetry. This likely explains the **$24.05 from 1,748 requests with empty user tag** in your gateway data.

---

### 3.5 \[HIGH] Embedding Costs Not Tracked

**File:** `src/server/routers/lambda/chunk.ts:146-220`

**Issue:** Semantic search embeddings call the AI Gateway (or OpenAI directly) but costs are never deducted from user credits.

```typescript
// chunk.ts — embedding call with NO cost tracking
const embeddings = await agentRuntime.embeddings({
  dimensions: 1024,
  input: userQuery,
  model: resolvedModel, // text-embedding-3-small
});
```

**When triggered:**

- Every RAG query when knowledge base is enabled
- File upload auto-embedding (batches of 50 chunks × 10 concurrent)
- Default model: `text-embedding-3-small` ($0.02/1M tokens)

**Impact:** Low per-call cost but unmetered volume. With active knowledge base users, estimate \~$5–10/month untracked.

---

### 3.6 \[HIGH] No Request-Level Rate Limiting on Main Chat Route

**File:** `src/app/(backend)/webapi/chat/[provider]/route.ts`

**Issue:** The main chat route (`/webapi/chat/[provider]`) has **no rate limiter**. Rate limiting exists only for:

- `/api/v1/chat` — 60 req/min per API key (`src/app/api/v1/chat/route.ts:13-26`)
- Payment routes — 30 IP / 10 user per minute
- Newsletter — 5 IP / 3 user per hour

The primary chat endpoint relies solely on:

- Tier daily limits (Tier 2/3 only — Tier 1 has NO daily limit)
- Pho Points balance (overdraft allowed to -10k)

**Impact:** A free user could theoretically send hundreds of Tier 1 messages per minute, each costing the gateway \~$0.0001–$0.001. Automated abuse or a buggy client loop could generate significant cost.

---

### 3.7 \[MEDIUM] Duplicate URL Paths — Not Duplicate Billing

**Finding:** Vercel runtime logs show requests to both `/webapi/chat/vercelaigateway` and `/webapi/chat/vertexai`.

**Explanation (NOT a bug):** The `[provider]` dynamic segment captures the provider name from the URL. When a client sends `provider=vertexai`, the handler calls `remapProvider('vertexai', model)` which remaps to `vercelaigateway` (line 264 of phoGateway). So both URL paths hit the **same handler** and ultimately call the **same gateway**.

**However:** If the client-side code is sending BOTH a `vercelaigateway` request AND a `vertexai` request for the same message, that IS duplicate billing. Investigate the frontend `fetch` call in the chat store to confirm only ONE request is sent per message.

---

### 3.8 \[MEDIUM] Failover Loop Can Multiply API Calls

**File:** `src/app/(backend)/webapi/chat/[provider]/route.ts:537-637`

**Issue:** The provider failover loop retries on status codes 500, 429, 502, 503, 504 and `ProviderBizError`. Each attempt is a separate AI API call that may incur cost at the gateway level.

```typescript
// Lines 615-628 — retry on specific errors
const isRetryable =
  [500, 429, 502, 503, 504].includes(status) ||
  errorType === AgentRuntimeErrorType.ProviderBizError;
```

**Mitigating factor:** Credits are only deducted on successful completion (`processModelUsage()` runs post-response). Failed attempts cost the project at the gateway level but don't double-charge the user.

**Impact:** Moderate — perhaps $5–10/month in wasted gateway calls on retries. Low priority but worth monitoring.

---

### 3.9 \[MEDIUM] Error 471 / Gateway Errors — Wasted Spend?

**Assessment:** Based on code review, credits are deducted ONLY after successful response via `processModelUsage()`. Failed requests (including 471 errors) do NOT trigger credit deduction. However, the Vercel AI Gateway may still charge the project for the initial request attempt.

**Auth Order (Safe):**

1. `checkAuth()` validates JWT — line 37-170 of `middleware/auth/index.ts`
2. `getUserCreditBalance()` prefetches balance — line 343-363 of route.ts
3. `checkTierAccess()` validates tier + acquires atomic slot — line 408-502
4. Only then: `runtime.chat()` makes the AI call — line 577

Expired Clerk sessions are caught at step 1 before any AI calls.

---

## 4. CONFIGURATION ISSUES

### 4.1 Pho Points Don't Reflect Actual $ Cost

The points system (5/150/1,000 per tier message) is a rough approximation. Actual cost varies wildly within a tier:

| Model             | Tier | Points/msg | Actual $/msg (1K output) |
| ----------------- | ---- | ---------- | ------------------------ |
| Gemini 2.0 Flash  | 1    | 5          | \~$0.0004                |
| GPT-4o-mini       | 1    | 5          | \~$0.0006                |
| Claude Sonnet 4.6 | 2    | 150        | \~$0.015                 |
| Gemini 2.5 Pro    | 2    | 150        | \~$0.010                 |
| Claude Opus 4.6   | 3    | 1,000      | \~$0.075                 |
| GPT-5.4           | 3    | 1,000      | \~$0.060                 |

Within Tier 2, Claude Sonnet 4.6 costs \~1.5x more than Gemini 2.5 Pro but costs the user the same points. The `calculatePointsFromTokens()` function (pricing.ts:1057) does token-based calculation, but the flat `pointsPerMessage` is used for tier access checks.

### 4.2 Free Tier Logic

**File:** `src/server/services/billing/credits.ts:152-177`

Free users (`vn_free`) get:

- 5 free Tier 1 requests/day (no points deducted)
- 50,000 points/month
- Tier 1 access ONLY (`pricing.ts:619-624`)
- After 5 free requests: charged from Pho Points balance

This is well-gated. Free users cannot access Tier 2/3 models.

### 4.3 `medical_beta` Points Reset

**File:** `scripts/reset-medical-beta-points.ts`

A manual script exists to reset medical_beta users' points to 500,000. This suggests points balances have been manually managed, not the configured 1,000,000/month.

**Discrepancy:**

- `pricing.ts:88`: `monthlyPoints: 1_000_000`
- `scripts/reset-medical-beta-points.ts:47`: Resets to 500,000
- `src/app/[variants]/(main)/settings/usage/features/BillingInfo.tsx:120`: Shows `monthlyPoints: 500_000`

This inconsistency means medical_beta users may have different effective budgets depending on which code path runs.

---

## 5. RECOMMENDED FIXES (Priority Order)

### Fix 1: Add Credit Deduction to Unmetered Routes — Impact: saves \~$20–50/month

**Files to change:**

- `src/app/api/artifact-ai/route.ts`
- `src/app/api/research/ai-summary/route.ts`

**Recommended change:** Add the same billing flow as the main chat route:

1. Import `getUserCreditBalance`, `checkTierAccess`, `processModelUsage` from billing service
2. Look up user's plan from Clerk metadata or DB
3. Check tier access for the requested model (gemini-2.5-flash = Tier 2)
4. Deduct credits post-completion using `processModelUsage()`

**Minimum viable fix:** At minimum, add a request counter and daily limit (e.g., 50 artifact calls/day, 20 research summaries/day).

---

### Fix 2: Restrict `medical_beta` Model Access — Impact: saves \~$40–60/month

**File to change:** `src/config/pricing.ts:601-607`

**Option A (Recommended):** Remove Tier 3 access entirely

```typescript
medical_beta: {
    allowedTiers: [1, 2],           // Remove Tier 3
    dailyLimits: { tier2: 30 },     // Cap Tier 2 at 30/day (same as vn_basic)
    defaultModel: 'llama-3.1-8b-instant',
    defaultProvider: 'groq',
    models: [...TIER1_MODELS, ...TIER2_MODELS],  // No TIER3_MODELS
}
```

**Option B (Moderate):** Keep Tier 3 but severely limit

```typescript
medical_beta: {
    allowedTiers: [1, 2, 3],
    dailyLimits: { tier2: 50, tier3: 3 },  // Reduce Tier 3 from 10 → 3/day
    ...
}
```

**Option C (Soft cap):** Reduce monthly Pho Points to 500,000 (matching the actual reset script) and keep current tier access.

---

### Fix 3: Add User Tag to `/api/v1/chat` — Impact: fixes telemetry gap

**File to change:** `src/app/api/v1/chat/route.ts:236`

**Current code (line 236):**

```typescript
const response = await runtime.chat({
  messages: messages.map((m: any) => ({ content: m.content, role: m.role })),
  model: modelId,
  temperature: body.temperature ?? 0.6,
} as any);
```

**Recommended change:**

```typescript
const response = await runtime.chat(
  {
    messages: messages.map((m: any) => ({ content: m.content, role: m.role })),
    model: modelId,
    temperature: body.temperature ?? 0.6,
  } as any,
  { user: user.clerkUserId },
);
```

---

### Fix 4: Add Rate Limiting to Main Chat Route — Impact: prevents abuse

**File to change:** `src/app/(backend)/webapi/chat/[provider]/route.ts`

Add the existing `apiRateLimiter` (from `src/middleware/rate-limit.ts`) to the main chat handler. Suggested limits:

- Free tier: 10 requests/minute
- Paid tier: 30 requests/minute
- medical_beta: 20 requests/minute

---

### Fix 5: Add Per-User Monthly Spending Cap — Impact: prevents runaway spend

**Recommended:** Add a `monthlySpendCapUSD` field to the plan config:

| Plan         | Suggested Cap |
| ------------ | ------------- |
| vn_free      | $1/month      |
| vn_basic     | $5/month      |
| medical_beta | $10/month     |
| vn_premium   | $20/month     |
| vn_pro       | $50/month     |
| vn_ultimate  | $100/month    |

Enforce in `processModelUsage()` by summing `usageLogs` for current month and blocking if cap reached.

---

### Fix 6: Track Embedding Costs — Impact: \~$5–10/month metering

**File to change:** `src/server/routers/lambda/chunk.ts`

After the embedding call (around line 170), add a `processModelUsage()` call with the embedding model's token count and cost.

---

## 6. COST PROJECTION

| Scenario                                      | Est. Monthly Cost | Savings   |
| --------------------------------------------- | ----------------- | --------- |
| **Current (no changes)**                      | \~$190/month      | —         |
| **After Fix 1** (meter artifact + research)   | \~$170/month      | \~$20     |
| **After Fix 1 + 2** (+ restrict medical_beta) | \~$120/month      | \~$70     |
| **After Fix 1 + 2 + 4** (+ rate limiting)     | \~$110/month      | \~$80     |
| **After Fix 1 + 2 + 4 + 5** (+ spending caps) | \~$90–100/month   | \~$90–100 |

---

## 7. DETAILED FILE INDEX

All files referenced in this audit:

| File                                                | Purpose                                                    |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `src/app/(backend)/webapi/chat/[provider]/route.ts` | Main chat handler (billing, tier check, provider failover) |
| `src/app/api/v1/chat/route.ts`                      | Public REST API (API key auth, pre-flight deduction)       |
| `src/app/api/artifact-ai/route.ts`                  | Artifact iframe AI calls (**NO BILLING**)                  |
| `src/app/api/research/ai-summary/route.ts`          | Research mode AI calls (**NO BILLING**)                    |
| `src/app/api/ai-rendering/route.ts`                 | FAL API image generation (fixed points)                    |
| `src/server/services/billing/credits.ts`            | Core billing: credit deduction, tier slots, usage logging  |
| `src/server/services/phoGateway/index.ts`           | Provider routing, logical models, remapping                |
| `src/server/services/subscription/index.ts`         | Subscription validation, trial access                      |
| `src/server/modules/CostOptimization/index.ts`      | Model cost definitions, VND pricing                        |
| `src/config/pricing.ts`                             | Plan configs, tier definitions, model access control       |
| `src/app/(backend)/middleware/auth/index.ts`        | Clerk auth wrapper, subscription check                     |
| `src/server/routers/lambda/chunk.ts`                | Semantic search + embedding pipeline                       |
| `src/middleware/rate-limit.ts`                      | In-memory rate limiter (used by v1/chat only)              |
| `packages/const/src/settings/llm.ts`                | Default embedding model config                             |
| `packages/database/src/schemas/rag.ts`              | pgvector embeddings schema                                 |

---

## 8. SECURITY NOTES

- No hardcoded API keys found in source code (keys loaded from env vars via `src/envs/llm.ts`)
- Clerk JWT validation happens BEFORE any AI calls — no auth bypass path found
- Atomic tier slot acquisition prevents race condition abuse
- Pre-flight balance check (with -10k VND overdraft) prevents excessive credit drain on main route
- `/api/v1/chat` has proper refund logic if all providers fail

---

## 9. APPENDIX: medical_beta Revenue vs. Cost Analysis

**Revenue:**

- Plan price: 999,000 VND/year = \~$41.30/year = \~$3.44/month per user
- Estimated 4 active medical_beta users = \~$13.75/month revenue

**Cost (from your data):**

- 4 medical_beta users consumed \~$267.80 in observed period (\~3 months)
- \~$89.27/month in AI costs

**Net loss: \~$75.52/month** from medical_beta alone

**Break-even analysis:**

- At current usage, medical_beta would need to cost \~$22/month ($267/year) per user to break even
- Or: restrict to Tier 1 only (cost \~$0.50/user/month) to be profitable at current pricing

---

_End of audit report. All findings are based on static code analysis only — no code was modified during this audit._
