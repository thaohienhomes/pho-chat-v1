/* eslint-disable sort-keys-fix/sort-keys-fix */
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './user';

/**
 * Usage logs table for tracking AI model usage and costs
 */
export const usageLogs = pgTable('usage_logs', {
  // Will be calculated as inputTokens + outputTokens
  // Cost tracking
  costUSD: real('cost_usd').notNull(),

  id: text('id')
    .$defaultFn(() => `usage_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`)
    .primaryKey(),

  costVND: real('cost_vnd').notNull(),

  // Token usage
  inputTokens: integer('input_tokens').notNull(),

  // Model information
  model: varchar('model', { length: 100 }).notNull(),

  modelTier: integer('model_tier').default(1),

  outputTokens: integer('output_tokens').notNull(),

  // Phở Points deducted (from PRICING_MASTERPLAN)
  pointsDeducted: integer('points_deducted').default(0),

  // Additional metadata
  metadata: jsonb('metadata').$type<{
    // ['streaming', 'function_calling', 'vision']
    errorCode?: string;
    features?: string[];
    ipAddress?: string;
    // True when the stream aborted before completion (user disconnect, network error).
    // Tokens reflect what was already consumed from the gateway, not the full response.
    partial?: boolean;
    userAgent?: string;
  }>(),

  sessionId: text('session_id'),

  provider: varchar('provider', { length: 50 }).notNull(),

  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),

  // 'simple', 'medium', 'complex'
  queryCategory: varchar('query_category', { length: 50 }),

  // 1: Cheap, 2: Standard, 3: Expensive
  // Query metadata
  queryComplexity: varchar('query_complexity', { length: 20 }),

  // 'chat', 'code', 'translation', etc.
  // Performance metrics
  responseTimeMs: integer('response_time_ms'),

  totalTokens: integer('total_tokens').$defaultFn(() => 0),

  ...timestamps,
});

/**
 * Monthly usage summary for efficient budget tracking
 */
export const monthlyUsageSummary = pgTable(
  'monthly_usage_summary',
  {
    complexQueries: integer('complex_queries').default(0),

    // Breakdown by model tier
    cheapModelUsage: real('cheap_model_usage').default(0),

    month: varchar('month', { length: 7 }).notNull(),

    mediumQueries: integer('medium_queries').default(0),

    // Breakdown by complexity
    simpleQueries: integer('simple_queries').default(0),

    // 'starter', 'premium', 'ultimate'
    budgetLimitVND: real('budget_limit_vnd'),

    totalCostUSD: real('total_cost_usd').default(0),

    budgetRemainingVND: real('budget_remaining_vnd'),

    // Format: YYYY-MM
    // Aggregated usage
    totalQueries: integer('total_queries').default(0),

    budgetUsedVND: real('budget_used_vnd').default(0),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // Warnings and alerts
    budgetWarningsSent: integer('budget_warnings_sent').default(0),

    lastWarningAt: timestamp('last_warning_at'),

    totalTokens: integer('total_tokens').default(0),

    // VND
    midTierModelUsage: real('mid_tier_model_usage').default(0),

    totalCostVND: real('total_cost_vnd').default(0),

    // VND
    premiumModelUsage: real('premium_model_usage').default(0),
    // VND
    // Budget tracking
    subscriptionTier: varchar('subscription_tier', { length: 20 }),

    ...timestamps,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.month] }),
  }),
);

/**
 * Cost optimization settings per user
 */
export const userCostSettings = pgTable('user_cost_settings', {
  blockedModels: jsonb('blocked_models').$type<string[]>(),

  dailyBudgetPoints: integer('daily_budget_points'),

  // vn_free is 0 VND
  dailyBudgetVND: real('daily_budget_vnd'),

  budgetAlertThresholds: jsonb('budget_alert_thresholds')
    .$type<{
      // percentage (e.g., 75)
      critical: number;
      // percentage (e.g., 90)
      emergency: number;
      warning: number; // percentage (e.g., 95)
    }>()
    .default({ critical: 90, emergency: 95, warning: 75 }),

  // ~$0.004 USD
  // Alert preferences
  enableBudgetAlerts: boolean('enable_budget_alerts').default(true),

  // Notification preferences
  emailAlerts: boolean('email_alerts').default(true),

  // Cost optimization settings
  enableCostOptimization: boolean('enable_cost_optimization').default(true),

  inAppAlerts: boolean('in_app_alerts').default(true),

  // Budget preferences (updated per PRICING_MASTERPLAN)
  // Default: 50,000 points for vn_free tier
  monthlyBudgetPoints: integer('monthly_budget_points').default(50_000),

  maxCostPerQueryVND: real('max_cost_per_query_vnd').default(100),

  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .primaryKey(),

  // Legacy VND fields (kept for backward compatibility)
  monthlyBudgetVND: real('monthly_budget_vnd').default(0),
  // Model preferences
  preferredModels: jsonb('preferred_models').$type<string[]>(),

  ...timestamps,
});

/**
 * Provider cost tracking for admin analytics
 */
export const providerCosts = pgTable('provider_costs', {
  // Additional metadata
  currency: varchar('currency', { length: 3 }).default('USD'),

  // Effective date range
  effectiveFrom: timestamp('effective_from').notNull(),

  effectiveTo: timestamp('effective_to'),

  id: text('id')
    .$defaultFn(() => `provider_cost_${Date.now()}`)
    .primaryKey(),

  // Cost per 1K tokens in USD
  inputCostPer1K: real('input_cost_per_1k').notNull(),

  model: varchar('model', { length: 100 }).notNull(),

  notes: text('notes'),

  outputCostPer1K: real('output_cost_per_1k').notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),

  ...timestamps,
});

// Export types
export type UsageLog = typeof usageLogs.$inferSelect;
export type NewUsageLog = typeof usageLogs.$inferInsert;

export type MonthlyUsageSummary = typeof monthlyUsageSummary.$inferSelect;
export type NewMonthlyUsageSummary = typeof monthlyUsageSummary.$inferInsert;

export type UserCostSettings = typeof userCostSettings.$inferSelect;
export type NewUserCostSettings = typeof userCostSettings.$inferInsert;

export type ProviderCost = typeof providerCosts.$inferSelect;
export type NewProviderCost = typeof providerCosts.$inferInsert;
