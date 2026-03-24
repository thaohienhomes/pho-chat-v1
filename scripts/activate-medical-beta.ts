/* eslint-disable unicorn/no-process-exit, unicorn/prefer-top-level-await */
/**
 * Script: Activate Medical Beta plan for a specific user
 * Run: npx tsx scripts/activate-medical-beta.ts
 *
 * This script:
 * 1. Sets Clerk publicMetadata (planId = 'medical_beta')
 * 2. Syncs Neon DB users table (currentPlanId, phoPointsBalance, pointsResetDate, daily limits)
 * 3. Creates/updates subscription record in subscriptions table
 */
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { resolve } from 'node:path';
import { Pool } from 'pg';

dotenv.config({ path: resolve(process.cwd(), '.env.vercel.production') });
// Override DATABASE_URL from .env.local (production DB hostname may not resolve from local network)
const savedClerkKey = process.env.CLERK_SECRET_KEY;
dotenv.config({ override: true, path: resolve(process.cwd(), '.env.local') });
process.env.CLERK_SECRET_KEY = savedClerkKey!;

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!CLERK_SECRET_KEY) {
  console.error('❌ CLERK_SECRET_KEY not found');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found');
  process.exit(1);
}

// ── Target User ──────────────────────────────────────
const TARGET_USER_ID = 'user_3Avb9FioY7pAcS6TdkoiKFg4n23';
const TARGET_EMAIL = 'Phamminhhuyen1512@gmail.com';

// ── Plan: medical_beta (Phở Medical Beta 🏥) ────────
const PLAN_ID = 'medical_beta';
const MONTHLY_POINTS = 1_000_000;

function getEndOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

async function main() {
  console.log(`\n🏥 Activating Medical Beta for: ${TARGET_EMAIL}`);
  console.log(`   UserID: ${TARGET_USER_ID}\n`);

  // ── Step 1: Update Clerk metadata ──────────────────
  console.log('📋 Step 1: Updating Clerk publicMetadata...');
  const updateRes = await fetch(`https://api.clerk.com/v1/users/${TARGET_USER_ID}/metadata`, {
    body: JSON.stringify({
      public_metadata: {
        activatedAt: new Date().toISOString(),
        activatedBy: 'admin-script',
        medicalBeta: true,
        planId: PLAN_ID,
        promoCode: 'MEDICAL-BETA-ACTIVATION',
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

  // ── Step 2: Sync Neon database (users table) ───────
  console.log('\n💾 Step 2: Syncing database (users table)...');
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const db = drizzle(pool);
    const { users: usersTable } = await import('../packages/database/src/schemas/user');
    const { subscriptions: subsTable } = await import('../packages/database/src/schemas/billing');

    const pointsResetDate = getEndOfMonth();

    // Update users table
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
      console.warn('⚠️ User not found in database — may need to log in first.');
    }

    // ── Step 3: Create/Update subscription record ────
    console.log('\n📦 Step 3: Creating subscription record...');
    const start = new Date();
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1); // 1 year subscription

    // Check for existing subscription
    const existingSub = await db
      .select()
      .from(subsTable)
      .where(eq(subsTable.userId, TARGET_USER_ID))
      .limit(1);

    if (existingSub.length > 0) {
      // Update existing subscription
      await db
        .update(subsTable)
        .set({
          billingCycle: 'yearly',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: end,
          currentPeriodStart: start,
          paymentProvider: 'free',
          planId: PLAN_ID,
          status: 'active',
        })
        .where(eq(subsTable.userId, TARGET_USER_ID));
      console.log('✅ Existing subscription updated!');
    } else {
      // Create new subscription
      await db.insert(subsTable).values({
        billingCycle: 'yearly',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: end,
        currentPeriodStart: start,
        paymentProvider: 'free',
        planId: PLAN_ID,
        status: 'active',
        userId: TARGET_USER_ID,
      });
      console.log('✅ New subscription created!');
    }

    console.log(`   Plan: ${PLAN_ID}`);
    console.log(`   Period: ${start.toISOString()} → ${end.toISOString()}`);
    console.log(`   Status: active`);
  } catch (dbErr) {
    console.error('⚠️ Database sync failed:', dbErr);
  } finally {
    await pool.end();
  }

  // ── Summary ────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('🏥 MEDICAL BETA ACTIVATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`   User ID:    ${TARGET_USER_ID}`);
  console.log(`   Email:      ${TARGET_EMAIL}`);
  console.log(`   User Name:  ${userName}`);
  console.log(`   Plan:       Phở Medical Beta 🏥 (${PLAN_ID})`);
  console.log(`   Points:     ${MONTHLY_POINTS.toLocaleString()}/month`);
  console.log(`   Tier 2:     Unlimited`);
  console.log(`   Tier 3:     10/day`);
  console.log(`   Status:     ACTIVE`);
  console.log('='.repeat(60));
  console.log('\n🔄 User should refresh pho.chat (Ctrl+Shift+R) to see changes!');
}

main().catch(console.error);
