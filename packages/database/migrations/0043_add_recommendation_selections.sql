-- Add onboarding-related columns to users table
-- These store the user's profession selection and recommendations from onboarding

-- Add profession column for storing user's selected profession(s)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profession" text;
--> statement-breakpoint
-- Add specialization column for more specific role details
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "specialization" text;
--> statement-breakpoint
-- Add recommendation_selections column for storing AI/plugin recommendations
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "recommendation_selections" jsonb;
--> statement-breakpoint
-- Add index for faster queries on recommendation_selections
CREATE INDEX IF NOT EXISTS "users_recommendation_selections_idx" ON "users" USING gin ("recommendation_selections");
