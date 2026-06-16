#!/usr/bin/env tsx
/**
 * Sync a user's plan across ALL sources of truth (users + subscriptions + Clerk),
 * and scan for users where those sources have drifted apart.
 *
 * CANONICAL ADMIN-GRANT / REPAIR TOOL — prefer this over raw SQL or one-off
 * scripts (e.g. manual-db-sync.ts) when changing a user's plan. Updating only
 * ONE source — `users.current_plan_id`, or only the `subscriptions` row, or only
 * Clerk — is exactly what creates the drift this script repairs.
 *
 * TWO DRIFT CLASSES
 * -----------------
 * 1. users.current_plan_id  ↔  subscriptions.plan_id   (--scan)
 *    `getUserPlanFromDB` reads the active SUBSCRIPTION first; `users.current_plan_id`
 *    is only a fallback. Update one but not the other and the user is gated on the
 *    wrong plan — and `diagnose-auth-lockout.ts` (which only read
 *    `users.current_plan_id`) would report them "healthy".
 *
 * 2. DB  ↔  Clerk publicMetadata.planId                (--scan-clerk)
 *    Gating uses the DB; Clerk metadata is display/analytics cache only and must
 *    never gate authorization (PHO-241). But a DB grant that doesn't sync Clerk
 *    leaves Settings / plan badge / PostHog showing the stale plan, which reads as
 *    "lost my plan" to users and support. (See also the one-shot audit-plan-drift.ts.)
 *
 * REAL CASE (2026-06): nga.ntv@gmail.com — DB (users + subscriptions) was
 * `vn_ultimate` via a manual `admin_upgrade`, but Clerk publicMetadata.planId was
 * still `medical_beta` because the grant never synced Clerk. Server gating already
 * gave Ultimate; the user/support saw `medical_beta` everywhere (compounded by an
 * auth-session incident that briefly fell the user back to vn_free). This is a
 * DB↔Clerk drift (class 2), NOT a users↔subscriptions drift.
 *
 * USAGE
 * -----
 *   # users ↔ subscriptions divergence (read-only)
 *   bunx tsx scripts/sync-user-plan.ts --scan
 *
 *   # DB(resolved) ↔ Clerk divergence for paid users (read-only)
 *   bunx tsx scripts/sync-user-plan.ts --scan-clerk
 *
 *   # Cancel redundant active subscriptions, keeping the best row per user
 *   # (all users, or one with --user). Read-only without --apply.
 *   bunx tsx scripts/sync-user-plan.ts --dedupe-subs
 *   bunx tsx scripts/sync-user-plan.ts --dedupe-subs --apply
 *
 *   # Dry-run for one user: print current state + intended changes (no writes).
 *   bunx tsx scripts/sync-user-plan.ts --user user_xxx --plan vn_ultimate
 *
 *   # Apply: align subscriptions + users (+ Clerk) to <plan>.
 *   bunx tsx scripts/sync-user-plan.ts --user user_xxx --plan vn_ultimate --apply
 *
 * Requires env: DATABASE_URL  (CLERK_SECRET_KEY for Clerk sync / --scan-clerk).
 */
import dotenv from 'dotenv';
import { Pool, type PoolClient } from 'pg';

dotenv.config({ path: '.env.local' });
dotenv.config();

// Plan codes accepted as a target. Mirrors PLAN_MODEL_ACCESS keys in
// src/config/pricing.ts plus the legacy aliases still present in the DB.
const VALID_PLANS = new Set<string>([
  'vn_free',
  'vn_basic',
  'vn_premium',
  'vn_pro',
  'vn_team',
  'vn_ultimate',
  'medical_beta',
  'gl_starter',
  'gl_standard',
  'gl_premium',
  'gl_lifetime',
  'lifetime_early_bird',
  'lifetime_last_call',
  'lifetime_standard',
  // legacy
  'free',
  'starter',
  'premium',
  'ultimate',
  'lifetime',
]);

const FREE_PLANS = new Set(['vn_free', 'gl_starter', 'free', 'trial', 'starter']);

interface Args {
  apply: boolean;
  dedupeSubs: boolean;
  force: boolean;
  plan?: string;
  scan: boolean;
  scanClerk: boolean;
  user?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, dedupeSubs: false, force: false, scan: false, scanClerk: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scan-clerk') args.scanClerk = true;
    else if (a === '--scan') args.scan = true;
    else if (a === '--dedupe-subs') args.dedupeSubs = true;
    else if (a === '--apply') args.apply = true;
    else if (a === '--force') args.force = true;
    else if (a === '--user') args.user = argv[++i];
    else if (a === '--plan') args.plan = argv[++i];
  }
  return args;
}

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '∅';
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/** Read-only: list users whose active subscription plan != users.current_plan_id. */
async function scan(client: PoolClient): Promise<void> {
  await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

  // Compare users.current_plan_id vs the active subscription plan, but IGNORE
  // free↔free alias noise: the activate-free route writes subscriptions.plan_id
  // = 'free' while users.current_plan_id stays 'vn_free' — same tier, both in the
  // free set, so getUserPlanFromDB resolves to free either way (no entitlement
  // difference). Only surface rows that differ in a way that affects access.
  const freeAliases = [...FREE_PLANS];
  const { rows } = await client.query(
    `SELECT u.id,
            u.email,
            u.current_plan_id            AS users_plan,
            u.subscription_status        AS users_status,
            s.plan_id                    AS sub_plan,
            s.status                     AS sub_status,
            s.current_period_end         AS sub_period_end
       FROM users u
       JOIN subscriptions s
         ON s.user_id = u.id
        AND s.status = 'active'
      WHERE lower(coalesce(u.current_plan_id, 'vn_free')) <> lower(s.plan_id)
        AND NOT (
          lower(coalesce(u.current_plan_id, 'vn_free')) = ANY($1::text[])
          AND lower(s.plan_id) = ANY($1::text[])
        )
      ORDER BY u.current_plan_id, u.email`,
    [freeAliases],
  );

  console.log('🔎 Plan divergence scan (READ-ONLY) — free↔free aliases ignored');
  console.log(`   users.current_plan_id  ≠  active subscriptions.plan_id\n${'='.repeat(72)}`);

  if (rows.length === 0) {
    console.log('   ✅ No divergence found. All active subscriptions match users.current_plan_id.');
    return;
  }

  for (const r of rows) {
    const usersPaid = !FREE_PLANS.has(String(r.users_plan ?? 'vn_free').toLowerCase());
    const subPaid = !FREE_PLANS.has(String(r.sub_plan).toLowerCase());
    // The subscription wins at runtime. If users is a paid plan but the active
    // subscription is free-ish, the user is being under-served.
    const flag = usersPaid && !subPaid ? ' ⬅ user UNDER-SERVED (sub is free-ish)' : '';
    console.log(
      `\n▶ ${fmt(r.id)}  ${fmt(r.email)}` +
        `\n    users.current_plan_id = ${fmt(r.users_plan)} (${fmt(r.users_status)})` +
        `\n    subscriptions.plan_id = ${fmt(r.sub_plan)} (${fmt(r.sub_status)}) ← wins at runtime${flag}` +
        `\n    → reconcile: bunx tsx scripts/sync-user-plan.ts --user ${fmt(r.id)} --plan ${fmt(r.users_plan)} --apply`,
    );
  }
  console.log(`\n${'='.repeat(72)}\n${rows.length} divergent user(s).`);
}

/** Print one user's current state across users + subscriptions. */
async function printUserState(client: PoolClient, userId: string): Promise<{ found: boolean }> {
  const { rows: userRows } = await client.query(
    `SELECT id, email, current_plan_id, subscription_status, pho_points_balance
       FROM users WHERE id = $1`,
    [userId],
  );
  if (userRows.length === 0) {
    console.log(`   ❌ user ${userId} NOT FOUND in users table.`);
    return { found: false };
  }
  const u = userRows[0];
  console.log(`   email                 : ${fmt(u.email)}`);
  console.log(`   users.current_plan_id : ${fmt(u.current_plan_id)}`);
  console.log(`   users.subscription_st : ${fmt(u.subscription_status)}`);

  const { rows: subs } = await client.query(
    `SELECT id, plan_id, status, payment_provider, current_period_start, current_period_end
       FROM subscriptions WHERE user_id = $1 ORDER BY current_period_start DESC`,
    [userId],
  );
  if (subs.length === 0) {
    console.log('   subscriptions         : (none)');
  } else {
    console.log(`   subscriptions         : ${subs.length} row(s)`);
    for (const s of subs) {
      console.log(
        `     - id=${fmt(s.id)} plan=${fmt(s.plan_id)} status=${fmt(s.status)} ` +
          `provider=${fmt(s.payment_provider)} period_end=${fmt(s.current_period_end)}`,
      );
    }
  }
  return { found: true };
}

/** Best-effort Clerk publicMetadata.planId sync (display + soft-fallback only). */
async function syncClerk(userId: string, plan: string): Promise<void> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    console.log('   ⚠️ CLERK_SECRET_KEY not set — skipping Clerk metadata sync (DB is authoritative).');
    return;
  }
  // PATCH merges top-level public_metadata keys. Setting planSyncedAt lets the
  // client cache detect a stale value and refetch (PHO-247). Also normalize the
  // legacy `medical_beta` flag so leaving the promo plan clears the MedicalBeta
  // feedback UI / flag-based checks instead of leaving a stale `true`.
  const publicMetadata = {
    medical_beta: plan === 'medical_beta',
    planId: plan,
    planSyncedAt: Date.now(),
  };
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}/metadata`, {
    body: JSON.stringify({ public_metadata: publicMetadata }),
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    method: 'PATCH',
  });
  if (res.ok) {
    console.log(`   ✅ Clerk publicMetadata.planId → ${plan} (medical_beta=${plan === 'medical_beta'})`);
  } else {
    console.log(`   ⚠️ Clerk sync failed (${res.status}): ${await res.text()}`);
  }
}

/** Read-only: list paid users whose resolved DB plan != Clerk publicMetadata.planId. */
async function scanClerk(client: PoolClient): Promise<void> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    console.error('❌ CLERK_SECRET_KEY required for --scan-clerk.');
    process.exit(1);
  }
  await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

  // Resolved plan = active subscription plan if present, else users.current_plan_id
  // — the same precedence getUserPlanFromDB uses. Only paid users are worth
  // checking; free↔free drift is harmless.
  const { rows } = await client.query(
    `SELECT u.id,
            u.email,
            coalesce(s.plan_id, u.current_plan_id, 'vn_free') AS db_plan
       FROM users u
       LEFT JOIN LATERAL (
         SELECT plan_id FROM subscriptions
          WHERE user_id = u.id AND status = 'active'
          ORDER BY current_period_start DESC
          LIMIT 1
       ) s ON true
      WHERE lower(coalesce(s.plan_id, u.current_plan_id, 'vn_free'))
            NOT IN ('vn_free', 'gl_starter', 'free', 'trial', 'starter')`,
  );

  console.log('🔎 DB(resolved) ↔ Clerk planId scan (READ-ONLY)');
  console.log(`   Checking ${rows.length} paid user(s) against Clerk…\n${'='.repeat(72)}`);

  const mismatches: Array<{ clerkPlan: string; dbPlan: string; email: string; id: string }> = [];
  let checked = 0;
  for (const r of rows) {
    checked++;
    if (checked % 50 === 0) console.log(`   …checked ${checked}/${rows.length}`);
    try {
      const res = await fetch(`https://api.clerk.com/v1/users/${r.id}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!res.ok) {
        console.log(`   ⚠️ Clerk lookup ${fmt(r.id)} → ${res.status}`);
        continue;
      }
      const cu = (await res.json()) as { public_metadata?: { planId?: unknown } };
      const clerkPlan = cu?.public_metadata?.planId;
      if (typeof clerkPlan !== 'string' || !clerkPlan) continue; // no Clerk plan → skip
      if (clerkPlan.toLowerCase() === String(r.db_plan).toLowerCase()) continue;
      mismatches.push({ clerkPlan, dbPlan: String(r.db_plan), email: r.email ?? '∅', id: r.id });
    } catch (e) {
      console.log(`   ⚠️ Clerk lookup ${fmt(r.id)} failed: ${(e as Error).message}`);
    }
  }

  console.log(`\n${'='.repeat(72)}`);
  if (mismatches.length === 0) {
    console.log('✅ No DB↔Clerk plan drift among paid users.');
    return;
  }
  for (const m of mismatches) {
    console.log(
      `\n▶ ${m.id}  ${m.email}` +
        `\n    DB(resolved) = ${m.dbPlan}   Clerk = ${m.clerkPlan}` +
        `\n    → sync Clerk to DB: bunx tsx scripts/sync-user-plan.ts --user ${m.id} --plan ${m.dbPlan} --apply`,
    );
  }
  console.log(`\n${mismatches.length} user(s) with DB↔Clerk drift.`);
}

/**
 * Cancel redundant active subscriptions, keeping the single best row per user.
 * "Best" = a real (non-free) payment provider first, then the furthest
 * current_period_end, then the most recent start. Read-only without --apply.
 */
async function dedupeSubs(
  client: PoolClient,
  userId: string | undefined,
  apply: boolean,
): Promise<void> {
  if (!apply) await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

  const dupUsers = await client.query(
    `SELECT user_id, count(*)::int AS n
       FROM subscriptions
      WHERE status = 'active'${userId ? ' AND user_id = $1' : ''}
      GROUP BY user_id
     HAVING count(*) > 1
      ORDER BY n DESC`,
    userId ? [userId] : [],
  );

  console.log(`🧹 Dedupe active subscriptions (${apply ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`   Users with >1 active subscription: ${dupUsers.rowCount}\n${'='.repeat(72)}`);

  if (dupUsers.rowCount === 0) {
    console.log('   ✅ No user has duplicate active subscriptions.');
    return;
  }

  let totalCanceled = 0;
  for (const du of dupUsers.rows) {
    const { rows: subs } = await client.query(
      `SELECT id, plan_id, payment_provider, current_period_start, current_period_end
         FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
      [du.user_id],
    );

    const scored = [...subs].sort((a, b) => {
      const aReal = String(a.payment_provider) === 'free' ? 0 : 1;
      const bReal = String(b.payment_provider) === 'free' ? 0 : 1;
      if (aReal !== bReal) return bReal - aReal;
      const aEnd = a.current_period_end ? new Date(a.current_period_end).getTime() : 0;
      const bEnd = b.current_period_end ? new Date(b.current_period_end).getTime() : 0;
      if (aEnd !== bEnd) return bEnd - aEnd;
      const aStart = a.current_period_start ? new Date(a.current_period_start).getTime() : 0;
      const bStart = b.current_period_start ? new Date(b.current_period_start).getTime() : 0;
      return bStart - aStart;
    });
    const keep = scored[0];
    const drop = scored.slice(1);

    console.log(`\n▶ ${du.user_id}  (${du.n} active)`);
    console.log(
      `   KEEP   : id=${fmt(keep.id)} plan=${fmt(keep.plan_id)} provider=${fmt(keep.payment_provider)} end=${fmt(keep.current_period_end)}`,
    );
    for (const d of drop) {
      console.log(
        `   CANCEL : id=${fmt(d.id)} plan=${fmt(d.plan_id)} provider=${fmt(d.payment_provider)} end=${fmt(d.current_period_end)}`,
      );
    }

    if (apply) {
      const dropIds = drop.map((d) => d.id);
      await client.query(
        `UPDATE subscriptions
            SET status = 'canceled', cancel_at_period_end = true, updated_at = now()
          WHERE id = ANY($1::text[])`,
        [dropIds],
      );
      totalCanceled += dropIds.length;
    }
  }

  console.log(`\n${'='.repeat(72)}`);
  if (apply) console.log(`✅ Canceled ${totalCanceled} redundant active subscription row(s).`);
  else console.log('Dry-run — re-run with --apply to cancel the rows marked CANCEL.');
}

async function reconcile(client: PoolClient, userId: string, plan: string, apply: boolean): Promise<void> {
  console.log(`\n▶ Reconcile ${userId} → ${plan}  (${apply ? 'APPLY' : 'DRY-RUN'})`);

  if (!apply) await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

  const { found } = await printUserState(client, userId);
  if (!found) return;

  if (!apply) {
    console.log('\n   DRY-RUN — would perform:');
    console.log(`     • UPDATE subscriptions SET plan_id='${plan}', status='active' WHERE user_id=… AND status='active'`);
    console.log(`     • UPDATE users SET current_plan_id='${plan}', subscription_status='ACTIVE' WHERE id=…`);
    console.log(`     • Clerk publicMetadata.planId='${plan}' (if CLERK_SECRET_KEY set)`);
    console.log('\n   Re-run with --apply to write.');
    return;
  }

  await client.query('BEGIN');
  try {
    // Align active subscription row(s). Preserve billing periods — this is a
    // correction, not a new billing cycle.
    const upd = await client.query(
      `UPDATE subscriptions
          SET plan_id = $1, status = 'active', updated_at = now()
        WHERE user_id = $2 AND status = 'active'
        RETURNING id`,
      [plan, userId],
    );

    if (upd.rowCount === 0) {
      // No active row — promote the most recent row, or create one.
      const latest = await client.query(
        `SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY current_period_start DESC LIMIT 1`,
        [userId],
      );
      if (latest.rowCount && latest.rowCount > 0) {
        await client.query(
          `UPDATE subscriptions SET plan_id=$1, status='active', updated_at=now() WHERE id=$2`,
          [plan, latest.rows[0].id],
        );
        console.log(`   ✅ subscriptions: promoted row ${latest.rows[0].id} → ${plan} (active)`);
      } else {
        const end = new Date();
        end.setFullYear(end.getFullYear() + 1);
        await client.query(
          `INSERT INTO subscriptions (user_id, plan_id, status, billing_cycle, current_period_end, payment_provider)
           VALUES ($1, $2, 'active', 'yearly', $3, 'manual')`,
          [userId, plan, end],
        );
        console.log(`   ✅ subscriptions: inserted new active row → ${plan}`);
      }
    } else {
      console.log(`   ✅ subscriptions: ${upd.rowCount} active row(s) → ${plan}`);
    }

    await client.query(
      `UPDATE users SET current_plan_id = $1, subscription_status = 'ACTIVE' WHERE id = $2`,
      [plan, userId],
    );
    console.log(`   ✅ users.current_plan_id → ${plan} (ACTIVE)`);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }

  await syncClerk(userId, plan);

  console.log('\n   ── after ──');
  await printUserState(client, userId);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL environment variable.');
    process.exit(1);
  }

  if (!args.scan && !args.scanClerk && !args.dedupeSubs && (!args.user || !args.plan)) {
    console.error(
      'Usage:\n  --scan\n  --scan-clerk\n  --dedupe-subs [--user <id>] [--apply]\n  --user <id> --plan <planId> [--apply]',
    );
    process.exit(1);
  }

  if (args.plan && !VALID_PLANS.has(args.plan) && !args.force) {
    console.error(`❌ Unknown plan "${args.plan}". Use a known plan code or pass --force.`);
    console.error(`   Known: ${[...VALID_PLANS].join(', ')}`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: true });
  const client = await pool.connect();
  try {
    if (args.scan) {
      await scan(client);
    } else if (args.scanClerk) {
      await scanClerk(client);
    } else if (args.dedupeSubs) {
      await dedupeSubs(client, args.user, args.apply);
    } else {
      await reconcile(client, args.user!, args.plan!, args.apply);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('❌ sync-user-plan failed:', e);
  process.exit(1);
});
