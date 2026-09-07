ALTER TABLE "reminder" ADD COLUMN "days_before" integer;--> statement-breakpoint
-- Backfill: an expiry reminder stands for the gap between its due date and the
-- expiry date of the document, which is exactly what generated it.
UPDATE "reminder" AS "r"
SET "days_before" = "d"."valid_until" - "r"."due_date"
FROM "document" AS "d"
WHERE "d"."id" = "r"."document_id"
	AND "r"."kind" = 'expiry'
	AND "d"."valid_until" IS NOT NULL;
