/* eslint-disable unicorn/no-process-exit, unicorn/prefer-top-level-await */
/**
 * Scan (and optionally repair) paid users whose Phở Points were silently
 * drained by the monthly-grant gap.
 *
 * Why this exists
 * ---------------
 * Two support cases (larg.nguyen, nguyentruongcan.py) revealed that paid users
 * could run their Phở Points down to near-zero and NEVER get refilled, because
 * the monthly-points cron only grants users whose `users.subscription_status`
 * is 'ACTIVE' — and medical_beta wasn't even covered by the cron until the
 * 2026-06-01 fix. Any paid user granted before that, or whose users-table
 * status drifted, has been bleeding points every day with no monthly reset.
 *
 * What this scans
 * ---------------
 * Spine = every row in `subscriptions` with status='active' (the source of
 * truth for entitlement, per getUserPlanFromDB). For each paid monthly-grant
 * plan it compares the user's live `pho_points_balance` against the plan's
 * allowance and checks whether the cron actually granted them this month.
 *
 * It flags as 🔴 ACTIONABLE a user who is: entitled (subscription period not
 * expired) AND below their plan allowance AND was NOT properly granted this
 * month (status drift, or points_reset_date stale / null). Those are exactly
 * the users the cron should have refilled but didn't.
 *
 * NOT covered here: the Clerk-paid-but-no-DB-subscription drift class (e.g.
 * larg.nguyen) — that needs a Clerk scan, handled by
 * `scripts/sync-user-plan.ts --scan-clerk`.
 *
 * Usage (needs .env.local with DATABASE_URL):
 *   npx tsx scripts/scan-drained-paid-users.ts            # dry-run report
 *   npx tsx scripts/scan-drained-paid-users.ts --apply    # top up 🔴 users
 *   npx tsx scripts/scan-drained-paid-users.ts --apply --force   # if >50 users
 */
import dotenv from 'dotenv';
import { Pool } from 'pg';

import { getMonthlyPointsForPlan, isMonthlyGrantPlan } from '../src/config/pricing';

dotenv.config({ override: true, path: '.env.local' });
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL (set it in .env.local)');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const LOW_PCT = 0.1; // balance below 10% of plan allowance = "drained"

const isLifetimePlan = (planId: string) => planId.toLowerCase().includes('lifetime');

function getEndOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString();

interface Row {
  balance: number | null;
  email: string | null;
  last_usage: Date | string | null;
  reset_date: Date | string | null;
  sub_end: Date | string | null;
  sub_plan: string;
  sub_start: Date | string | null;
  user_id: string;
  users_plan: string | null;
  users_status: string | null;
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  try {
    const result = await pool.query(`
      SELECT
        s.user_id,
        s.plan_id            AS sub_plan,
        s.current_period_start AS sub_start,
        s.current_period_end   AS sub_end,
        u.email,
        u.current_plan_id    AS users_plan,
        u.subscription_status AS users_status,
        u.pho_points_balance AS balance,
        u.points_reset_date  AS reset_date,
        u.last_usage_date    AS last_usage
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.status = 'active'
    `);
    const rows = result.rows as Row[];

    // Dedupe to one active subscription per user (prefer higher allowance, then
    // later period end) so a user with multiple rows isn't double-counted.
    const byUser = new Map<string, Row>();
    for (const r of rows) {
      if (!isMonthlyGrantPlan(r.sub_plan)) continue; // paid monthly-grant plans only
      const cur = byUser.get(r.user_id);
      if (!cur) {
        byUser.set(r.user_id, r);
        continue;
      }
      const better =
        getMonthlyPointsForPlan(r.sub_plan) > getMonthlyPointsForPlan(cur.sub_plan) ||
        (getMonthlyPointsForPlan(r.sub_plan) === getMonthlyPointsForPlan(cur.sub_plan) &&
          new Date(r.sub_end ?? 0).getTime() > new Date(cur.sub_end ?? 0).getTime());
      if (better) byUser.set(r.user_id, r);
    }

    const analyzed = [...byUser.values()].map((r) => {
      const allowance = getMonthlyPointsForPlan(r.sub_plan);
      const balance = Number(r.balance ?? 0);
      const pct = allowance > 0 ? balance / allowance : 1;
      const end = r.sub_end ? new Date(r.sub_end) : null;
      const expired = end ? end.getTime() < now.getTime() : false;
      const resetDate = r.reset_date ? new Date(r.reset_date) : null;
      const grantedThisMonth = resetDate ? resetDate.getTime() >= monthStart.getTime() : false;
      const lifetime = isLifetimePlan(r.sub_plan);
      const cronSkips = !lifetime && (r.users_status ?? '').toUpperCase() !== 'ACTIVE';
      const planDrift = (r.users_plan ?? '').toLowerCase() !== r.sub_plan.toLowerCase();
      const drained = pct < LOW_PCT;
      // Entitled, under allowance, and NOT properly granted this month.
      const actionable = !expired && balance < allowance && (cronSkips || !grantedThisMonth);
      return {
        ...r,
        actionable,
        allowance,
        balance,
        cronSkips,
        drained,
        expired,
        grantedThisMonth,
        lifetime,
        pct,
        planDrift,
      };
    });

    analyzed.sort((a, b) => Number(b.actionable) - Number(a.actionable) || a.pct - b.pct);

    const actionable = analyzed.filter((r) => r.actionable);
    const expired = analyzed.filter((r) => r.expired);
    const lowButGranted = analyzed.filter((r) => r.drained && !r.actionable && !r.expired);

    console.log('\n' + '='.repeat(72));
    console.log(`📊 Paid-user Phở Points scan — ${now.toISOString()}`);
    console.log('='.repeat(72));
    console.log(`   Active-subscription paid users:                 ${analyzed.length}`);
    console.log(`   🔴 Actionable (entitled, under-allowance, not granted): ${actionable.length}`);
    console.log(`   🟡 Low but granted this month (likely real usage):      ${lowButGranted.length}`);
    console.log(`   ⚪ Expired active-sub rows (review manually):            ${expired.length}`);
    console.log('='.repeat(72));

    const view = (r: (typeof analyzed)[number]) => ({
      'bal%': (r.pct * 100).toFixed(1) + '%',
      allowance: fmt(r.allowance),
      balance: fmt(r.balance),
      cronSkips: r.cronSkips,
      email: r.email,
      grantedThisMo: r.grantedThisMonth,
      plan: r.sub_plan,
      planDrift: r.planDrift ? `${r.users_plan ?? 'null'}→${r.sub_plan}` : '',
    });

    if (actionable.length > 0) {
      console.log('\n🔴 ACTIONABLE — would top up to plan allowance:\n');
      console.table(actionable.map(view));
    }
    if (lowButGranted.length > 0) {
      console.log('\n🟡 LOW BALANCE but already granted this month (NOT auto-fixed):\n');
      console.table(lowButGranted.map(view));
    }
    if (expired.length > 0) {
      console.log('\n⚪ EXPIRED active-subscription rows (entitlement lapsed — review):\n');
      console.table(expired.map(view));
    }

    if (!APPLY) {
      console.log('\nℹ️  DRY RUN. Re-run with --apply to top up the 🔴 actionable users.');
      return;
    }
    if (actionable.length === 0) {
      console.log('\n✅ Nothing to apply.');
      return;
    }
    if (actionable.length > 50 && !FORCE) {
      console.log(
        `\n⚠️  ${actionable.length} users would be modified (>50 safety gate). ` +
          `Re-run with --apply --force to proceed.`,
      );
      return;
    }

    console.log(`\n✍️  Applying top-up to ${actionable.length} user(s)...`);
    const resetDate = getEndOfMonth();
    let ok = 0;
    let fail = 0;
    for (const r of actionable) {
      try {
        // GREATEST(): never reduce a balance. Set status ACTIVE so the cron
        // picks them up going forward; align current_plan_id with the active sub.
        await pool.query(
          `UPDATE users
             SET pho_points_balance = GREATEST(pho_points_balance, $1),
                 subscription_status = 'ACTIVE',
                 current_plan_id     = $2,
                 points_reset_date   = $3,
                 updated_at          = NOW()
           WHERE id = $4`,
          [r.allowance, r.sub_plan, resetDate, r.user_id],
        );
        ok++;
        console.log(
          `   ✅ ${r.email}: ${fmt(r.balance)} → ${fmt(Math.max(r.balance, r.allowance))} (${r.sub_plan})`,
        );
      } catch (e) {
        fail++;
        console.error(`   ❌ ${r.email}:`, e instanceof Error ? e.message : e);
      }
    }
    console.log(`\n🎉 Applied. Success: ${ok}, Failed: ${fail}.`);
    console.log('   Clerk metadata not touched (gating reads the DB subscription).');
    console.log('   Affected users should refresh pho.chat (Ctrl+Shift+R).');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Scan failed:', err);
  process.exit(1);
});
