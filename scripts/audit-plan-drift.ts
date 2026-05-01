/* eslint-disable unicorn/no-process-exit, unicorn/prefer-top-level-await */
/**
 * Script: Audit DB ↔ Clerk plan drift
 * Run: npx tsx scripts/audit-plan-drift.ts
 *
 * Lists every user whose `users.current_plan_id` (DB source of truth) does
 * NOT match `clerkUser.publicMetadata.planId` (display cache).
 *
 * Run BEFORE merging PHO-241/A1.6. After that PR ships:
 *   - Users with paid Clerk + free DB will lose paid access.
 *   - Users with free Clerk + paid DB are unchanged (DB was already correct).
 *
 * For each drifted user with paid Clerk + free DB, decide:
 *   1. Legitimate paid (manually granted) → UPDATE DB, then re-run audit
 *   2. Legacy/test → leave (will downgrade automatically post-merge)
 *   3. Unsure → email user before merge
 *
 * Output: drift-audit.txt (also printed to stdout)
 */
import { createClerkClient } from '@clerk/backend';
import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

import { users } from '../packages/database/src/schemas/user';

dotenv.config({ path: resolve(process.cwd(), '.env.vercel.production') });
const savedClerkKey = process.env.CLERK_SECRET_KEY;
dotenv.config({ override: true, path: resolve(process.cwd(), '.env.local') });
process.env.CLERK_SECRET_KEY = savedClerkKey!;

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!CLERK_SECRET_KEY) {
  console.error('❌ CLERK_SECRET_KEY not found in .env.vercel.production or .env.local');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found');
  process.exit(1);
}

const FREE_PLAN_IDS = new Set(['free', 'trial', 'starter', 'vn_free', 'gl_starter']);

interface DriftRow {
  clerkPlan: string;
  dbPlan: string;
  email: string;
  severity: 'paid_clerk_free_db' | 'paid_clerk_paid_db_diff' | 'free_clerk_paid_db';
  userId: string;
}

function classify(dbPlan: string, clerkPlan: string): DriftRow['severity'] {
  const dbIsFree = FREE_PLAN_IDS.has(dbPlan.toLowerCase());
  const clerkIsFree = FREE_PLAN_IDS.has(clerkPlan.toLowerCase());
  if (!clerkIsFree && dbIsFree) return 'paid_clerk_free_db';
  if (!clerkIsFree && !dbIsFree) return 'paid_clerk_paid_db_diff';
  return 'free_clerk_paid_db';
}

async function main() {
  console.log('\n🔍 Phở Chat — DB ↔ Clerk plan drift audit\n');

  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool);
  const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY });

  const dbUsers = await db
    .select({ dbPlan: users.currentPlanId, email: users.email, id: users.id })
    .from(users);

  console.log(`Loaded ${dbUsers.length} users from DB. Comparing against Clerk metadata...\n`);

  const drifted: DriftRow[] = [];
  const errors: Array<{ reason: string; userId: string }> = [];

  let processed = 0;
  for (const u of dbUsers) {
    processed++;
    if (processed % 100 === 0) {
      console.log(`  …processed ${processed}/${dbUsers.length}`);
    }

    try {
      const clerkUser = await clerk.users.getUser(u.id);
      const clerkPlanRaw = (clerkUser.publicMetadata as Record<string, unknown>)?.planId;
      if (typeof clerkPlanRaw !== 'string' || !clerkPlanRaw) continue;

      const dbPlan = u.dbPlan ?? 'vn_free';
      if (clerkPlanRaw === dbPlan) continue;

      drifted.push({
        clerkPlan: clerkPlanRaw,
        dbPlan,
        email: u.email ?? '(no email)',
        severity: classify(dbPlan, clerkPlanRaw),
        userId: u.id,
      });
    } catch (e) {
      errors.push({ reason: (e as Error).message, userId: u.id });
    }
  }

  await pool.end();

  // ── Summary ──────────────────────────────────────────────────────────
  const byBucket = {
    free_clerk_paid_db: drifted.filter((d) => d.severity === 'free_clerk_paid_db'),
    paid_clerk_free_db: drifted.filter((d) => d.severity === 'paid_clerk_free_db'),
    paid_clerk_paid_db_diff: drifted.filter((d) => d.severity === 'paid_clerk_paid_db_diff'),
  };

  const formatRow = (d: DriftRow) =>
    `  ${d.email}  userId=${d.userId}  dbPlan=${d.dbPlan}  clerkPlan=${d.clerkPlan}`;

  const lines: string[] = [
    `Phở Chat — Plan drift audit (${new Date().toISOString()})`,
    `Total users: ${dbUsers.length}`,
    `Drifted: ${drifted.length}`,
    `Lookup errors: ${errors.length}`,
    '',
    '=== HIGH RISK: paid Clerk + free DB (will lose access on merge) ===',
    ...byBucket.paid_clerk_free_db.map(formatRow),
    '',
    '=== MEDIUM: paid Clerk + paid DB (different plans — review) ===',
    ...byBucket.paid_clerk_paid_db_diff.map(formatRow),
    '',
    '=== LOW: free Clerk + paid DB (DB already wins, no action) ===',
    ...byBucket.free_clerk_paid_db.map(formatRow),
    '',
    '=== Lookup errors ===',
    ...errors.map((e) => `  userId=${e.userId}  reason=${e.reason}`),
  ];

  const output = lines.join('\n');
  console.log('\n' + output + '\n');

  const outputPath = resolve(process.cwd(), 'drift-audit.txt');
  writeFileSync(outputPath, output, 'utf8');
  console.log(`\n📄 Wrote ${outputPath}`);
  console.log(`\nNext steps:`);
  console.log(
    `  1. Review HIGH-RISK rows. Decide per user: grant DB plan, leave (downgrade), or contact.`,
  );
  console.log(`  2. Re-run this script after manual fixes until HIGH-RISK is empty (or accepted).`);
  console.log(`  3. Then merge PHO-241/A1.6.\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
