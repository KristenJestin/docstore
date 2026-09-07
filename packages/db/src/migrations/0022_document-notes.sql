-- Free-text notes on a document, folded into the full-text index.
--
-- `search_vector` is a generated column: its expression cannot be altered in
-- place, so the column is dropped and rebuilt. Dropping it takes the GIN index
-- with it, which is why the index is recreated at the end. Written by hand:
-- drizzle-kit emits the statements in an order where `notes` does not exist yet
-- when the generated expression references it.
ALTER TABLE "document" ADD COLUMN "notes" text;--> statement-breakpoint
DROP INDEX IF EXISTS "document_search_vector_idx";--> statement-breakpoint
ALTER TABLE "document" DROP COLUMN "search_vector";--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('french', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(notes, ''))) STORED;--> statement-breakpoint
CREATE INDEX "document_search_vector_idx" ON "document" USING gin ("search_vector");
