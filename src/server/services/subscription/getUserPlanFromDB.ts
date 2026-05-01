/**
 * Canonical user-plan lookup — DB is the long-term source of truth.
 *
 * Background (PHO-241 / A1.6):
 *   8 server-side sites trusted Clerk `publicMetadata.planId` as a fallback
 *   when the DB returned a free-tier plan. That made Clerk a writable
 *   source-of-truth for paid-plan authorization — anyone with Clerk
 *   Dashboard access (admins, support, leaked CLERK_SECRET_KEY) could mint
 *   paid plans without leaving a DB row. A real user (vuthanhhuong, PHO-233)
 *   silently received Tier 3 for months because Clerk metadata diverged
 *   from the DB.
 *
 * Enforcement mode (env: `PLAN_ENFORCEMENT_MODE`):
 *   - `soft` (default) — read DB first; if DB returns a free plan AND Clerk
 *     metadata says paid, log a `[plan-drift] SOFT MODE` warning and HONOR
 *     the Clerk plan. This is a graceful migration mode: it eliminates the
 *     break-risk of revoking paid access from users whose DB row never got
 *     synced, while still surfacing every drift case in logs so we can
 *     reconcile and flip to hard later.
 *   - `hard` — DB only. Clerk metadata is ignored entirely. Use after the
 *     drift backlog has been reconciled.
 *
 *   Set `PLAN_ENFORCEMENT_MODE=hard` in Vercel project env to enable hard
 *   enforcement. Any other value (including unset) falls back to soft mode
 *   for safety.
 *
 * Read order (DB):
 *   1. Active row in `subscriptions` (status='active'), sorted lifetime > paid > free,
 *      with most recent `currentPeriodStart` as tiebreaker — same prioritization the
 *      existing /api/subscription/current endpoint uses.
 *   2. `users.current_plan_id` (legacy / admin-set baseline).
 *   3. `'vn_free'` default.
 */
import { clerkClient } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';

import { users } from '@/database/schemas';
import { subscriptions } from '@/database/schemas/billing';
import { getServerDB } from '@/database/server';

/** Plan IDs that are treated as free-tier when prioritizing subscriptions. */
export const FREE_PLAN_IDS = new Set(['free', 'trial', 'starter', 'vn_free', 'gl_starter']);

/** Substrings in `planId` that mark a lifetime/founding plan (highest priority). */
export const LIFETIME_KEYWORDS = ['lifetime', 'founding'];

export type UserPlanSource =
  | 'clerk_fallback_soft'
  | 'db_subscription'
  | 'db_user_default'
  | 'fallback_free';

export interface UserPlanResult {
  /**
   * True iff DB and Clerk disagree (DB returned free, Clerk had a paid plan).
   * Only set when the resolved plan came from `clerk_fallback_soft`.
   */
  driftDetected?: boolean;
  /** True iff resolved from an active row in the `subscriptions` table. */
  hasActiveSubscription: boolean;
  /** Resolved plan ID — `vn_free` when no record exists. */
  planId: string;
  /** Where the plan was resolved from. Useful for telemetry / drift detection. */
  source: UserPlanSource;
}

/**
 * Resolve a user's plan, preferring the DB but optionally honoring Clerk
 * metadata as a soft fallback (see file-level docstring).
 *
 * Use this for any authorization decision (tier access, model gating,
 * point allocation, etc). For display-only client reads (e.g. show a "PRO"
 * badge), it is fine to read Clerk metadata directly — the value is purely
 * cosmetic and is reconciled by webhooks.
 */
export async function getUserPlanFromDB(userId: string): Promise<UserPlanResult> {
  const db = await getServerDB();

  // ── 1. Resolve the DB result first ─────────────────────────────────
  let dbResult: UserPlanResult;

  const activeSubs = await db
    .select({
      currentPeriodStart: subscriptions.currentPeriodStart,
      planId: subscriptions.planId,
    })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')));

  if (activeSubs.length > 0) {
    const sorted = [...activeSubs].sort((a, b) => {
      const aPlan = a.planId.toLowerCase();
      const bPlan = b.planId.toLowerCase();
      const aIsLifetime = LIFETIME_KEYWORDS.some((kw) => aPlan.includes(kw));
      const bIsLifetime = LIFETIME_KEYWORDS.some((kw) => bPlan.includes(kw));
      const aIsFree = FREE_PLAN_IDS.has(aPlan);
      const bIsFree = FREE_PLAN_IDS.has(bPlan);

      if (aIsLifetime && !bIsLifetime) return -1;
      if (!aIsLifetime && bIsLifetime) return 1;
      if (aIsFree && !bIsFree) return 1;
      if (!aIsFree && bIsFree) return -1;

      const aStart = a.currentPeriodStart ? new Date(a.currentPeriodStart).getTime() : 0;
      const bStart = b.currentPeriodStart ? new Date(b.currentPeriodStart).getTime() : 0;
      return bStart - aStart;
    });

    dbResult = {
      hasActiveSubscription: true,
      planId: sorted[0].planId,
      source: 'db_subscription',
    };
  } else {
    const [user] = await db
      .select({ planId: users.currentPlanId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    dbResult = user?.planId
      ? {
          hasActiveSubscription: false,
          planId: user.planId,
          source: 'db_user_default',
        }
      : {
          hasActiveSubscription: false,
          planId: 'vn_free',
          source: 'fallback_free',
        };
  }

  // ── 2. Soft enforcement: honor Clerk paid plan if DB has free plan ─
  // Only when (a) mode is soft AND (b) DB result is a free-tier plan.
  // If DB already shows a paid plan, we trust it without any Clerk read.
  const enforcementMode = (process.env.PLAN_ENFORCEMENT_MODE ?? 'soft').toLowerCase();
  const dbIsFree = FREE_PLAN_IDS.has(dbResult.planId.toLowerCase());

  if (enforcementMode !== 'hard' && dbIsFree) {
    try {
      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);
      const rawClerkPlan = (clerkUser.publicMetadata as Record<string, unknown> | undefined)
        ?.planId;

      if (
        typeof rawClerkPlan === 'string' &&
        rawClerkPlan &&
        !FREE_PLAN_IDS.has(rawClerkPlan.toLowerCase())
      ) {
        const email = clerkUser.emailAddresses?.[0]?.emailAddress ?? '(no email)';
        console.warn(
          `[plan-drift] SOFT MODE: User ${userId} (${email}) — DB=${dbResult.planId}, ` +
            `Clerk=${rawClerkPlan}. Honoring Clerk plan. Migrate DB to fix.`,
        );
        return {
          driftDetected: true,
          hasActiveSubscription: false,
          planId: rawClerkPlan,
          source: 'clerk_fallback_soft',
        };
      }
    } catch (err) {
      // Clerk lookup failed (network, auth, etc) — fall through to DB result.
      // We do NOT crash the request: the DB result is always a safe baseline.
      console.warn(`[plan-drift] Clerk lookup failed for ${userId}:`, err);
    }
  }

  return dbResult;
}

/** Convenience wrapper for callers that only need the planId string. */
export async function getUserPlanIdFromDB(userId: string): Promise<string> {
  const result = await getUserPlanFromDB(userId);
  return result.planId;
}
