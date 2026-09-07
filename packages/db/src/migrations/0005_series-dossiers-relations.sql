CREATE TYPE "public"."dossier_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."document_relation_kind" AS ENUM('version_of', 'page_of', 'supersedes', 'related_to', 'fulfills');--> statement-breakpoint
CREATE TYPE "public"."reminder_kind" AS ENUM('expiry', 'series_gap', 'review_pending');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('pending', 'done', 'snoozed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."series_periodicity" AS ENUM('monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TABLE "document_dossier" (
	"document_id" text NOT NULL,
	"dossier_id" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_dossier_document_id_dossier_id_pk" PRIMARY KEY("document_id","dossier_id")
);
--> statement-breakpoint
CREATE TABLE "dossier" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "dossier_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_relation" (
	"id" text PRIMARY KEY NOT NULL,
	"from_document_id" text NOT NULL,
	"to_document_id" text NOT NULL,
	"kind" "document_relation_kind" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_relation_no_self" CHECK ("document_relation"."from_document_id" <> "document_relation"."to_document_id")
);
--> statement-breakpoint
CREATE TABLE "reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "reminder_kind" NOT NULL,
	"document_id" text,
	"series_id" text,
	"due_date" date NOT NULL,
	"period" date,
	"status" "reminder_status" DEFAULT 'pending' NOT NULL,
	"snoozed_until" date,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_search" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_series_override" (
	"document_id" text NOT NULL,
	"series_id" text NOT NULL,
	"included" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_series_override_document_id_series_id_pk" PRIMARY KEY("document_id","series_id")
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"party_id" text,
	"category_id" text,
	"periodicity" "series_periodicity" NOT NULL,
	"start_period" date NOT NULL,
	"end_period" date,
	"expected_day" integer,
	"grace_days" integer DEFAULT 15 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"match_rule_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_dossier" ADD CONSTRAINT "document_dossier_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_dossier" ADD CONSTRAINT "document_dossier_dossier_id_dossier_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_relation" ADD CONSTRAINT "document_relation_from_document_id_document_id_fk" FOREIGN KEY ("from_document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_relation" ADD CONSTRAINT "document_relation_to_document_id_document_id_fk" FOREIGN KEY ("to_document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_series_override" ADD CONSTRAINT "document_series_override_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_series_override" ADD CONSTRAINT "document_series_override_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_match_rule_id_rule_id_fk" FOREIGN KEY ("match_rule_id") REFERENCES "public"."rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_dossier_dossier_id_idx" ON "document_dossier" USING btree ("dossier_id");--> statement-breakpoint
CREATE INDEX "dossier_status_idx" ON "dossier" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "document_relation_uidx" ON "document_relation" USING btree ("from_document_id","to_document_id","kind");--> statement-breakpoint
CREATE INDEX "document_relation_from_idx" ON "document_relation" USING btree ("from_document_id");--> statement-breakpoint
CREATE INDEX "document_relation_to_idx" ON "document_relation" USING btree ("to_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_identity_uidx" ON "reminder" USING btree ("kind",coalesce("document_id", ''),coalesce("series_id", ''),coalesce("period", '1970-01-01'::date),"due_date");--> statement-breakpoint
CREATE INDEX "reminder_status_due_date_idx" ON "reminder" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "reminder_document_id_idx" ON "reminder" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "reminder_series_id_idx" ON "reminder" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "saved_search_sort_order_idx" ON "saved_search" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "document_series_override_series_id_idx" ON "document_series_override" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "series_party_id_idx" ON "series" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "series_category_id_idx" ON "series" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "series_enabled_idx" ON "series" USING btree ("enabled");