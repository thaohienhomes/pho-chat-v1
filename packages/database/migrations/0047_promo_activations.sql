-- PHO-248/A1.9: Promo activation tracking table.
--
-- The previous in-memory Map<string, number> counter in
-- src/app/api/promo/activate/route.ts was defeated by Vercel cold starts
-- and multi-instance routing — each function instance kept its own counter
-- and a redeploy reset it to 0, allowing unlimited redemption.
--
-- This table is the new source of truth for "how many times has code X
-- been redeemed". Append-only, with a unique (user_id, promo_code)
-- constraint that also blocks the same user from redeeming the same code
-- twice (race-safe at the DB level).
--
-- All statements are idempotent (IF NOT EXISTS) so it is safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'promo_activations') THEN
    CREATE TABLE "promo_activations" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "promo_code" varchar(50) NOT NULL,
      "plan_id" varchar(50) NOT NULL,
      "activated_at" timestamp with time zone NOT NULL DEFAULT now()
    );
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'promo_activations' AND constraint_name = 'promo_activations_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "promo_activations"
      ADD CONSTRAINT "promo_activations_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promo_activations_user_code_unique"
  ON "promo_activations" ("user_id", "promo_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promo_activations_code_idx"
  ON "promo_activations" ("promo_code");
