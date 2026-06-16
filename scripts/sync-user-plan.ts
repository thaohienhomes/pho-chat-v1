#!/usr/bin/env tsx
/**
 * Sync a user's plan across ALL sources of truth (users + subscriptions + Clerk).
 *
 * WHY THIS EXISTS
 * ---------------
 * `users.current_plan_id` and the `subscriptions` table can silently diverge:
 *   - `/api/promo/activate` and `/api/subscription/upgrade` write the
 *     `subscriptions` row.
 *   - One-off admin scripts (e.g. `scripts/manual-db-sync.ts`) update ONLY
 *     `users.current_plan_id`.
 * `getUserPlanFromDB` reads the SUBSCRIPTIONS row FIRST (PHO-241), so a stale
 * subscription silently overrides `users.current_plan_id` and the user is gated
 * on the wrong plan — and `diagnose-auth-lockout.ts` (which only read
 * `users.current_plan_id`) reported them as "healthy".
 *
 * REAL CASE (2026-06): nga.ntv@gmail.com — users.current_plan_id='vn_ultimate'
 * but a leftover active `subscriptions` row planId='medical_beta'. medical_beta
 * blocks Tier 3, so flagship/"Cao cấp" models were greyed out despite Ultimate.
 *
 * USAGE
 * -----
 *   # Read-only. List every user whose ACTIVE subscription plan disagrees with
 *   # users.current_plan_id (the full divergence cohort).
 *   bunx tsx scripts/sync-user-plan.ts --scan
 *
 *   # Dry-run for one user: print current state + intended changes (no writes).
 *   bunx tsx scripts/sync-user-plan.ts --user user_xxx --plan vn_ultimate
 *
 *   # Apply: align subscriptions + users (+ Clerk) to <plan>.
 *   bunx tsx scripts/sync-user-plan.ts --user user_xxx --plan vn_ultimate --apply
 *
 * Requires env: DATABASE_URL  (CLERK_SECRET_KEY optional — enables Clerk sync).
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
  force: boolean;
  plan?: string;
  scan: boolean;
  user?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, force: false, scan: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scan') args.scan = true;
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
      WHERE lower(coalesce(u.current_plan_id, '')) <> lower(s.plan_id)
      ORDER BY u.current_plan_id, u.email`,
  );

  console.log('🔎 Plan divergence scan (READ-ONLY)');
  console.log(`   users.current_plan_id  ≠  active subscriptions.plan_id\n${'='.repeat(72)}`);

  if (rows.length === 0) {
    console.log('   ✅ No divergence found. All active subscriptions match users.current_plan_id.');
    return;
  }

  for (const r of rows) {
    const usersPaid = !FREE_PLANS.has(String(r.users_plan ?? 'vn_free').toLowerCase());
    const subPaid = !FREE_PLANS.has(String(r.sub_plan).toLowerCase());
    // The subscription wins at runtime. If users is the HIGHER paid plan, the
    // user is being under-served (the nga.ntv case).
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
  const res = await fetch(`https://api.clerk.com/v1/users/${userId}/metadata`, {
    body: JSON.stringify({ public_metadata: { planId: plan, planSyncedAt: Date.now() } }),
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    method: 'PATCH',
  });
  if (res.ok) {
    console.log(`   ✅ Clerk publicMetadata.planId → ${plan}`);
  } else {
    console.log(`   ⚠️ Clerk sync failed (${res.status}): ${await res.text()}`);
  }
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

  if (!args.scan && (!args.user || !args.plan)) {
    console.error('Usage:\n  --scan\n  --user <id> --plan <planId> [--apply]');
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
