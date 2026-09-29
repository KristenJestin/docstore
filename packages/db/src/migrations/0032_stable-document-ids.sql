CREATE TYPE "public"."document_tombstone_reason" AS ENUM('merged', 'deleted');--> statement-breakpoint
CREATE TABLE "document_tombstone" (
	"document_id" text PRIMARY KEY NOT NULL,
	"reason" "document_tombstone_reason" NOT NULL,
	"merged_into_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_tombstone_target_ck" CHECK (("document_tombstone"."reason" = 'merged') = ("document_tombstone"."merged_into_id" is not null)),
	CONSTRAINT "document_tombstone_no_self_ck" CHECK ("document_tombstone"."merged_into_id" is null or "document_tombstone"."merged_into_id" <> "document_tombstone"."document_id")
);
--> statement-breakpoint
CREATE INDEX "document_tombstone_merged_into_id_idx" ON "document_tombstone" USING btree ("merged_into_id");