CREATE TYPE "public"."share_link_revoked_reason" AS ENUM('manual', 'sensitive');--> statement-breakpoint
ALTER TABLE "share_link" ADD COLUMN "revoked_reason" "share_link_revoked_reason";--> statement-breakpoint
-- Links revoked before this column existed were all revoked by hand.
UPDATE "share_link" SET "revoked_reason" = 'manual' WHERE "revoked_at" IS NOT NULL;
