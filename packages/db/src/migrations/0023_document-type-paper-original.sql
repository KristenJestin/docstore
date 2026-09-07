CREATE TYPE "public"."asn_source" AS ENUM('manual', 'auto');--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "asn_source" "asn_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_type" ADD COLUMN "paper_original" boolean DEFAULT false NOT NULL;