/**
 * Restore a single medical_beta user's monthly Phở Points entitlement.
 *
 * Why: medical_beta promises 1,000,000 points/month but no automated monthly
 * grant runs for it (the only reset cron is hardcoded to gl_lifetime). The
 * targeted user exhausted their one-time activation grant and has been blocked.
 *
 * SAFETY:
 *  - DRY-RUN by default. Prints current state + intended change, writes nothing.
 *  - Pass --apply to perform the UPDATE.
 *  - WHERE clause is pinned to the exact user id AND current_plan_id='medical_beta'.
 *
 * Usage:
 *   node scripts/restore-medical-beta-user.mjs            # dry run
 *   node scripts/restore-medical-beta-user.mjs --apply    # write
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const TARGET_USER = 'user_3AAHAPVP3FXij0MX2Qr6cpx2mfp'; // danhkhiem1999@gmail.com
const PLAN = 'medical_beta';
const GRANT = 1_000_000;
const APPLY = process.argv.includes('--apply');

function dbUrl() {
  for (const f of ['.env.local', '.env.production.local', '.env']) {
    let raw;
    try {
      raw = readFileSync(path.resolve(process.cwd(), f), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^DATABASE_URL\s*=\s*(.*)$/);
      if (m) return m[1].trim().replaceAll(/^["']|["']$/g, '');
    }
  }
  throw new Error('DATABASE_URL not found');
}

async function main() {
  const client = new pg.Client({
    connectionString: dbUrl(),
    connectionTimeoutMillis: 15_000,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const before = await client.query(
      `SELECT id, email, current_plan_id, subscription_status, pho_points_balance, points_reset_date
         FROM users WHERE id = $1`,
      [TARGET_USER],
    );
    if (before.rows.length === 0) {
      console.log('User not found.');
      return;
    }
    const u = before.rows[0];
    console.log('BEFORE:', JSON.stringify(u, null, 2));

    if (u.current_plan_id !== PLAN) {
      console.log(
        `ABORT: current_plan_id is "${u.current_plan_id}", expected "${PLAN}". No change.`,
      );
      return;
    }

    console.log(`\nINTENDED CHANGE:`);
    console.log(`  pho_points_balance: ${u.pho_points_balance} -> ${GRANT}`);
    console.log(`  points_reset_date:  ${u.points_reset_date} -> now()`);

    if (!APPLY) {
      console.log('\n[DRY-RUN] No write performed. Re-run with --apply to commit.');
      return;
    }

    const res = await client.query(
      `UPDATE users
          SET pho_points_balance = $1,
              points_reset_date = now(),
              updated_at = now()
        WHERE id = $2 AND current_plan_id = $3
        RETURNING pho_points_balance, points_reset_date`,
      [GRANT, TARGET_USER, PLAN],
    );
    console.log(`\n[APPLIED] rows=${res.rowCount}`, JSON.stringify(res.rows[0], null, 2));
  } finally {
    await client.end();
  }
}
try {
  await main();
} catch (e) {
  console.error('FATAL:', e.message);
  process.exitCode = 1;
}
