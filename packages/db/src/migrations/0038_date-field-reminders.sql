ALTER TYPE "public"."reminder_kind" ADD VALUE 'field_date' BEFORE 'period_gap';--> statement-breakpoint
DROP INDEX "reminder_identity_uidx";--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "field_id" text;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_field_id_custom_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminder_field_id_idx" ON "reminder" USING btree ("field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_identity_uidx" ON "reminder" USING btree ("kind",coalesce("document_id", ''),coalesce("document_type_id", ''),coalesce("field_id", ''),coalesce("period", '1970-01-01'::date),"due_date");