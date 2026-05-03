/* eslint-disable sort-keys-fix/sort-keys-fix */
/**
 * Promo Activations Schema
 *
 * Tracks every promo code redemption. Append-only, used by
 * /api/promo/activate to enforce per-code max-use limits.
 *
 * Why a dedicated table (PHO-248/A1.9):
 *   - In-memory Map<string, number> was reset by Vercel cold starts and
 *     diverged across instances → users could redeem unlimited times.
 *   - Subscriptions row is mutable (Polar webhook updates payment_provider),
 *     so storing the promo code there can't be trusted as a counter.
 *   - This table is append-only with a unique (user_id, promo_code) so the
 *     same user cannot redeem the same code twice, regardless of race
 *     conditions or instance routing.
 */
import { index, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { timestamptz } from './_helpers';
import { users } from './user';

export const promoActivations = pgTable(
  'promo_activations',
  {
    id: text('id')
      .$defaultFn(() => `promo_act_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
      .primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    promoCode: varchar('promo_code', { length: 50 }).notNull(),
    planId: varchar('plan_id', { length: 50 }).notNull(),

    activatedAt: timestamptz('activated_at').notNull().defaultNow(),
  },
  (self) => ({
    userCodeUnique: uniqueIndex('promo_activations_user_code_unique').on(
      self.userId,
      self.promoCode,
    ),
    codeIdx: index('promo_activations_code_idx').on(self.promoCode),
  }),
);

export type NewPromoActivation = typeof promoActivations.$inferInsert;
export type PromoActivationItem = typeof promoActivations.$inferSelect;
