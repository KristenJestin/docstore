ALTER TABLE "document" ADD COLUMN "category_source" "assignment_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "category_confidence" real;