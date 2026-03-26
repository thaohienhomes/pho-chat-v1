/* eslint-disable unicorn/no-process-exit, unicorn/prefer-top-level-await */
/**
 * Script: Activate Medical 999K plan for trangbsnhi@gmail.com
 * Run: npx tsx scripts/activate-medical-999k-trangbsnhi.ts
 *
 * Steps:
 * 1. Sets Clerk publicMetadata (planId = 'medical_beta')
 * 2. Syncs Neon DB users table (currentPlanId, phoPointsBalance, pointsResetDate, daily limits)
 * 3. Creates/updates subscription record (30 days)
 * 4. Creates payment record (999,000 VND)
 * 5. Sends welcome email via Resend
 * 6. Verifies DB write by querying back
 */
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { resolve } from 'node:path';
import { Pool } from 'pg';

dotenv.config({ path: resolve(process.cwd(), '.env.vercel.production') });
const savedClerkKey = process.env.CLERK_SECRET_KEY;
const savedResendKey = process.env.RESEND_API_KEY;
dotenv.config({ override: true, path: resolve(process.cwd(), '.env.local') });
process.env.CLERK_SECRET_KEY = savedClerkKey!;
// Use RESEND_API_KEY from .env.local if available, else fall back to production
if (!process.env.RESEND_API_KEY && savedResendKey) {
  process.env.RESEND_API_KEY = savedResendKey;
}

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!CLERK_SECRET_KEY) {
  console.error('❌ CLERK_SECRET_KEY not found');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found');
  process.exit(1);
}

// ── Target User ──────────────────────────────────────
const TARGET_USER_ID = 'user_3BPvdSBFiu0LYdtjRLc5YLKtrmO';
const TARGET_EMAIL = 'trangbsnhi@gmail.com';

// ── Plan Config ──────────────────────────────────────
const PLAN_ID = 'medical_beta';
const MONTHLY_POINTS = 1_000_000;
const AMOUNT_VND = 999_000;
const DURATION_DAYS = 30;

function getEndOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

async function main() {
  console.log(`\n🏥 Activating Medical 999K Plan`);
  console.log(`   Email:  ${TARGET_EMAIL}`);
  console.log(`   UserID: ${TARGET_USER_ID}`);
  console.log(`   Amount: ${AMOUNT_VND.toLocaleString()} VND`);
  console.log(`   Duration: ${DURATION_DAYS} days\n`);

  // ── Step 1: Update Clerk metadata ──────────────────
  console.log('📋 Step 1: Updating Clerk publicMetadata...');
  const updateRes = await fetch(`https://api.clerk.com/v1/users/${TARGET_USER_ID}/metadata`, {
    body: JSON.stringify({
      public_metadata: {
        activatedAt: new Date().toISOString(),
        activatedBy: 'admin-script',
        medicalBeta: true,
        planId: PLAN_ID,
        promoCode: 'MEDICAL-999K-ACTIVATION',
      },
    }),
    headers: {
      'Authorization': `Bearer ${CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });

  const clerkResult = await updateRes.json();

  if (!updateRes.ok) {
    console.error('❌ Failed to update Clerk metadata:', clerkResult);
    process.exit(1);
  }

  const userName =
    [clerkResult.first_name, clerkResult.last_name].filter(Boolean).join(' ') || 'User';
  console.log('✅ Clerk metadata updated!');
  console.log(`   User: ${userName}`);
  console.log(`   Plan: ${clerkResult.public_metadata?.planId}`);

  // ── Step 2: Sync Neon database ─────────────────────
  console.log('\n💾 Step 2: Syncing database (users + subscriptions + payment)...');
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const db = drizzle(pool);
    const { users: usersTable } = await import('../packages/database/src/schemas/user');
    const { subscriptions: subsTable, sepayPayments } =
      await import('../packages/database/src/schemas/billing');

    const pointsResetDate = getEndOfMonth();

    // 2a. Update users table
    const dbResult = await db
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
      .where(eq(usersTable.id, TARGET_USER_ID))
      .returning({
        currentPlanId: usersTable.currentPlanId,
        email: usersTable.email,
        phoPointsBalance: usersTable.phoPointsBalance,
        pointsResetDate: usersTable.pointsResetDate,
      });

    if (dbResult.length > 0) {
      const updated = dbResult[0];
      console.log('✅ Users table synced!');
      console.log(`   currentPlanId: ${updated.currentPlanId}`);
      console.log(`   phoPointsBalance: ${updated.phoPointsBalance?.toLocaleString()}`);
      console.log(`   pointsResetDate: ${updated.pointsResetDate?.toISOString()}`);
    } else {
      console.error('❌ User not found in database! ID:', TARGET_USER_ID);
      process.exit(1);
    }

    // 2b. Create/Update subscription record (30 days)
    console.log('\n📦 Step 3: Creating subscription record...');
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + DURATION_DAYS);

    const existingSub = await db
      .select()
      .from(subsTable)
      .where(eq(subsTable.userId, TARGET_USER_ID))
      .limit(1);

    if (existingSub.length > 0) {
      await db
        .update(subsTable)
        .set({
          billingCycle: 'monthly',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: end,
          currentPeriodStart: start,
          paymentProvider: 'sepay',
          planId: PLAN_ID,
          status: 'active',
        })
        .where(eq(subsTable.userId, TARGET_USER_ID));
      console.log('✅ Existing subscription updated!');
    } else {
      await db.insert(subsTable).values({
        billingCycle: 'monthly',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: end,
        currentPeriodStart: start,
        paymentProvider: 'sepay',
        planId: PLAN_ID,
        status: 'active',
        userId: TARGET_USER_ID,
      });
      console.log('✅ New subscription created!');
    }
    console.log(`   Plan: ${PLAN_ID}`);
    console.log(`   Period: ${start.toISOString()} → ${end.toISOString()}`);
    console.log(`   Billing: monthly (30 days)`);

    // 2c. Create payment record
    console.log('\n💳 Step 4: Creating payment record...');
    const orderId = `admin_medical_${Date.now()}`;
    await db.insert(sepayPayments).values({
      amountVnd: AMOUNT_VND,
      billingCycle: 'monthly',
      currency: 'VND',
      metadata: { activatedBy: 'admin-script', note: 'Medical 999K manual activation' },
      orderId,
      paymentMethod: 'sepay',
      planId: PLAN_ID,
      status: 'success',
      userId: TARGET_USER_ID,
    });
    console.log(`✅ Payment record created! Order: ${orderId}`);
    console.log(`   Amount: ${AMOUNT_VND.toLocaleString()} VND`);

    // ── Step 5: Verify by querying back ──────────────
    console.log('\n🔍 Step 5: Verifying database writes...');

    const verifyUser = await db
      .select({
        currentPlanId: usersTable.currentPlanId,
        email: usersTable.email,
        phoPointsBalance: usersTable.phoPointsBalance,
        subscriptionStatus: usersTable.subscriptionStatus,
      })
      .from(usersTable)
      .where(eq(usersTable.id, TARGET_USER_ID))
      .limit(1);

    const verifySub = await db
      .select()
      .from(subsTable)
      .where(eq(subsTable.userId, TARGET_USER_ID))
      .limit(1);

    if (verifyUser.length > 0 && verifySub.length > 0) {
      const u = verifyUser[0];
      const s = verifySub[0];
      console.log('✅ Verification passed!');
      console.log(`   User plan: ${u.currentPlanId} (status: ${u.subscriptionStatus})`);
      console.log(`   Points: ${u.phoPointsBalance?.toLocaleString()}`);
      console.log(`   Sub plan: ${s.planId} (status: ${s.status})`);
      console.log(
        `   Sub period: ${s.currentPeriodStart.toISOString()} → ${s.currentPeriodEnd.toISOString()}`,
      );
    } else {
      console.error('❌ Verification failed — records not found after insert');
    }
  } catch (dbErr) {
    console.error('❌ Database operation failed:', dbErr);
    process.exit(1);
  } finally {
    await pool.end();
  }

  // ── Step 6: Send welcome email via Resend ──────────
  console.log('\n📧 Step 6: Sending welcome email...');
  if (!RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY not found — skipping email');
  } else {
    try {
      const { generateWelcomeEmailHtml, getWelcomeEmailSubject } =
        await import('../src/libs/email/templates/welcome');

      const subject = getWelcomeEmailSubject(PLAN_ID);
      const html = generateWelcomeEmailHtml(userName, PLAN_ID);

      const emailRes = await fetch('https://api.resend.com/emails', {
        body: JSON.stringify({
          from: 'Tom from Phở Chat <hi@pho.chat>',
          html,
          subject,
          to: [TARGET_EMAIL],
        }),
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

      const emailData = await emailRes.json();

      if (emailRes.ok) {
        console.log(`✅ Welcome email sent! ID: ${emailData.id}`);
      } else {
        console.error('⚠️ Email send failed:', JSON.stringify(emailData, null, 2));
      }
    } catch (emailErr) {
      console.error('⚠️ Email error (non-blocking):', emailErr);
    }
  }

  // ── Summary ────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('🏥 MEDICAL 999K ACTIVATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`   User ID:    ${TARGET_USER_ID}`);
  console.log(`   Email:      ${TARGET_EMAIL}`);
  console.log(`   User Name:  ${userName}`);
  console.log(`   Plan:       Phở Medical Beta 🏥 (${PLAN_ID})`);
  console.log(`   Amount:     ${AMOUNT_VND.toLocaleString()} VND`);
  console.log(`   Duration:   ${DURATION_DAYS} days`);
  console.log(`   Points:     ${MONTHLY_POINTS.toLocaleString()}/month`);
  console.log(`   Tier 2:     Unlimited`);
  console.log(`   Tier 3:     10/day`);
  console.log(`   Status:     ACTIVE`);
  console.log('='.repeat(60));
  console.log('\n🔄 User should refresh pho.chat (Ctrl+Shift+R) to see changes!');
}

main().catch(console.error);
