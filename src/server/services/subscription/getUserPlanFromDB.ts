/**
 * Canonical user-plan lookup — DB is the single source of truth.
 *
 * Background (PHO-241 / A1.6):
 *   Prior to this helper, 8 server-side sites trusted Clerk
 *   `publicMetadata.planId` as a fallback when the DB returned a free-tier
 *   plan. That meant anyone with Clerk Dashboard access (admins, support, or
 *   a leaked CLERK_SECRET_KEY) could mint paid plans without leaving a DB
 *   row — and a real user (vuthanhhuong, PHO-233) silently received Tier 3
 *   for months because Clerk metadata diverged from the DB.
 *
 * Rule:
 *   - DB is authoritative for paid-plan checks.
 *   - Clerk publicMetadata.planId is display cache only; never trust it for
 *     authorization decisions.
 *
 * Read order:
 *   1. Active row in `subscriptions` (status='active'), sorted lifetime > paid > free,
 *      with most recent `currentPeriodStart` as tiebreaker — same prioritization the
 *      existing /api/subscription/current endpoint uses.
 *   2. `users.current_plan_id` (legacy / admin-set baseline).
 *   3. `'vn_free'` default.
 */
import { and, eq } from 'drizzle-orm';

import { users } from '@/database/schemas';
import { subscriptions } from '@/database/schemas/billing';
import { getServerDB } from '@/database/server';

/** Plan IDs that are treated as free-tier when prioritizing subscriptions. */
export const FREE_PLAN_IDS = new Set(['free', 'trial', 'starter', 'vn_free', 'gl_starter']);

/** Substrings in `planId` that mark a lifetime/founding plan (highest priority). */
export const LIFETIME_KEYWORDS = ['lifetime', 'founding'];

export type UserPlanSource = 'db_subscription' | 'db_user_default' | 'fallback_free';

export interface UserPlanResult {
  /** True iff resolved from an active row in the `subscriptions` table. */
  hasActiveSubscription: boolean;
  /** Resolved plan ID — `vn_free` when no record exists. */
  planId: string;
  /** Where the plan was resolved from. Useful for telemetry / drift detection. */
  source: UserPlanSource;
}

/**
 * Resolve a user's plan strictly from the database. Never consults Clerk.
 *
 * Use this for any authorization decision (tier access, model gating,
 * point allocation, etc). For display-only client reads (e.g. show a "PRO"
 * badge), it is fine to read Clerk metadata directly — the value is purely
 * cosmetic and is reconciled by webhooks.
 */
export async function getUserPlanFromDB(userId: string): Promise<UserPlanResult> {
  const db = await getServerDB();

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

    return {
      hasActiveSubscription: true,
      planId: sorted[0].planId,
      source: 'db_subscription',
    };
  }

  const [user] = await db
    .select({ planId: users.currentPlanId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.planId) {
    return {
      hasActiveSubscription: false,
      planId: user.planId,
      source: 'db_user_default',
    };
  }

  return {
    hasActiveSubscription: false,
    planId: 'vn_free',
    source: 'fallback_free',
  };
}

/** Convenience wrapper for callers that only need the planId string. */
export async function getUserPlanIdFromDB(userId: string): Promise<string> {
  const result = await getUserPlanFromDB(userId);
  return result.planId;
}
