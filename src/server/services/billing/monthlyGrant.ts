import { getMonthlyPointsForPlan, isMonthlyGrantPlan } from '@/config/pricing';

/** Lifetime plans never expire, so they always qualify for the monthly grant. */
export const isLifetimePlan = (planId: string): boolean => planId.includes('lifetime');

/**
 * Resolve the monthly Phở Points grant for a user, or `null` if not eligible.
 *
 * Eligibility:
 * - Plan must be a monthly-grant plan (paid, positive allowance) — see
 *   `isMonthlyGrantPlan`. Free tiers are excluded.
 * - Subscription plans require `subscriptionStatus === 'ACTIVE'`.
 * - Lifetime plans qualify regardless of status (permanent access).
 *
 * Pure function — no DB, no clock — so the cron's selection rule is unit-testable.
 */
export function resolveMonthlyGrant(
  planId: string | null | undefined,
  subscriptionStatus: string | null | undefined,
): number | null {
  const plan = planId ?? '';
  if (!isMonthlyGrantPlan(plan)) return null;
  if (!isLifetimePlan(plan) && subscriptionStatus !== 'ACTIVE') return null;

  const amount = getMonthlyPointsForPlan(plan);
  return amount > 0 ? amount : null;
}
