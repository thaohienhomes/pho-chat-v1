/**
 * Manual Pro activation for larg.nguyen@gmail.com
 * Reason: Sepay webhook failed — payment of 199,000 VND received but not processed
 * Run: npx tsx scripts/manual-activate-pro-larg-nguyen.ts
 */

import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';

// Load from .env.local (same as sync-user-plan.ts), then fallback to .env
dotenv.config({ path: '.env.local' });
dotenv.config();

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!CLERK_SECRET_KEY || !DATABASE_URL) {
  console.error('❌ Missing CLERK_SECRET_KEY or DATABASE_URL');
  process.exit(1);
}

// ── Target User ───────────────────────────────────────
const USER_ID = 'user_39Y2ZW2HkbLsAOtm4w8FTVCnA3k';
const USER_EMAIL = 'larg.nguyen@gmail.com';

// ── Plan: vn_pro (Phở Đặc Biệt) ─────────────────────
const PLAN_ID = 'vn_pro';
const BILLING_CYCLE = 'monthly';
const AMOUNT_VND = 199_000;
const MONTHLY_POINTS = 2_000_000;

function getEndOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔧 Manual Pro Activation');
  console.log('='.repeat(60));
  console.log(`   User:   ${USER_EMAIL}`);
  console.log(`   UserID: ${USER_ID}`);
  console.log(`   Plan:   ${PLAN_ID} (${BILLING_CYCLE})`);
  console.log(`   Amount: ${AMOUNT_VND.toLocaleString()} VND`);
  console.log('='.repeat(60));

  // ── Step 1: Verify user in Clerk ──────────────────
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
  const currentPlanId = clerkUser.public_metadata?.planId;
  console.log(`   ✅ Found: ${email}`);
  console.log(`   Current Clerk planId: ${currentPlanId || '(none)'}`);

  // ── Step 2: Update Clerk publicMetadata ───────────
  console.log('\n📋 Step 2: Update Clerk publicMetadata...');
  const metaRes = await fetch(`https://api.clerk.com/v1/users/${USER_ID}/metadata`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      public_metadata: {
        activatedAt: new Date().toISOString(),
        activatedBy: 'admin-manual-sepay-webhook-failure',
        medical_beta: false,
        planId: PLAN_ID,
        planSyncedAt: Date.now(),
      },
    }),
  });

  if (!metaRes.ok) {
    const err = await metaRes.json();
    console.error('❌ Failed to update Clerk metadata:', JSON.stringify(err, null, 2));
    process.exit(1);
  }
  console.log('   ✅ Clerk publicMetadata updated: planId = vn_pro');

  // ── Step 3: Sync database ─────────────────────────
  console.log('\n📋 Step 3: Sync database...');
  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);

  try {
    const { users: usersTable } = await import('../packages/database/src/schemas/user');
    const { subscriptions, sepayPayments } = await import('../packages/database/src/schemas/billing');

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() + 30); // 1 month
    const pointsResetDate = getEndOfMonth();

    // 3a. Update users table
    const dbResult = await db
      .update(usersTable)
      .set({
        currentPlanId: PLAN_ID,
        phoPointsBalance: MONTHLY_POINTS,
        pointsResetDate,
        subscriptionStatus: 'ACTIVE',
      })
      .where(eq(usersTable.id, USER_ID))
      .returning({
        currentPlanId: usersTable.currentPlanId,
        phoPointsBalance: usersTable.phoPointsBalance,
        subscriptionStatus: usersTable.subscriptionStatus,
      });

    if (dbResult.length === 0) {
      console.error('❌ User not found in database. They may not have logged in yet.');
      process.exit(1);
    }
    console.log('   ✅ users table updated:', dbResult[0]);

    // 3b. Upsert subscriptions table
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, USER_ID));

    if (existing.length > 0) {
      await db
        .update(subscriptions)
        .set({
          billingCycle: BILLING_CYCLE,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          paymentProvider: 'sepay',
          planId: PLAN_ID,
          status: 'active',
        })
        .where(eq(subscriptions.userId, USER_ID));
      console.log(`   ✅ subscriptions table updated (was: ${existing[0].planId})`);
    } else {
      await db.insert(subscriptions).values({
        billingCycle: BILLING_CYCLE,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        paymentProvider: 'sepay',
        planId: PLAN_ID,
        status: 'active',
        userId: USER_ID,
      });
      console.log('   ✅ subscriptions table: new record inserted');
    }
    console.log(`   Period: ${now.toISOString()} → ${periodEnd.toISOString()}`);

    // 3c. Create payment audit record
    const manualOrderId = `PHO_MANUAL_${Date.now()}`;
    await db.insert(sepayPayments).values({
      orderId: manualOrderId,
      userId: USER_ID,
      planId: PLAN_ID,
      billingCycle: BILLING_CYCLE,
      amountVnd: AMOUNT_VND,
      currency: 'VND',
      status: 'success',
      paymentMethod: 'sepay',
      transactionId: `MANUAL_WEBHOOK_FAILURE_${Date.now()}`,
      rawWebhook: {
        note: 'Manual activation — Sepay webhook verification failed',
        activatedBy: 'admin',
        activatedAt: now.toISOString(),
        originalAmount: AMOUNT_VND,
        paymentMethod: 'bank_transfer',
        userEmail: USER_EMAIL,
      },
    });
    console.log(`   ✅ sepay_payments audit record created: ${manualOrderId}`);
  } finally {
    await pool.end();
  }

  // ── Step 4: Summary ───────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('🎉 Activation complete!');
  console.log('='.repeat(60));
  console.log(`   📧 Email:    ${USER_EMAIL}`);
  console.log(`   🆔 UserID:   ${USER_ID}`);
  console.log(`   📦 Plan:     Phở Đặc Biệt (vn_pro)`);
  console.log(`   💰 Points:   ${MONTHLY_POINTS.toLocaleString()} Phở Points`);
  console.log(`   ⏳ Expires:  30 ngày từ hôm nay`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
