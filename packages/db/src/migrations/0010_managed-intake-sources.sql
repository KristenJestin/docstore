ALTER TABLE "intake_source" ADD COLUMN "managed_key" text;--> statement-breakpoint
ALTER TABLE "intake_source" ADD CONSTRAINT "intake_source_managed_key_unique" UNIQUE("managed_key");