#!/usr/bin/env tsx
/**
 * Auth Lockout Diagnostic — READ-ONLY
 *
 * Cross-checks the DB state of users flagged as "stuck" by the PostHog auth
 * incident (repeated `auth_session_expired` + tRPC `UNAUTHORIZED`, 0 successful
 * generations). The lockout is a Clerk token-verification failure, NOT billing,
 * so the goal here is to (a) pull each user's email for outreach and (b) confirm
 * their plan/subscription data is healthy — which rules data out and points at
 * Clerk (CLERK_SECRET_KEY ↔ publishable-key instance / JWKS rotation).
 *
 * In this codebase `users.id` IS the Clerk user id (e.g. `user_3AHqb...`), and
 * `subscriptions.user_id` references it — there is no separate `clerk_id` column.
 *
 * Usage:
 *   bunx tsx scripts/diagnose-auth-lockout.ts                 # default stuck cohort
 *   bunx tsx scripts/diagnose-auth-lockout.ts user_abc user_def
 *
 * Requires env: DATABASE_URL
 */
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

// Locked-out cohort from the auth incident (clerk user ids = users.id). Refreshed
// 2026-06-07 from PostHog: these users had repeated auth_session_expired + 0
// successful generations in the trailing 3 days. medical_beta / lifetime users
// who recovered after a transient blip were intentionally dropped.
const DEFAULT_USER_IDS = [
  'user_3AAVrKnSm3HKlfMvkAFkMAStB9q', // huyenvu27996@gmail.com — 10 expiries / 0 use, active today (worst)
  'user_3AHqbtQL7RbGor1LzSOS0EA2vj3', // nga.ntv@gmail.com — vn_ultimate, 0 use
  'user_3ATwWWyJPHHf5Wy8OkcLyAddhdX', // bshuyenks@gmail.com — 1 expiry / 0 use
];

// Plans treated as free-tier when judging "paid but mis-flagged" desync.
const FREE_PLANS = new Set(['vn_free', 'gl_starter', 'free', 'trial', 'starter']);

const userIds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_USER_IDS;

if (!process.env.DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL environment variable.');
  process.exit(1);
}

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '∅';
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  // Hard guarantee: this session can only read. Any stray write would error out.
  await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

  const { rows: userRows } = await client.query(
    `SELECT id, email, full_name, country_code, current_plan_id, subscription_status,
            pho_points_balance, points_reset_date, last_usage_date, created_at
       FROM users
      WHERE id = ANY($1::text[])`,
    [userIds],
  );

  const { rows: subRows } = await client.query(
    `SELECT user_id, plan_id, status, payment_provider, billing_cycle,
            current_period_start, current_period_end, cancel_at_period_end
       FROM subscriptions
      WHERE user_id = ANY($1::text[])
      ORDER BY current_period_start DESC`,
    [userIds],
  );

  const userById = new Map<string, any>(userRows.map((u) => [u.id, u]));
  const subsByUser = new Map<string, any[]>();
  for (const s of subRows) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id)!.push(s);
  }

  console.log('🔐 Auth Lockout Diagnostic (READ-ONLY)');
  console.log(`   Checking ${userIds.length} user(s)\n${'='.repeat(64)}`);

  for (const id of userIds) {
    const u = userById.get(id);
    console.log(`\n▶ ${id}`);

    if (!u) {
      console.log('   ❌ NOT FOUND in users table.');
      console.log('      → Clerk id may be wrong, or the user never synced to the DB.');
      console.log('      → A Clerk session with no DB row resolves to UNAUTHORIZED / user-not-found.');
      continue;
    }

    console.log(`   email            : ${fmt(u.email)}`);
    console.log(`   full_name        : ${fmt(u.full_name)}`);
    console.log(`   country_code     : ${fmt(u.country_code)}`);
    console.log(`   current_plan_id  : ${fmt(u.current_plan_id)}`);
    console.log(`   subscription_stat: ${fmt(u.subscription_status)}`);
    console.log(`   pho_points       : ${fmt(u.pho_points_balance)}`);
    console.log(`   points_reset_date: ${fmt(u.points_reset_date)}`);
    console.log(`   last_usage_date  : ${fmt(u.last_usage_date)}`);
    console.log(`   created_at       : ${fmt(u.created_at)}`);

    const subs = subsByUser.get(id) ?? [];
    if (subs.length === 0) {
      console.log('   subscriptions    : (none)');
    } else {
      console.log(`   subscriptions    : ${subs.length} row(s)`);
      for (const s of subs) {
        console.log(
          `     - plan=${fmt(s.plan_id)} status=${fmt(s.status)} provider=${fmt(s.payment_provider)} ` +
            `period_end=${fmt(s.current_period_end)} cancelAtEnd=${fmt(s.cancel_at_period_end)}`,
        );
      }
    }

    // ── Verdict ───────────────────────────────────────────────────────────
    const plan = String(u.current_plan_id ?? 'vn_free');
    const isPaidPlan = !FREE_PLANS.has(plan);
    const statusActive = String(u.subscription_status ?? '').toUpperCase() === 'ACTIVE';
    const hasActiveSub = subs.some((s) => String(s.status) === 'active');

    // PLAN DRIFT: getUserPlanFromDB resolves the active SUBSCRIPTION row, not
    // users.current_plan_id. If they disagree, the user is silently gated on the
    // subscription plan — a blind spot this script previously missed by reading
    // only users.current_plan_id. (For DB↔Clerk drift instead, use
    // scripts/sync-user-plan.ts --scan-clerk.) Check it FIRST.
    // Pick the active subscription the RUNTIME would resolve (getUserPlanFromDB:
    // lifetime > paid > free, then current_period_start recency) — not just the
    // first active row — so duplicate active rows don't yield a false verdict.
    const activeSubPlan = subs
      .filter((s) => String(s.status) === 'active')
      .sort((a, b) => {
        const aPlan = String(a.plan_id).toLowerCase();
        const bPlan = String(b.plan_id).toLowerCase();
        const isLifetime = (p: string) => p.includes('lifetime') || p.includes('founding');
        const aL = isLifetime(aPlan);
        const bL = isLifetime(bPlan);
        const aF = FREE_PLANS.has(aPlan);
        const bF = FREE_PLANS.has(bPlan);
        if (aL && !bL) return -1;
        if (!aL && bL) return 1;
        if (aF && !bF) return 1;
        if (!aF && bF) return -1;
        return new Date(b.current_period_start).getTime() - new Date(a.current_period_start).getTime();
      })[0]?.plan_id;
    const planDrift =
      activeSubPlan !== undefined && String(activeSubPlan).toLowerCase() !== plan.toLowerCase();

    if (planDrift) {
      const subPaid = !FREE_PLANS.has(String(activeSubPlan).toLowerCase());
      console.log(
        `   ⚠️ PLAN DRIFT: users.current_plan_id="${plan}" but the ACTIVE subscription row is "${fmt(activeSubPlan)}".`,
      );
      console.log(
        `      → getUserPlanFromDB resolves the SUBSCRIPTION ("${fmt(activeSubPlan)}"), so the user is gated on that plan` +
          `${subPaid ? '' : ' (free/limited → paid tiers blocked)'}.`,
      );
      console.log(
        `      → Inspect first (read-only): bunx tsx scripts/sync-user-plan.ts --user ${id} --plan ${plan}`,
      );
      console.log('         then add --apply once the correct target plan is confirmed.');
    } else if (isPaidPlan && statusActive) {
      console.log(
        `   ✅ Billing/plan data is HEALTHY (paid plan + ACTIVE${hasActiveSub ? ' + active subscription row' : ', via users.current_plan_id'}).`,
      );
      console.log('      → The lockout is Clerk-side auth (token verification), NOT data. Check Clerk env / JWKS.');
    } else if (isPaidPlan && !statusActive) {
      console.log(
        `   ⚠️ DESYNC: paid plan "${plan}" but subscription_status="${fmt(u.subscription_status)}" (expected ACTIVE).`,
      );
      console.log('      → Reconcile subscription_status; then re-check auth.');
    } else if (!isPaidPlan && hasActiveSub) {
      console.log(
        `   ⚠️ users.current_plan_id is free ("${plan}") but an active subscription row exists — runtime resolves the subscription plan.`,
      );
    } else {
      console.log(`   ℹ️ Free-tier user ("${plan}"). Lockout (if any) is still auth-side, not billing.`);
    }
  }

  console.log(`\n${'='.repeat(64)}`);
  console.log(`Found ${userRows.length}/${userIds.length} users in DB.`);
  console.log('Next: if billing is healthy across the cohort, the fix is Clerk-side —');
  console.log('verify CLERK_SECRET_KEY ↔ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY share one instance, then redeploy.');
} finally {
  client.release();
  await pool.end();
}
