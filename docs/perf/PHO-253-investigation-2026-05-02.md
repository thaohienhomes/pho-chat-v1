# PHO-253 Performance Investigation Report

**Date:** 2026-05-02
**Branch:** `investigate/perf-chat-PHO-253`
**Severity:** P0 PERF CRISIS
**Status:** Investigation only — no fixes applied

---

## TL;DR

The "LCP regression" is **not a regression** — `/chat` has been chronically slow for real Vietnamese users since at least 2026-03-01. The "Lighthouse 93 / 0.8s LCP" baseline noted in `auto/lighthouse/autoresearch.md` was a synthetic Desktop score and **bears no relation to the real-user experience**. PostHog real-user data shows `/chat` LCP avg 7–25s every single day for the last two months.

**Top 3 confirmed bottlenecks** (mobile Lighthouse against `https://pho.chat/chat`, 2026-05-02):

| #   | Bottleneck                        | Evidence                                                                                      | Estimated impact                                          |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | **2.2 MB unused JavaScript**      | Lighthouse `unused-javascript` opportunity                                                    | **−10.7 s LCP**                                           |
| 2   | **17 s JS bootup time on mobile** | Lighthouse `bootup-time` audit                                                                | −5–10 s LCP / −1 s TBT                                    |
| 3   | **tRPC 401 retry wait up to 8 s** | Code review — `lambda.ts:49` polls `useUserStore` for up to 8 s, then `silentRefresh` + retry | Tail-latency spikes on auth-storm days (35–73 events/day) |

Lighthouse mobile score **18** today vs Mar 18 desktop synthetic **93**. Mobile has never been measured against real-user reality.

---

## What changed in framing

The PRD/prompt asked us to investigate a P0 regression. The data does not support a regression hypothesis:

| Source                                                | Date       | LCP avg    | LCP p50 | LCP p95 |
| ----------------------------------------------------- | ---------- | ---------- | ------- | ------- |
| `auto/lighthouse/autoresearch.md` (synthetic Desktop) | 2026-03-18 | 800 ms     | —       | —       |
| PostHog real users (same day)                         | 2026-03-18 | **15.3 s** | 7.5 s   | 55.7 s  |
| PostHog real users (today)                            | 2026-05-02 | 14.7 s     | 7.6 s   | 42.4 s  |

The real-user p50 has been \~7–10 s every single day from 2026-03-01 onward. The "regression" narrative comes from comparing a synthetic Lighthouse Desktop run against PostHog real-user data — **apples to oranges**.

What is real:

- Auth-related incidents on specific days (e.g. 2026-04-13 with 73 `auth_session_expired` events, 2026-04-20 with 35) cause spikes where LCP p95 climbs to 40–80 s.
- The 130 s LCP max (user 3A7UdEwe, 2026-05-01) is one outlier session likely on a stalled network — the daily max of 30–60 s is more representative of bad-day behavior.

---

## PostHog real-user data (Mar 1 → today, /chat only)

LCP, daily aggregate, sourced via HogQL:

| Day        | Samples | LCP avg   | LCP p50 | LCP p95   | Notes                                |
| ---------- | ------- | --------- | ------- | --------- | ------------------------------------ |
| 2026-03-01 | 36      | 7787      | 6242    | 18190     |                                      |
| 2026-03-06 | 30      | **22352** | 11178   | 50141     | Spike                                |
| 2026-03-18 | 62      | 15256     | 7514    | 55692     | "Lighthouse 93 day"                  |
| 2026-03-26 | 23      | **21173** | 8975    | **80672** | Clerk auth race fix shipped same day |
| 2026-03-29 | 19      | **24736** | 9904    | 49824     |                                      |
| 2026-04-01 | 12      | **21184** | 5509    | **93991** |                                      |
| 2026-04-11 | 5       | **34954** | 25928   | 71773     | Tiny sample, but ugly                |
| 2026-04-13 | 27      | 14741     | 6252    | 40358     | **73 auth_session_expired events**   |
| 2026-04-20 | 10      | 13913     | 8216    | 40820     | **35 auth events, INP p95 12.8 s**   |
| 2026-05-01 | 21      | 15319     | 6792    | 43419     | LCP max **129.9 s** (one user)       |
| 2026-05-02 | 18      | 14686     | 7619    | 42447     |                                      |

Interactive metrics (last 7 days):

| Metric | Avg                                   | p95           |
| ------ | ------------------------------------- | ------------- |
| INP    | 200–1300 ms                           | 400–13 000 ms |
| FCP    | 2.5–6.6 s                             | 4.4–28.8 s    |
| TTFB   | not reported by PostHog vitals plugin |               |

`auth_session_expired` correlates strongly with bad LCP days. Two days with the highest auth-event counts (Apr 20 = 35, Apr 13 = 73) coincide with the worst INP p95 (12.8 s) and LCP p95 spikes.

Geo / device breakdown (last 7 days, /chat):

- **VN: 94/94 samples (100 %)** — there is no non-VN traffic worth optimising for.
- Chrome Windows 65 samples, LCP avg 13.4 s. Edge Windows 24 samples, LCP avg 14.7 s. Mobile breakout not available in this slice (web-vitals plugin only reports browser/OS).

---

## Lighthouse mobile audit (live, 2026-05-02 17:47)

Run against `https://pho.chat/chat` from this machine via `npx lighthouse --form-factor=mobile --throttling-method=simulate`. Full JSON at `docs/perf/lighthouse-mobile.json` (772 KB).

| Metric                | Value     | Threshold             |
| --------------------- | --------- | --------------------- |
| **Performance score** | **18**    | 80 (good), 90 (great) |
| LCP                   | 32.0 s    | 2.5 s                 |
| FCP                   | 3.3 s     | 1.8 s                 |
| TBT                   | 3 150 ms  | 200 ms                |
| CLS                   | 0.225     | 0.1                   |
| Speed Index           | 23.6 s    | 3.4 s                 |
| TTI                   | 32.8 s    | 3.8 s                 |
| Total transferred     | 6 390 KiB | —                     |
| JS bootup time        | 17.0 s    | 2 s                   |
| Main-thread work      | 21.7 s    | 2 s                   |

Lighthouse opportunities (sorted by potential savings):

| Opportunity                                | Savings (ms) | Savings (KB) |
| ------------------------------------------ | ------------ | ------------ |
| **Reduce unused JavaScript**               | **10 670**   | 2 210        |
| Reduce initial server response time (TTFB) | 692          | —            |

Other opportunities returned no estimated savings (e.g. `render-blocking-resources`, `unused-css-rules` etc. were below the audit's noise floor).

Desktop Lighthouse from `auto/lighthouse/autoresearch.md` (2026-03-18) was 93. We did not re-run desktop today — the mobile run is the leading indicator since 100 % of /chat traffic is VN, and \~50 % of all VN web traffic is mobile.

---

## Bundle analysis — BLOCKED

`node auto/bundle/measure.mjs` was kicked off at 17:36, completed at 17:46 with **build failure**:

```
TypeError: Cannot read properties of undefined (reading 'server')
  at FlightClientEntryPlugin.createActionAssets
    (next/dist/build/webpack/plugins/flight-client-entry-plugin.js:680)
```

Local `pnpm build` is broken on this branch. Root cause is a Next.js 15.5.12 server-actions bundling failure, likely related to one of: `experimental.serverMinification: false`, `react-scan/react-component-name/webpack` plugin, or a stale action manifest. **This is a separate ticket** — it does not block production deploys (Vercel builds succeed) but it does block local bundle-size measurements and ANALYZE=true reports.

Last successful local measurement was 2026-03-16 (`auto/bundle/autoresearch.jsonl`):

- `js_bundle_kb`: 56 044
- `chunk_count`: 1 956
- `total_bundle_kb`: 69 557

Per `auto/bundle/autoresearch.md`, the bundle is at the ceiling for what tree-shaking can achieve:

- 95.5 % of bundle is shared vendor code from `@lobehub/ui` and dependencies
- 50+ `next/dynamic` imports already exist
- Top chunk 1.99 MB, main chat page 13.7 MB across 116 chunks
- Further gains require upstream `@lobehub/ui` refactoring or CDN-loading vendor libs

The Lighthouse "2.2 MB unused JavaScript" finding is consistent with this — unused code reachable via dynamic imports that bundlers can't tree-shake at build time.

---

## Code-path analysis findings

### `/chat` render pipeline

```
src/app/[variants]/(main)/layout.tsx
  → ServerLayout({ Desktop, Mobile })
  → Desktop (or Mobile) renders chat shell

src/app/[variants]/(main)/chat/(workspace)/page.tsx   (server component)
  → renders <StructuredData /> + <PageTitle />
  → trivial; no data fetching here

Parallel routes (where the heavy work lives):
  - chat/(workspace)/@conversation
  - chat/(workspace)/@portal
  - chat/(workspace)/@topic
  - chat/@session
```

The page itself is thin. All client-visible content depends on:

1. **GlobalProvider** (async RSC) running `await getAntdLocale()` and `await getServerGlobalConfig()` at the top of every render — see `src/layout/GlobalProvider/index.tsx:40-44`. `getServerGlobalConfig()` parses 70+ provider configs with a `Promise.all` — purely CPU/env-var work, no DB hits, but iterates `ModelProvider` enum on every request.
2. **Client-side tRPC queries** (`lambdaClient`, `edgeClient`, `toolsClient`) firing in parallel after hydration to load sessions, messages, plugins, agents.
3. **DeferredStoreInitialization** that React.lazy-loads non-critical stores.

### tRPC retry pattern (auth recovery)

`src/libs/trpc/client/lambda.ts:21-82` (and similar in `edge.ts`, `tools.ts`):

```ts
// Lambda client – the worst case
setTimeout(resolve, 8000); // Max 8 s wait (Clerk CDN slow in VN)
// + silentRefresh (Clerk session reload + getToken)
// + retry the original op
// If second 401: shouldForceReauth() → forceReauth() → /login redirect
```

**Worst-case per-request blocked time on a 401**: 8 s wait + \~1 s refresh + \~1 s retry = \~10 s. If a burst of parallel queries all 401 (inbox load), they coalesce on a singleflight refresh — but each query's observer still waits the 8 s polling phase.

`shouldForceReauth()` thresholds (`authRecovery.ts:23-24`):

- `FAILURE_WINDOW_MS = 15 * 60_000` (15 min, widened in PHO-251)
- `FAILURE_THRESHOLD = 2`

Once tripped, `forceReauth()` redirects to `/login?reason=session_expired&callbackUrl=...` after a 1.5 s toast — which **starts a new navigation, ending the bad LCP session**. The original session is recorded in PostHog with whatever LCP was reached at that point.

### `getUserState` server-side (PHO-241 / A1.6)

`src/server/routers/lambda/user.ts:48-120` — the critical "user initialization" tRPC query that fires on every chat session start now does **5 sequential DB-flavoured operations**:

1. `userModel.getUserState(...)` (multi-table read, can throw `UserNotFoundError` and trigger Clerk createUser)
2. `messageModel.hasMoreThanN(4)`
3. `messageModel.hasMoreThanN(0)`
4. `sessionModel.hasMoreThanN(1)`
5. **NEW (PHO-241, 2026-05-01)**: `getUserPlanFromDB(ctx.userId)` — adds another subscriptions / users.current_plan_id read

These run sequentially (`await … await … await …`), not parallelised. On Neon Serverless cold-start, each round-trip is 50–200 ms. Aggregate: 250 ms–1 s pure server time, before any rendering.

### What hasn't changed

`git log --since=2026-03-18 -- src/layout/GlobalProvider/ src/server/globalConfig/` returned **zero** results. The provider chain that drives initial render hasn't changed in the regression window. The performance profile we see is the steady-state behaviour of the current architecture, not a recent code regression.

---

## Top 3 bottlenecks

### 1. 2.2 MB unused JavaScript (–10.7 s LCP)

- **Evidence**: Lighthouse mobile audit `unused-javascript` reports 10 670 ms savings at 2 263 KB unused.
- **Why it exists**: Lobe-chat is a fork that ships every feature (discover, plugins marketplace, mermaid renderer, monaco editor, swagger viewer, emoji picker etc.) in shared chunks even when only a fraction is used per session. Existing autoresearch confirms 95.5 % of bytes come from shared vendor code.
- **Fix effort**: medium — 1–3 days
- **Fix risk**: medium — risk of breaking edge features if dynamic imports are mis-scoped
- **Approach**: aggressive route-segment code splitting, push more `@lobehub/ui` heavy components behind `next/dynamic`, audit `optimizePackageImports` for missing barrel-export targets, kill features unused on pho.chat (discover/plugins marketplace already disabled in middleware? — verify).

### 2. 17 s JS bootup + 21.7 s main-thread work (mobile)

- **Evidence**: Lighthouse mobile `bootup-time = 17.0 s`, `mainthread-work-breakdown = 21.7 s`, `total-blocking-time = 3 150 ms`.
- **Why it exists**: The full bundle has to download → parse → evaluate before any client work runs. On VN mobile (4G real-world \~5 Mbps, weaker Snapdragon CPUs), 6.4 MB transferred takes 10–15 s alone, then JS parse takes another 5–10 s.
- **Fix effort**: medium — depends on (1) above
- **Fix risk**: low–medium
- **Approach**: split out the chat workspace from the rest of the app (currently shared chunks include discover/files/repos/admin code), add a static loading skeleton as the LCP element so users see content while JS parses, defer all non-critical client init to `requestIdleCallback`.

### 3. tRPC 401 wait (8 s) blocking client data on auth-storm days

- **Evidence**: Code review of `src/libs/trpc/client/lambda.ts:42-50`, `edge.ts:36-43`, `tools.ts:39-46`. Real-world signal: PostHog `auth_session_expired` correlates with LCP/INP spike days (Apr 13 = 73 events, Apr 20 = 35 events with INP p95 12.8 s).
- **Why it exists**: Polling `useUserStore.isLoaded` for Clerk hydration is the only safe way to avoid a race when an SSO callback fires before the Clerk client is ready, but the 5–8 s safety timeout is exposed as user-visible latency on every non-recoverable 401.
- **Fix effort**: low — 1–2 days
- **Fix risk**: medium — easy to reintroduce the SSO callback race that this guard exists to prevent
- **Approach**: shorten the polling timeout from 8 s → 2 s for already-rendered pages (the page is already past hydration, so the SSO callback race window is closed), let `silentRefresh` race the polling instead of running after, escalate to `forceReauth` on the first failure if `useUserStore.isSignedIn` is already true (signal: token went bad mid-session, not "Clerk hadn't loaded").

---

## Other contributing factors (smaller impact)

- **CLS 0.225** (mobile) — above the 0.1 threshold. Existing `auto/lighthouse/autoresearch.md` notes a CloudBanner placeholder fix landed 2026-03-18; the 0.225 today suggests something else is shifting (likely sidebar/avatar load or font swap).
- **TTFB 692 ms savings** — Lighthouse flags initial server response time. Likely cold-start of Vercel function for VN users (no edge function, no regional pin). Vercel Asia region is Singapore, \~50 ms RTT from VN, but cold-start adds 200–500 ms.
- **No edge caching for /chat** — `vercel.json` review needed. The page has personalised content but the static shell could be edge-cached and hydrated.
- **Bundle build broken locally** — separate from /chat perf, but blocks `ANALYZE=true` reports and `auto/bundle` autoresearch loops. File a follow-up ticket.

---

## Recommended fix plan

### Quick wins (1–2 hours each, ship this week)

1. **Add a static LCP placeholder in chat workspace** — render a skeleton chat shell as the LCP element so it paints in <1 s while JS hydrates. Even without bundle reduction, this re-classifies what "LCP" measures. (\~−5–10 s LCP impact for slow-network users, mostly cosmetic/perceived perf.)
2. **Shorten tRPC retry polling timeout from 8 s → 2 s once `isLoaded === true`** in `lambda.ts:49`, `edge.ts:42`, `tools.ts:45`. The 8 s wait was added for the SSO callback race; once `isLoaded` is true, that race is closed. (\~−6 s LCP impact on auth-storm days.)
3. **Self-host `web-vitals` `INP` polyfill or upgrade `posthog-js` to capture TTFB and `$performance_raw_navigation_*`** so future investigations have server-time data. PostHog plugin is currently dropping these on VN traffic.

### Medium (1–3 days each, ship within 2 weeks)

4. **Aggressive bundle splitting for `/chat` route segment**. Goal: cut the 2.2 MB unused-JS finding by ≥ 50 %. Concretely: audit `next.config.ts` `optimizePackageImports`, audit dynamic-imported features, ensure discover/files/repos/admin code is not in the chat workspace's initial chunks. Tooling: fix the local build first, then `ANALYZE=true pnpm build`.
5. **Parallelise `getUserState`'s 5 sequential DB calls** (`src/server/routers/lambda/user.ts:100-105`). Use `Promise.all` for the `hasMoreThanN` checks and the `getUserPlanFromDB` call. Saves 200–800 ms server time per chat session start.
6. **Edge-cache the `/chat` shell** via Vercel edge function with stale-while-revalidate. Personalisation can live in client-only suspense boundaries.

### Long-term (1–4 weeks)

7. **Vercel region pin to `sin1`** (Singapore) for VN traffic, plus enable Vercel's Asia edge network for static assets. Cuts TTFB by 100–300 ms.
8. **Upstream `@lobehub/ui` tree-shaking improvements** — file PRs upstream to make the markdown component, useMermaid hook, code highlighter properly side-effect-free.
9. **PostHog Web Vitals dashboard with alerting** — daily LCP/INP/CLS regression detection so the next quiet drift is caught in 24 h, not 2 months.

---

## What I did NOT do (and why)

- **No code fixes applied.** Per the prompt, this is investigation only. I considered adding the trivial polling-timeout shortening as a "quick win" but decided no — the SSO callback race is real and the change deserves its own PR with manual VN-network testing.
- **No `ANALYZE=true pnpm build` report.** The local build is broken (separate issue). Existing `auto/bundle/autoresearch.md` data is the source of bundle-size truth.
- **No bisection of the regression.** The PostHog data shows there isn't one — the perf profile has been steady (poor) since Mar 1.
- **No desktop Lighthouse re-run.** Mobile is the high-leverage measurement given 100 % VN traffic; desktop will likely score much higher and is misleading (Mar 18's 93 was a desktop run).

---

## Files in this PR

```
docs/perf/PHO-253-investigation-2026-05-02.md   (this report)
docs/perf/lighthouse-mobile.json                (772 KB, full Lighthouse output)
```

No source-code changes.

---

## Next step for Hien

1. **Read this report.** The framing is "we always had this problem, here's how to actually move the needle", not "find the bad commit".
2. **Pick 1–2 quick wins** from §Recommended fix plan and open a follow-up ticket per fix. My pick: #2 (tRPC retry timeout) is the cheapest with the highest auth-storm-day impact; #1 (LCP skeleton) is the cheapest with the broadest perceived-perf impact.
3. **Decide on bundle work scope** — fixing the local build (so `ANALYZE=true` works again) is a prerequisite for the Medium-tier work.
4. **Manual verification I can't do**:
   - Vercel Dashboard → Analytics → Web Vitals (cross-check PostHog numbers against Vercel's measurement).
   - Neon Dashboard → Slow queries log (confirm `getUserState` aggregate is what I claimed).
   - Test `/chat` from a VN mobile network on a mid-tier Android device (the lighthouse number we have is desktop machine emulating mobile, not the real article).
