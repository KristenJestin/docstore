ALTER TABLE "document" ALTER COLUMN "updated_at" SET DEFAULT date_trunc('milliseconds', now());--> statement-breakpoint
-- The incremental sync hands `updated_at` back as a cursor read through a
-- JavaScript `Date` (millisecond precision): rows written by the old
-- microsecond default are brought down to the same precision.
UPDATE "document" SET "updated_at" = date_trunc('milliseconds', "updated_at")
WHERE "updated_at" <> date_trunc('milliseconds', "updated_at");--> statement-breakpoint
CREATE INDEX "document_updated_at_id_idx" ON "document" USING btree ("updated_at","id");
