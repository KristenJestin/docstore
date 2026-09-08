ALTER TABLE "document_type" ADD COLUMN "generic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The `Any <Category>` types `0012_extraction-in-types` created carry a
-- deterministic id. Flagging them is what lets `ensureGenericForCategory` find
-- them again instead of creating a second one, and what lets the pipeline run
-- the extraction rules they hold: created disabled, they had been running
-- nothing at all since that migration.
UPDATE "document_type"
SET "generic" = true, "enabled" = true
WHERE "id" = 'dty_' || substr(md5('any:' || coalesce("category_id", 'none')), 1, 21);--> statement-breakpoint
CREATE UNIQUE INDEX "document_type_generic_category_idx" ON "document_type" USING btree ("category_id") WHERE "document_type"."generic";
