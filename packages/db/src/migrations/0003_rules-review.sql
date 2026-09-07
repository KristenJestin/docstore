CREATE TYPE "public"."document_source" AS ENUM('upload', 'mail', 'folder', 'link', 'api');--> statement-breakpoint
CREATE TABLE "extraction_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"target" jsonb NOT NULL,
	"strategy" jsonb NOT NULL,
	"postprocess" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"triggers" text[] DEFAULT '{ingest}'::text[] NOT NULL,
	"condition" jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stop_on_match" boolean DEFAULT false NOT NULL,
	"match_count" integer DEFAULT 0 NOT NULL,
	"last_matched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_run" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"document_id" text NOT NULL,
	"matched" boolean NOT NULL,
	"actions_applied" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "source" "document_source" DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "review_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_run" ADD CONSTRAINT "rule_run_rule_id_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_run" ADD CONSTRAINT "rule_run_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rule_enabled_priority_idx" ON "rule" USING btree ("enabled","priority");--> statement-breakpoint
CREATE INDEX "rule_run_rule_id_idx" ON "rule_run" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "rule_run_document_id_idx" ON "rule_run" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "rule_run_created_at_idx" ON "rule_run" USING btree ("created_at");