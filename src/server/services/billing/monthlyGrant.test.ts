import { describe, expect, it } from 'vitest';

import {
  getMonthlyGrantPlanCodes,
  getMonthlyPointsForPlan,
  isMonthlyGrantPlan,
} from '@/config/pricing';

import { resolveMonthlyGrant } from './monthlyGrant';

describe('pricing monthly-grant helpers', () => {
  it('returns the configured monthlyPoints for a known plan, 0 otherwise', () => {
    expect(getMonthlyPointsForPlan('medical_beta')).toBe(1_000_000);
    expect(getMonthlyPointsForPlan('vn_pro')).toBe(2_000_000);
    expect(getMonthlyPointsForPlan('gl_lifetime')).toBe(2_000_000);
    expect(getMonthlyPointsForPlan('does_not_exist')).toBe(0);
  });

  it('treats paid plans as grantable and free tiers as not', () => {
    expect(isMonthlyGrantPlan('medical_beta')).toBe(true);
    expect(isMonthlyGrantPlan('vn_basic')).toBe(true);
    expect(isMonthlyGrantPlan('lifetime_early_bird')).toBe(true);
    // Free tiers (price === 0) are excluded
    expect(isMonthlyGrantPlan('vn_free')).toBe(false);
    expect(isMonthlyGrantPlan('gl_starter')).toBe(false);
    expect(isMonthlyGrantPlan('unknown')).toBe(false);
  });

  it('lists grant plan codes without free tiers', () => {
    const codes = getMonthlyGrantPlanCodes();
    expect(codes).toContain('medical_beta');
    expect(codes).toContain('gl_lifetime');
    expect(codes).toContain('vn_pro');
    expect(codes).not.toContain('vn_free');
    expect(codes).not.toContain('gl_starter');
  });
});

describe('resolveMonthlyGrant', () => {
  it('grants paid subscription plans only when ACTIVE', () => {
    expect(resolveMonthlyGrant('medical_beta', 'ACTIVE')).toBe(1_000_000);
    expect(resolveMonthlyGrant('vn_pro', 'ACTIVE')).toBe(2_000_000);
    // Not active → no grant (cancelled / past_due / free flag / null)
    expect(resolveMonthlyGrant('medical_beta', 'CANCELLED')).toBeNull();
    expect(resolveMonthlyGrant('vn_pro', 'PAST_DUE')).toBeNull();
    expect(resolveMonthlyGrant('medical_beta', 'FREE')).toBeNull();
    expect(resolveMonthlyGrant('medical_beta', null)).toBeNull();
  });

  it('always grants lifetime plans regardless of status', () => {
    expect(resolveMonthlyGrant('gl_lifetime', 'ACTIVE')).toBe(2_000_000);
    expect(resolveMonthlyGrant('gl_lifetime', 'CANCELLED')).toBe(2_000_000);
    expect(resolveMonthlyGrant('gl_lifetime', null)).toBe(2_000_000);
    expect(resolveMonthlyGrant('lifetime_early_bird', 'FREE')).toBe(2_000_000);
  });

  it('never grants free tiers or unknown plans', () => {
    expect(resolveMonthlyGrant('vn_free', 'ACTIVE')).toBeNull();
    expect(resolveMonthlyGrant('gl_starter', 'ACTIVE')).toBeNull();
    expect(resolveMonthlyGrant('unknown_plan', 'ACTIVE')).toBeNull();
    expect(resolveMonthlyGrant(null, 'ACTIVE')).toBeNull();
    expect(resolveMonthlyGrant(undefined, 'ACTIVE')).toBeNull();
  });
});
