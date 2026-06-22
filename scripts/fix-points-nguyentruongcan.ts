/* eslint-disable unicorn/no-process-exit, unicorn/prefer-top-level-await */
/**
 * Fix Phở Points + plan drift for nguyentruongcan.py@gmail.com
 *
 * Complaint: "Phở Point Balance có 500 thôi" (balance shows only 500).
 *
 * Root cause (Sepay grant-gap / DB↔Clerk drift):
 *   - User PAID for medical_beta via Sepay on 2026-02-26
 *     (order PHO_SUB_1772095407403_KS7HIV, txn 43393894, 999k VNĐ/year).
 *   - Clerk publicMetadata.planId = 'medical_beta' (correct), BUT the DB
 *     subscription/points never tracked it: balance drained from the initial
 *     grant down to 500 over ~4 months and the monthly-points cron never
 *     restored it (the cron requires subscription_status = 'ACTIVE', and
 *     medical_beta wasn't even covered by the cron until the 2026-06-01 fix).
 *
 * This script DIAGNOSES first (prints current Clerk + DB state) then RESTORES:
 *   1. users: currentPlanId=medical_beta, subscriptionStatus=ACTIVE,
 *      phoPointsBalance=1,000,000, pointsResetDate=end of month, daily counters→0
 *   2. subscriptions: upsert medical_beta / active, honoring the paid year
 *      (never SHORTENS an existing period)
 *   3. sepay_payments: append a manual-resolution audit record
 *   4. Clerk: re-stamp planId + planSyncedAt for the reconciliation trail
 *
 * Run locally (needs .env.local with DATABASE_URL + CLERK_SECRET_KEY):
 *   npx tsx scripts/fix-points-nguyentruongcan.ts
 */
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// Load from .env.local first, then fall back to .env
dotenv.config({ override: true, path: '.env.local' });
dotenv.config();

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!CLERK_SECRET_KEY || !DATABASE_URL) {
  console.error('❌ Missing CLERK_SECRET_KEY or DATABASE_URL (set them in .env.local)');
  process.exit(1);
}

// ── Target user ──────────────────────────────────────
const USER_ID = 'user_3ACScnPaTJ4Qja0fRdiCeL2O7XK';
const USER_EMAIL = 'nguyentruongcan.py@gmail.com';

// ── Plan: medical_beta (Phở Medical Beta 🏥) ─────────
const PLAN_ID = 'medical_beta';
const MONTHLY_POINTS = 1_000_000; // medical_beta monthly allowance (src/config/pricing.ts)
const BILLING_CYCLE = 'yearly';
const AMOUNT_VND = 999_000;

// Their actual paid period (from order PHO_SUB_1772095407403, ts 1772095407403ms).
const PAID_START = new Date('2026-02-26T08:43:27.403Z');
const PAID_END = new Date('2027-02-26T23:59:59.999Z');

function getEndOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

async function main() {
  console.log('\n' + '='.repeat(64));
  console.log('🔧 Fix Phở Points — medical_beta grant-gap restoration');
  console.log('='.repeat(64));
  console.log(`   User:   ${USER_EMAIL}`);
  console.log(`   UserID: ${USER_ID}`);
  console.log(`   Plan:   ${PLAN_ID} (${BILLING_CYCLE})`);
  console.log('='.repeat(64));

  // ── Step 1: Verify user in Clerk + show current metadata ──
  console.log('\n📋 Step 1: Verify user in Clerk...');
  const clerkRes = await fetch(`https://api.clerk.com/v1/users/${USER_ID}`, {
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
  });
  if (!clerkRes.ok) {
    console.error('❌ User not found in Clerk:', USER_ID);
    process.exit(1);
  }
  const clerkUser = await clerkRes.json();
  const email = clerkUser.email_addresses?.[0]?.email_address;
  console.log(`   ✅ Found: ${email}`);
  console.log('   Current Clerk publicMetadata:', JSON.stringify(clerkUser.public_metadata ?? {}));
  if (email && email.toLowerCase() !== USER_EMAIL.toLowerCase()) {
    console.error(`❌ Email mismatch: Clerk has ${email}, expected ${USER_EMAIL}. Aborting.`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const db = drizzle(pool);

  try {
    const { users: usersTable } = await import('../packages/database/src/schemas/user');
    const { subscriptions, sepayPayments } = await import(
      '../packages/database/src/schemas/billing'
    );

    // ── Step 2: DIAGNOSE — print current DB state ──────
    console.log('\n🔎 Step 2: Current DB state (BEFORE)...');
    const before = await pool.query(
      `SELECT id, email, current_plan_id, subscription_status, pho_points_balance,
              points_reset_date, last_usage_date,
              daily_tier1_usage, daily_tier2_usage, daily_tier3_usage
       FROM users WHERE id = $1`,
      [USER_ID],
    );
    if (before.rows.length === 0) {
      console.error('❌ User not found in DB. They must log in at least once. Aborting.');
      process.exit(1);
    }
    console.table(before.rows);

    const subsBefore = await pool.query(
      `SELECT id, plan_id, status, billing_cycle, current_period_start, current_period_end,
              payment_provider
       FROM subscriptions WHERE user_id = $1 ORDER BY current_period_start DESC`,
      [USER_ID],
    );
    console.log(`   subscriptions rows: ${subsBefore.rows.length}`);
    if (subsBefore.rows.length > 0) console.table(subsBefore.rows);

    const paysBefore = await pool.query(
      `SELECT order_id, plan_id, amount_vnd, status, transaction_id, created_at
       FROM sepay_payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [USER_ID],
    );
    console.log(`   sepay_payments rows: ${paysBefore.rows.length}`);
    if (paysBefore.rows.length > 0) console.table(paysBefore.rows);

    // ── Step 3: Restore users row ──────────────────────
    console.log('\n💾 Step 3: Restore users row...');
    const pointsResetDate = getEndOfMonth();
    const usersResult = await db
      .update(usersTable)
      .set({
        currentPlanId: PLAN_ID,
        dailyTier1Usage: 0,
        dailyTier2Usage: 0,
        dailyTier3Usage: 0,
        phoPointsBalance: MONTHLY_POINTS,
        pointsResetDate,
        subscriptionStatus: 'ACTIVE',
      })
      .where(eq(usersTable.id, USER_ID))
      .returning({
        currentPlanId: usersTable.currentPlanId,
        phoPointsBalance: usersTable.phoPointsBalance,
        pointsResetDate: usersTable.pointsResetDate,
        subscriptionStatus: usersTable.subscriptionStatus,
      });
    console.log('   ✅ users updated:', JSON.stringify(usersResult[0]));

    // ── Step 4: Upsert subscription (never shorten) ────
    console.log('\n📦 Step 4: Upsert subscription...');
    if (subsBefore.rows.length > 0) {
      const existing = subsBefore.rows[0];
      const existingStart = existing.current_period_start
        ? new Date(existing.current_period_start)
        : PAID_START;
      const existingEnd = existing.current_period_end
        ? new Date(existing.current_period_end)
        : PAID_END;
      const newStart = existingStart.getTime() <= PAID_START.getTime() ? existingStart : PAID_START;
      const newEnd = maxDate(existingEnd, PAID_END); // never shorten

      await db
        .update(subscriptions)
        .set({
          billingCycle: BILLING_CYCLE,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: newEnd,
          currentPeriodStart: newStart,
          planId: PLAN_ID,
          status: 'active',
        })
        .where(eq(subscriptions.userId, USER_ID));
      console.log(
        `   ✅ subscription updated (was ${existing.plan_id}/${existing.status}). ` +
          `Period: ${newStart.toISOString()} → ${newEnd.toISOString()}`,
      );
    } else {
      await db.insert(subscriptions).values({
        billingCycle: BILLING_CYCLE,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: PAID_END,
        currentPeriodStart: PAID_START,
        paymentProvider: 'sepay',
        planId: PLAN_ID,
        status: 'active',
        userId: USER_ID,
      });
      console.log(
        `   ✅ subscription inserted. Period: ${PAID_START.toISOString()} → ${PAID_END.toISOString()}`,
      );
    }

    // ── Step 5: Append manual-resolution audit record ──
    console.log('\n🧾 Step 5: Append audit record to sepay_payments...');
    const manualOrderId = `PHO_MANUAL_FIX_${Date.now()}`;
    await db.insert(sepayPayments).values({
      amountVnd: AMOUNT_VND,
      billingCycle: BILLING_CYCLE,
      currency: 'VND',
      orderId: manualOrderId,
      paymentMethod: 'sepay',
      planId: PLAN_ID,
      rawWebhook: {
        activatedBy: 'admin',
        note: 'Manual points restoration — Sepay grant-gap (paid 2026-02-26, balance drained to 500)',
        originalOrderId: 'PHO_SUB_1772095407403_KS7HIV',
        originalTransactionId: '43393894',
        restoredPoints: MONTHLY_POINTS,
        userEmail: USER_EMAIL,
      },
      status: 'success',
      transactionId: `MANUAL_POINTS_FIX_${Date.now()}`,
      userId: USER_ID,
    });
    console.log(`   ✅ audit record created: ${manualOrderId}`);

    // ── Step 6: Re-stamp Clerk planSyncedAt ────────────
    console.log('\n🔐 Step 6: Re-stamp Clerk metadata (merge, non-destructive)...');
    const metaRes = await fetch(`https://api.clerk.com/v1/users/${USER_ID}/metadata`, {
      body: JSON.stringify({
        public_metadata: {
          activatedBy: 'admin-manual-points-fix-sepay-grant-gap',
          planId: PLAN_ID,
          planSyncedAt: Date.now(),
        },
      }),
      headers: {
        'Authorization': `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });
    if (!metaRes.ok) {
      console.warn('   ⚠️ Clerk metadata stamp failed (non-fatal):', await metaRes.text());
    } else {
      console.log('   ✅ Clerk metadata stamped: planId = medical_beta');
    }

    // ── Step 7: Verify final DB state ──────────────────
    console.log('\n✅ Step 7: Final DB state (AFTER)...');
    const after = await pool.query(
      `SELECT current_plan_id, subscription_status, pho_points_balance, points_reset_date
       FROM users WHERE id = $1`,
      [USER_ID],
    );
    console.table(after.rows);
  } finally {
    await pool.end();
  }

  console.log('\n' + '='.repeat(64));
  console.log('🎉 Done!');
  console.log(`   📧 ${USER_EMAIL}`);
  console.log(`   📦 Plan:   Phở Medical Beta 🏥 (${PLAN_ID})`);
  console.log(`   💎 Points: ${MONTHLY_POINTS.toLocaleString()} (restored)`);
  console.log('   🔄 Ask the user to refresh pho.chat (Ctrl+Shift+R).');
  console.log('='.repeat(64));
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
