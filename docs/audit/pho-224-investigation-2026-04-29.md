# PHO-224 Investigation Report — `processModelUsage` skip / `usage_logs` zero rows

**Date:** 2026-04-29
**Branch:** `investigate/pho-224-process-model-usage-skip`
**Investigator:** Claude (code-only evidence, no Vercel logs / DB access)

---

## Symptom

User `vuthanhhuong`:

- PostHog: 217 `send_message` events in last 30 days, all `model = gpt-5.4` (Tier 3), all `status = success`.
- Database: **0 rows** in `usage_logs` for this user.

Symptom framing: user appears to skip metering → free Tier 3.

---

## TL;DR root cause

**`src/server/services/billing/credits.ts:141-155`** — `processModelUsage` returns early at line 154 when `tierSlotAlreadyAcquired === true && (tier === 2 || tier === 3)`, **before** the `usage_logs` insert block at line 217. Every Tier 2/3 request that passed the atomic slot check writes to `users.phoPointsBalance` but never to `usage_logs`. PostHog event count and `usage_logs` count diverge perfectly.

This is a separate bug from PHO-223 (missing pricing). Combined with PHO-223 (where `cost = 0` because no pricing row existed for `gpt-5.4` until 2026-04-29), the user paid **zero points AND** had **zero metering rows** — full "free Tier 3" behavior.

---

## Hypotheses tested

### A. Provider routing mismatch — gpt-5.4 routed away from metering path

**Verdict:** ❌ DOES NOT HOLD

**Evidence:**

- `gpt-5.4` is registered as Tier 3 in `src/config/pricing.ts:514-515` and `src/config/pricing.ts:862-863`.
- Provider mapping is set in `src/server/services/phoGateway/index.ts:137-140` → routes via `vercelaigateway`.
- The chat route file `src/app/(backend)/webapi/chat/[provider]/route.ts` is provider-agnostic (handles all providers including `vercelaigateway`). No early-return on provider name.
- `processModelUsage` is called identically for all providers at line 749 (streaming) and 816 (non-streaming).

There is no provider-based skip in the chat flow.

---

### B. Clerk metadata override — flag in `publicMetadata` skips metering

**Verdict:** ❌ DOES NOT HOLD

**Evidence:**

- Only one read of `publicMetadata` in chat route: `src/app/(backend)/webapi/chat/[provider]/route.ts:424` — reads `clerkUser.publicMetadata?.planId` for plan resolution only, NOT to skip metering.
- Repo-wide grep for `skipMetering | bypassMetering | noMetering` in chat route → no matches.
- `processModelUsage` itself does not read any Clerk metadata (only DB user row).

No metadata-driven bypass exists in the metering path.

---

### C. Try/catch silent swallow — error before processModelUsage runs

**Verdict:** ⚠️ PARTIALLY HOLDS but does NOT explain 217 consecutive misses

**Evidence:**

- `src/app/(backend)/webapi/chat/[provider]/route.ts:782-834` (non-streaming branch) has nested `try { JSON.parse() } catch { responseData = null; }` (line 787-793). If response is SSE/non-JSON, metering is silently skipped with a `console.warn`.
- Outer `try { ... } catch (e) { console.error(...) }` at line 782 + 832-834 swallows ALL errors with only a log line.
- `processModelUsage` itself wraps everything in `try/catch` (`credits.ts:108`, `credits.ts:239-241`) — any DB error becomes a silent `console.error`.

**Why it's not the primary cause:** 217 events all `status = success` in PostHog. If JSON parse failed 217 times in a row, there would be 217 `console.warn` lines in Vercel logs (not "successful sends"). Sporadic — yes; consistent over 30 days — no.

This is a contributing weakness (silent failure modes hide bugs) but not THE bug.

---

### D. IIFE background race — streaming branch fire-and-forget

**Verdict:** ⚠️ PARTIALLY HOLDS for streaming responses, but does NOT explain 217 consecutive misses

**Evidence:**

- `src/app/(backend)/webapi/chat/[provider]/route.ts:710-766` — streaming branch tees the response and processes audit in fire-and-forget IIFE (line 714: `(async () => { ... })()` with NO `await`).
- The IIFE reads `stream2` to accumulate text, then calls `processModelUsage` at line 749.
- If Vercel cancels the function after returning `stream1` to the client (timeout, request cancellation, or hot reload), the IIFE may not finish reading `stream2` → `processModelUsage` never runs.
- `try/catch` inside IIFE (line 715, 763-765) only logs `console.error` on failure — no fallback metering.

**Why it's not the primary cause:** Same as Hypothesis C — 217 successful PostHog events with 0 metering rows is too consistent to be a race condition. A race would show \~5-20% loss, not 100%.

This is a real architectural risk but not THE bug.

---

### 🚨 E. UNCOVERED HYPOTHESIS — Early return before `usage_logs` insert (PRIMARY ROOT CAUSE)

**Verdict:** ✅ HOLDS — this is the bug.

**Evidence:**

`src/server/services/billing/credits.ts:139-155`:

```typescript
// If tier 2/3 slot was already acquired atomically by checkTierAccess,
// only handle credit deduction — don't touch tier counters or lastUsageDate
if (tierSlotAlreadyAcquired && (tier === 2 || tier === 3)) {
  if (cost > 0) {
    await db
      .update(users)
      .set({
        lifetimeSpent: sql`${users.lifetimeSpent} + ${cost}`,
        phoPointsBalance: sql`GREATEST(0, ${users.phoPointsBalance} - ${cost})`,
      })
      .where(eq(users.id, userId));
    console.log(
      `[Credits] Deducted ${cost} Credits (Tier ${tier}, atomic slot). User: ${userId}`,
    );
  }
  return;  // ← EARLY RETURN — skips the usage_logs insert at line 217
}
```

`usage_logs` insert is at `credits.ts:216-238` — UNREACHABLE for the Tier 2/3 atomic-slot path.

**Trace for vuthanhhuong's request:**

1. User sends message with `model = gpt-5.4` (Tier 3).
2. Chat route calls `checkTierAccess(userId, plan, tier=3)` → `credits.ts:451-458` → for Tier 2/3, calls `atomicAcquireTierSlot()` → returns `{ allowed: true, slotAcquired: true }`.
3. Chat route line 524: `tierSlotAcquired = tierAccess.slotAcquired || false;` → `true`.
4. Stream completes (or non-stream parses successfully). Chat route line 749/816 calls:
   ```typescript
   await processModelUsage(jwtPayload.userId, cost, 3, true /* tierSlotAcquired */, { ... });
   ```
5. `processModelUsage` line 141: `tierSlotAlreadyAcquired && tier === 3` → enters early-return branch.
6. Line 142: if `cost > 0`, deduct points. (Pre-PHO-223: `cost = 0` because pricing row missing → no deduction. Post-PHO-223: deduction happens.)
7. Line 154: `return;` — function exits BEFORE reaching the `if (usageLog) { db.insert(usageLogs)... }` block.

**Result:** Zero `usage_logs` rows for any Tier 2/3 user since this branch was introduced. vuthanhhuong's 217 misses match perfectly.

**Authoring intent (from comment on line 139-140 + comment at line 176-178):**

> "If tier 2/3 slot was already acquired atomically by checkTierAccess, only handle credit deduction — don't touch tier counters or lastUsageDate"
>
> "Tier 2/3 counters are ONLY incremented by atomicAcquireTierSlot() in checkTierAccess(). Do NOT increment here to avoid double-counting. This was the root cause of the tier limit bypass bug."

The author refactored to skip the tier-counter-increment block (correct intent — avoid double-counting), but accidentally also skipped the `usage_logs` insert at the bottom of the same function (incorrect — `usage_logs` is independent of tier counters).

---

## Most likely root cause

The `return;` at `credits.ts:154` is too aggressive. It was meant to skip steps 3-4 (free-tier logic + tier counter update), but it also skips step 5 (`usage_logs` insert). This is a copy-paste / refactor regression: the early-return needed to fall through to the logging block, not exit the entire function.

This bug affects **all Tier 2/3 users**, not just vuthanhhuong. The 217-miss pattern is universal — every Tier 2/3 chat request since this branch landed produces 0 `usage_logs` rows. PostHog evidence likely shows this for many users; vuthanhhuong is just the most prolific.

---

## Proposed fixes

### Option 1 — Move `usage_logs` insert above the early-return (RECOMMENDED)

**Change:** In `src/server/services/billing/credits.ts`, move the `if (usageLog) { db.insert(usageLogs).values(...) }` block from line 217-238 to line \~140 (BEFORE the `if (tierSlotAlreadyAcquired && ...)` early-return).

**Diff sketch:**

```typescript
// credits.ts:108-155 area
try {
  const db = await getServerDB();
  const now = new Date();

  // 1. Get user stats...
  if (userRows.length === 0) return;
  const user = userRows[0];

  // 2. Daily reset detection...

  // [NEW POSITION] Log to usage_logs FIRST — independent of tier counter logic
  if (usageLog) {
    try {
      const VND_RATE = 24_167;
      const costUSD = usageLog.costUSD ?? cost * 0.000_04;
      await db.insert(usageLogs).values({
        costUSD,
        costVND: costUSD * VND_RATE,
        inputTokens: usageLog.inputTokens,
        model: usageLog.model,
        modelTier: tier,
        outputTokens: usageLog.outputTokens,
        pointsDeducted: cost,        // ← uses raw `cost`, not `finalCost` (free-tier waiver doesn't apply to Tier 2/3)
        provider: usageLog.provider,
        responseTimeMs: usageLog.responseTimeMs ?? null,
        sessionId: usageLog.sessionId ?? null,
        totalTokens: usageLog.inputTokens + usageLog.outputTokens,
        userId,
      });
    } catch (logErr) {
      console.warn('⚠️ Failed to insert usage_logs:', logErr);
    }
  }

  // 3. Tier 2/3 atomic-slot path: deduct + return
  if (tierSlotAlreadyAcquired && (tier === 2 || tier === 3)) {
    if (cost > 0) { /* deduct points... */ }
    return;
  }

  // 4. Tier 1 free-tier logic + counter update + final deduction...
}
```

**Caveat:** Tier 1 free-tier path uses `finalCost` (which is 0 when `isFree=true`). Need to handle:

- **Option 1a:** Run insert AFTER computing `finalCost` for Tier 1 (move the insert to right before line 198 / right after line 196).
- **Option 1b:** Run insert TWICE — once with `cost` for Tier 2/3 path (above the early-return), once with `finalCost` for Tier 1 path (current location). Slightly duplicated but cleanest.
- **Option 1c (best):** Restructure as a single insert at the END, after BOTH branches converge. Replace `return` at line 154 with skip-flag + fall-through.

**Risk:** Low-Med (logic restructure of a critical billing fn).

**Test plan:**

1. Unit test: call `processModelUsage(userId, 100, 3, true, {usageLog})` → expect 1 `usage_logs` row + `phoPointsBalance` deducted.
2. Unit test: call `processModelUsage(userId, 100, 1, false, {usageLog})` for first 5 reqs → expect 5 `usage_logs` rows with `pointsDeducted=0`, then 6th with `pointsDeducted=100`.
3. Integration: send Tier 3 request via chat API → verify `usage_logs` row created.
4. Backfill investigation: estimate impact on historical missed metering (217 reqs × N users).

---

### Option 2 — Hoist `usage_logs` insert to the chat route caller

**Change:** Move `usage_logs` insert OUT of `processModelUsage` and into each caller (chat route, research route, artifact-ai route, ai-rendering route, v1/chat route). `processModelUsage` becomes purely a balance/counter mutator.

**Diff sketch:** Remove `credits.ts:216-238`. In each caller, after `await processModelUsage(...)`, add:

```typescript
await db.insert(usageLogs).values({
  /* ... */
});
```

**Risk:** Med-High (5 caller sites to update; risk of inconsistency / future callers forgetting to log). Larger blast radius than Option 1.

**Test plan:** All Option 1 tests + per-caller integration tests for research, artifact-ai, ai-rendering, v1/chat routes.

---

### Recommended: **Option 1c** (single insert at end after branches converge)

**Reason:** Smallest blast radius (one file, \~20 LoC restructure), preserves single-source-of-truth for metering inside `processModelUsage`, makes the `return` flag-based + intentional. Option 2's distribution across callers invites future regressions.

---

## Estimated effort

| Phase                   | Hours      | Notes                                                                                                                     |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Code change (Option 1c) | 0.5–1      | Restructure 30 LoC, careful with `cost` vs `finalCost` for Tier 1                                                         |
| Unit tests              | 1–2        | Cover all 4 paths: T1 free, T1 paid, T2/3 atomic-slot, missing user                                                       |
| Integration smoke       | 0.5        | One Tier 3 chat request → confirm `usage_logs` row appears                                                                |
| Backfill estimate       | 1          | Query PostHog `send_message` for last 30d, JOIN with `usage_logs` to size impact (and identify other "free Tier 3" users) |
| **Total**               | **3–4.5h** |                                                                                                                           |

Backfilling missing rows themselves is a separate decision — most data (input/output tokens, response time) is gone; only event counts can be reconstructed from PostHog.

---

## Open questions for Hien

1. **Are points actually being deducted from vuthanhhuong's balance, or is `cost = 0` for all 217 reqs?** Pre-PHO-223 (today's earlier merge), pricing rows were missing → `activePricing.inputCostPer1M` was undefined → `cost = 0` → no deduction. If true, the user got both "free" AND "invisible" tier 3. Run: `SELECT pho_points_balance, lifetime_spent FROM users WHERE email LIKE 'vuthanhhuong%'` to confirm.

2. **How many other users are affected?** Likely all Tier 2/3 users since the early-return branch landed. Worth checking PostHog `send_message` events × tier vs `usage_logs` count to size the impact.

3. **When was the early-return introduced?** `git blame credits.ts:141-155` will show the commit. If recent (< 30 days), explains why this only surfaced now.

4. **Should we backfill `usage_logs`?** From PostHog we can recover: `userId`, `model`, `timestamp`, `tier` (derived). We CAN'T recover: `inputTokens`, `outputTokens`, `responseTimeMs`, `costUSD`. Decide if a partial backfill (event count only) is useful or skip.

5. **Should PHO-223 + PHO-224 share a hotfix PR or separate?** They're related symptoms (free Tier 3) but different root causes. Recommend separate PRs for clean rollback granularity.

---

## Sources reviewed

- `src/app/(backend)/webapi/chat/[provider]/route.ts` (lines 23-26, 424, 521-525, 700-855)
- `src/server/services/billing/credits.ts` (lines 91-242, 451-458)
- `src/app/api/research/ai-summary/route.ts` (lines 11, 182, 353, 379)
- `src/app/api/artifact-ai/route.ts` (lines 11, 228, 255)
- `src/app/api/ai-rendering/route.ts` (lines 9, 282-294)
- `src/app/(backend)/middleware/auth/index.ts` (line 153)
- `src/config/pricing.ts` (lines 514-515, 862-863)
- `src/server/services/phoGateway/index.ts` (lines 137-140)
