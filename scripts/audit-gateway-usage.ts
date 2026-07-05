/**
 * audit-gateway-usage.ts — Read-only Vercel AI Gateway spend reconciliation.
 *
 * Pulls the AI Gateway Custom Reporting API and prints spend broken down by
 * day / model / user / tag / api-key, plus the current credits balance.
 * Optionally reconciles daily spend against PostHog `$ai_generation` events
 * so we can see how much of the burn is pho.chat app traffic vs everything
 * else sharing the same gateway credits pool.
 *
 * Docs: https://vercel.com/docs/ai-gateway/observability-and-spend/custom-reporting
 *   GET https://ai-gateway.vercel.sh/v1/report   (Pro/Enterprise plans)
 *   GET https://ai-gateway.vercel.sh/v1/credits
 * Auth: AI_GATEWAY_API_KEY (aka VERCELAIGATEWAY_API_KEY) — NOT a Vercel token.
 *
 * Usage:
 *   npx tsx scripts/audit-gateway-usage.ts            # last 14 days
 *   npx tsx scripts/audit-gateway-usage.ts --days 30
 *   npx tsx scripts/audit-gateway-usage.ts --json     # raw JSON dump
 *
 * Env (reads .env.local automatically):
 *   AI_GATEWAY_API_KEY or VERCELAIGATEWAY_API_KEY   required
 *   POSTHOG_API_KEY + POSTHOG_PROJECT_ID            optional — enables the
 *                                                   PostHog reconciliation table
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Tiny .env.local loader (no dotenv dependency) ──────────────────

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const GATEWAY_BASE = 'https://ai-gateway.vercel.sh/v1';
const API_KEY = process.env.AI_GATEWAY_API_KEY || process.env.VERCELAIGATEWAY_API_KEY;

const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.posthog.com';
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID;

// ─── CLI args ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const daysArgIndex = args.indexOf('--days');
const DAYS = daysArgIndex >= 0 ? Number(args[daysArgIndex + 1]) || 14 : 14;
const JSON_OUTPUT = args.includes('--json');

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const endDate = isoDate(new Date());
const startDate = isoDate(new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000));

// ─── Gateway API helpers ─────────────────────────────────────────────

interface ReportRow {
  api_key_name?: string;
  cache_creation_input_tokens?: number;
  cached_input_tokens?: number;
  day?: string;
  input_tokens?: number;
  model?: string;
  output_tokens?: number;
  provider?: string;
  reasoning_tokens?: number;
  request_count?: number;
  tag?: string;
  total_cost?: number;
  user?: string;
}

async function gatewayGet(path: string): Promise<any> {
  const res = await fetch(`${GATEWAY_BASE}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchReport(groupBy: string): Promise<ReportRow[]> {
  const data = await gatewayGet(
    `/report?start_date=${startDate}&end_date=${endDate}&group_by=${groupBy}`,
  );
  return data.results ?? [];
}

// ─── PostHog reconciliation (optional) ───────────────────────────────

async function fetchPostHogDaily(): Promise<Map<string, number>> {
  const query = `
    SELECT toDate(timestamp) AS day, round(sum(toFloat(coalesce(properties.$ai_cost_usd, properties.$ai_total_cost_usd, 0))), 4) AS usd
    FROM events
    WHERE event = '$ai_generation' AND timestamp >= now() - INTERVAL ${DAYS} DAY
    GROUP BY day ORDER BY day`;

  const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    headers: {
      'Authorization': `Bearer ${POSTHOG_API_KEY}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`PostHog query → ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const map = new Map<string, number>();
  for (const [day, usd] of data.results ?? []) map.set(String(day), Number(usd));
  return map;
}

// ─── Formatting ──────────────────────────────────────────────────────

// The gateway API returns numeric fields as JSON strings (e.g. balance: "95.50").
// Coerce EVERYTHING before math — `0 + "1.5"` silently concatenates.
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function usd(n: unknown): string {
  return `$${num(n).toFixed(2)}`;
}

function pct(part: unknown, total: unknown): string {
  const t = num(total);
  return t > 0 ? `${((100 * num(part)) / t).toFixed(1)}%` : '-';
}

function printTable(title: string, rows: ReportRow[], labelKey: keyof ReportRow) {
  const total = rows.reduce((acc, r) => acc + num(r.total_cost), 0);
  console.log(`\n── ${title} (total ${usd(total)}) ${'─'.repeat(Math.max(0, 40 - title.length))}`);
  const sorted = [...rows].sort((a, b) => num(b.total_cost) - num(a.total_cost));
  for (const row of sorted.slice(0, 25)) {
    const label = String(row[labelKey] ?? '(none)');
    const cached = num(row.cached_input_tokens);
    const input = num(row.input_tokens);
    console.log(
      `  ${label.padEnd(42)} ${usd(row.total_cost).padStart(10)}  ${pct(row.total_cost, total).padStart(6)}  ` +
        `reqs=${String(num(row.request_count)).padStart(5)}  in=${String(input).padStart(10)}  ` +
        `cached=${String(cached).padStart(10)} (${pct(cached, input + cached)})`,
    );
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    throw new Error(
      'AI_GATEWAY_API_KEY (or VERCELAIGATEWAY_API_KEY) is not set. ' +
        'Add it to .env.local or the environment.',
    );
  }

  console.log(`Vercel AI Gateway spend audit — ${startDate} → ${endDate} (${DAYS} days)`);

  const [credits, byDay, byModel, byUser, byTag, byApiKey, byProvider] = await Promise.all([
    gatewayGet('/credits').catch((e) => ({ error: String(e) })),
    fetchReport('day'),
    fetchReport('model'),
    fetchReport('user'),
    fetchReport('tag'),
    fetchReport('api_key_name'),
    fetchReport('provider'),
  ]);

  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify({ byApiKey, byDay, byModel, byProvider, byTag, byUser, credits }, null, 2),
    );
    return;
  }

  // /v1/credits returns { balance: "95.50", total_used: "4.50" } — strings.
  console.log(
    `\nCredits: balance=${usd(credits.balance)} lifetimeSpend=${usd(credits.total_used ?? credits.totalSpend)}` +
      (credits.error ? ` (fetch failed: ${credits.error})` : ''),
  );

  const totalSpend = byDay.reduce((acc, r) => acc + num(r.total_cost), 0);
  console.log(`Window total: ${usd(totalSpend)} (${usd(totalSpend / DAYS)}/day avg)`);

  // Cache engagement across the whole window — the "is prompt caching working?" number.
  const totals = byModel.reduce(
    (acc, r) => ({
      cacheCreation: acc.cacheCreation + num(r.cache_creation_input_tokens),
      cached: acc.cached + num(r.cached_input_tokens),
      input: acc.input + num(r.input_tokens),
      reasoning: acc.reasoning + num(r.reasoning_tokens),
    }),
    { cacheCreation: 0, cached: 0, input: 0, reasoning: 0 },
  );
  console.log(
    `Tokens: input=${totals.input} cachedRead=${totals.cached} ` +
      `(hit ratio ${pct(totals.cached, totals.input + totals.cached)}) ` +
      `cacheWrite=${totals.cacheCreation} reasoning=${totals.reasoning}`,
  );

  printTable('By API key (which project is burning credits)', byApiKey, 'api_key_name');
  printTable('By model', byModel, 'model');
  printTable('By user (gateway attribution)', byUser, 'user');
  printTable('By tag', byTag, 'tag');
  printTable('By provider', byProvider, 'provider');

  // ── Daily table + optional PostHog reconciliation ──
  let posthogDaily: Map<string, number> | null = null;
  if (POSTHOG_API_KEY && POSTHOG_PROJECT_ID) {
    try {
      posthogDaily = await fetchPostHogDaily();
    } catch (e) {
      console.warn(`\n⚠️ PostHog reconciliation skipped: ${(e as Error).message}`);
    }
  } else {
    console.log(
      '\nℹ️ Set POSTHOG_API_KEY + POSTHOG_PROJECT_ID to add the PostHog reconciliation column.',
    );
  }

  console.log(
    `\n── Daily spend${posthogDaily ? ' vs PostHog ($ai_generation)' : ''} ${'─'.repeat(30)}`,
  );
  const sortedDays = [...byDay].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  for (const row of sortedDays) {
    const day = String(row.day ?? '');
    const gatewayUsd = num(row.total_cost);
    if (posthogDaily) {
      const phUsd = num(posthogDaily.get(day));
      const gap = gatewayUsd - phUsd;
      console.log(
        `  ${day}  gateway=${usd(gatewayUsd).padStart(9)}  posthog=${usd(phUsd).padStart(9)}  ` +
          `untracked=${usd(gap).padStart(9)} (${pct(gap, gatewayUsd)})`,
      );
    } else {
      console.log(
        `  ${day}  gateway=${usd(gatewayUsd).padStart(9)}  reqs=${num(row.request_count)}`,
      );
    }
  }

  console.log(
    '\nNotes:\n' +
      '  • "By API key" splits spend across every project sharing this credits pool.\n' +
      '  • "By user/tag" only covers requests that send gateway attribution — rows\n' +
      '    appear for pho.chat traffic after the feat/gateway-cost-attribution deploy.\n' +
      '  • cachedRead ≈ 0 on anthropic models means prompt caching is NOT engaging.\n' +
      '  • The report endpoint requires a Pro/Enterprise Vercel plan.',
  );
}

// tsx runs repo scripts as CJS (package.json has no "type": "module"), so
// top-level await is unavailable in .ts scripts here.
// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((e) => {
  console.error('❌ Audit failed:', e);
  process.exitCode = 1;
});
