ALTER TABLE "document_field_value" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "category_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "document_party" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "document_tag" ADD COLUMN "confirmed_at" timestamp;