CREATE TYPE "public"."date_source" AS ENUM('labelled', 'period', 'inferred', 'manual');--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "date_source" date_source;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "date_confidence" real;--> statement-breakpoint
-- A date the user typed is already recorded in `manual_fields`: no ingestion
-- pass is needed to know it is theirs. Everything else keeps a null source
-- until the next `document.reprocess` re-reads the text, so no document gets
-- badged with a provenance nobody measured.
UPDATE "document" SET "date_source" = 'manual'
WHERE "document_date" IS NOT NULL AND 'documentDate' = ANY("manual_fields");
