# PHO-236 — Article Generation Investigation

**Date:** 2026-04-30
**Author:** Claude (with Hien)
**Status:** Code-only investigation — no DB/PostHog query access in this session.
**Headline number:** 6/19 article generations failed (31.6%) per Hien's earlier audit.

---

## 1. Where the work happens

Article generation is a single async function in
`src/features/Portal/DeepResearch/Body.tsx` (`handleGenerateArticle`,
lines \~1108–1440). It runs on the browser, not the server, and is the
"Phase 4" step of Deep Research. Inputs:

- `question` — the user's clinical question.
- `outline` — outline produced in Phase 3.
- `agents` — array of per-agent research findings (Phase 2).
- `pubmedPapers` — top-k PubMed/Semantic Scholar papers (Phase 2).
- `model` — user-selected model.

Output: a long markdown article (target 2000–4000 words) streamed via
`callAIStream` into `setArticle`.

---

## 2. Existing instrumentation (good news)

The function is already heavily instrumented in PostHog:

| Event                             | Where       | What it carries                                               |
| --------------------------------- | ----------- | ------------------------------------------------------------- |
| `article_generation_started`      | line \~1120 | `agent_count`, `model`, `outline_sections`, `surface`         |
| `article_safety_filter_suspected` | line \~1240 | `attempt`, `model`, `output_length`, `output_preview`         |
| `article_citation_validation`     | line \~1293 | `invalid_count`, `total_citations`, `validation_passed`       |
| `article_generation_complete`     | line \~1309 | `generation_time_seconds`, `model`, `word_count`              |
| `article_generation_failed`       | line \~1424 | `error`, `models_tried`, `primary_model` (legacy fields only) |

There is also a multi-model fallback chain
`[user_model, gpt-4o, gpt-4o-mini]` with two refusal heuristics:

- `SUSPICIOUS_OUTPUT_THRESHOLD = 50` — output ≤ 50 chars ⇒ assume safety
  filter, retry with the next model.
- `MIN_ARTICLE_WORDS = 200` — output < 200 words ⇒ assume timeout/short
  context, retry with the next model.

So the system already retries 3× before declaring failure. A reported
failure means **all three models failed**.

---

## 3. Why the existing failure event was not enough

Pre-PHO-236, `article_generation_failed` only carried `lastError.message`
and `models_tried`. We could not see:

- Which attempt actually failed (1, 2, or 3).
- Whether attempts hit different errors (e.g. attempt 1 = 429 rate limit,
  attempt 2 = safety filter, attempt 3 = timeout).
- HTTP status if it was a fetch error.
- Per-attempt latency.
- Output length when the refusal heuristic tripped.

Without that, root-cause analysis is guessing.

---

## 4. Plausible failure modes (hypotheses to verify after the next batch)

Ordered by my prior probability:

### H1. Safety filter on **all three** fallback models for a sensitive topic (\~40%)

The fallback list is `[user_model, gpt-4o, gpt-4o-mini]`. All three are
OpenAI-family for the fallback; if a user picks `gpt-4o` as their primary,
they effectively get only two distinct vendors and Gemini Flash is never
tried as a backup. Mental-health, suicidality, oncology adverse events
already triggered Gemini Flash refusals (`MEDICAL_SAFETY_PREFIX` exists
because of this); GPT-4o can refuse them too.

**If this is the cause:** add Claude Sonnet to the fallback chain.

### H2. Token-limit overflow from `agentFindings.slice(0, 15_000)` plus context (\~25%)

Prompt assembles `agentFindings` (15K chars), `pubmedPapers` (top 6,
abstracts capped at 300 chars), the outline, the safety prefix, and \~80
lines of instructions. With chat history context, this can push past
gpt-4o-mini's effective window when the user has many active agents,
producing truncated output that then trips `MIN_ARTICLE_WORDS`.

**If this is the cause:** dynamic agentFindings cap based on model
context size; or always summarise findings before the article step.

### H3. `callAIStream` timeout on long generations (\~15%)

Article target is 2000–4000 words. At streaming speeds of
\~30 tokens/sec on Tier 3 models, the response can take 60–120 s. If
`callAIStream` is on a 60 s Vercel function or a fetch with no
`AbortSignal.timeout`, the stream gets cut and the model returns < 200
words. That re-trips the heuristic and burns a retry.

**If this is the cause:** raise function timeout (we already moved to
300 s default per the platform notes); add explicit `AbortSignal` and
distinguish "client timeout" from "server refusal" in logging.

### H4. 429 rate limit cascade (\~10%)

The 2 s "cool-down" before article generation (line \~1115) is a hint
this has happened before. If a user runs many agents in parallel and
then immediately writes the article, gpt-4o or gpt-4o-mini may 429.
Current retry chain doesn't know to back off — it just tries the next
model, which is also OpenAI and may share the same quota.

**If this is the cause:** exponential back-off + jitter on attempt 2.

### H5. Provider-specific bug we don't know yet (\~10%)

The current event lacks `errorName` / `errorStatus` so we can't tell.
The PHO-236 logging change ships exactly this so we can rule it in or
out next time.

---

## 5. What this PR ships

**Code change** — `src/features/Portal/DeepResearch/Body.tsx`:

1. New `attemptHistory` array tracking every attempt with `model`,
   `errorName`, `errorMessage`, `errorStatus`, `outputLength`,
   `durationMs`.
2. `article_generation_failed` event now carries `attempt_history` and
   `error_name` in addition to the legacy fields.
3. Console.error log shifted from a flat string to a structured object
   (`{ message, name, status }`) so Vercel function logs are queryable.

**No prompt or fallback-chain changes** — the retry logic is unchanged.
We need data first.

---

## 6. Decisions Hien needs to make after the next \~20 article runs

1. Pull `article_generation_failed` events for the next 7 days.
2. Group failures by `attempt_history[*].errorName` and
   `attempt_history[*].errorStatus`. Whichever cluster is largest is
   the real bug.
3. Apply the matching fix from §4 (or report a new pattern).

---

## 7. Reference: existing safety nets we are NOT changing here

- `MEDICAL_SAFETY_PREFIX` (Phase 1.5.2/1.5.3) — already prepended.
- Citation sanity check after generation (already in place).
- GRADE table generation as a follow-up (already in place).
- `localStorage` history of last 20 articles (already in place).

These work as-is; the failure mode lives **before** any of them runs.
