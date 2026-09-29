CREATE TABLE "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"actor_api_key_id" text,
	"actor_name" text,
	"object_type" text NOT NULL,
	"object_id" text,
	"object_label" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "last_used_ip" text;--> statement-breakpoint
CREATE INDEX "activity_log_created_at_idx" ON "activity_log" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_log_api_key_idx" ON "activity_log" USING btree ("actor_api_key_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_log_user_idx" ON "activity_log" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_log_object_idx" ON "activity_log" USING btree ("object_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_log_action_idx" ON "activity_log" USING btree ("action","created_at" DESC NULLS LAST);