CREATE TYPE "public"."intake_outcome" AS ENUM('imported', 'duplicate', 'error', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."intake_source_type" AS ENUM('folder', 'mail');--> statement-breakpoint
CREATE TABLE "intake_log" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"document_id" text,
	"filename" text NOT NULL,
	"outcome" "intake_outcome" NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_source" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "intake_source_type" NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp,
	"last_error" text,
	"stats" jsonb DEFAULT '{"imported":0,"duplicates":0,"errors":0}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_link" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"name" text NOT NULL,
	"message" text,
	"expires_at" timestamp,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "upload_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_status" integer,
	"last_called_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" integer,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "intake_meta" jsonb;--> statement-breakpoint
ALTER TABLE "intake_log" ADD CONSTRAINT "intake_log_source_id_intake_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."intake_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_log" ADD CONSTRAINT "intake_log_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_link" ADD CONSTRAINT "upload_link_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intake_log_source_id_idx" ON "intake_log" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "intake_log_created_at_idx" ON "intake_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "intake_source_enabled_idx" ON "intake_source" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "upload_link_enabled_idx" ON "upload_link" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "webhook_enabled_idx" ON "webhook" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "webhook_delivery_webhook_id_idx" ON "webhook_delivery" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_created_at_idx" ON "webhook_delivery" USING btree ("created_at");