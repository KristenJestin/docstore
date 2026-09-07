ALTER TYPE "public"."series_periodicity" ADD VALUE 'weekly' BEFORE 'monthly';--> statement-breakpoint
CREATE TABLE "document_type" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text,
	"category_id" text,
	"issuer_party_id" text,
	"subject_party_id" text,
	"tag_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"sensitive_default" boolean DEFAULT false NOT NULL,
	"title_template" text,
	"detection" jsonb,
	"detection_confidence" real DEFAULT 0.9 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"periodicity" "series_periodicity",
	"start_period" date,
	"end_period" date,
	"expected_day" integer,
	"grace_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_type_layout" (
	"id" text PRIMARY KEY NOT NULL,
	"document_type_id" text NOT NULL,
	"name" text NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"signature" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_type_override" (
	"document_id" text NOT NULL,
	"document_type_id" text NOT NULL,
	"included" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_type_override_document_id_document_type_id_pk" PRIMARY KEY("document_id","document_type_id")
);
--> statement-breakpoint
ALTER TABLE "reminder" DROP CONSTRAINT "reminder_series_id_series_id_fk";
--> statement-breakpoint
ALTER TABLE "reminder" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
UPDATE "reminder" SET "kind" = 'period_gap' WHERE "kind" = 'series_gap';--> statement-breakpoint
DROP TYPE "public"."reminder_kind";--> statement-breakpoint
CREATE TYPE "public"."reminder_kind" AS ENUM('expiry', 'period_gap', 'review_pending');--> statement-breakpoint
ALTER TABLE "reminder" ALTER COLUMN "kind" SET DATA TYPE "public"."reminder_kind" USING "kind"::"public"."reminder_kind";--> statement-breakpoint
DROP INDEX "reminder_series_id_idx";--> statement-breakpoint
DROP INDEX "reminder_identity_uidx";--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "document_type_id" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "document_type_source" "assignment_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "document_type_confidence" real;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "layout_id" text;--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "document_type_id" text;--> statement-breakpoint
ALTER TABLE "extraction_rule" ADD COLUMN "layout_id" text;--> statement-breakpoint
ALTER TABLE "document_type" ADD CONSTRAINT "document_type_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type" ADD CONSTRAINT "document_type_issuer_party_id_party_id_fk" FOREIGN KEY ("issuer_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type" ADD CONSTRAINT "document_type_subject_party_id_party_id_fk" FOREIGN KEY ("subject_party_id") REFERENCES "public"."party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type_layout" ADD CONSTRAINT "document_type_layout_document_type_id_document_type_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type_override" ADD CONSTRAINT "document_type_override_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type_override" ADD CONSTRAINT "document_type_override_document_type_id_document_type_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_type_enabled_priority_idx" ON "document_type" USING btree ("enabled","priority");--> statement-breakpoint
CREATE INDEX "document_type_category_id_idx" ON "document_type" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "document_type_issuer_party_id_idx" ON "document_type" USING btree ("issuer_party_id");--> statement-breakpoint
CREATE INDEX "document_type_periodicity_idx" ON "document_type" USING btree ("periodicity");--> statement-breakpoint
CREATE INDEX "document_type_layout_document_type_id_idx" ON "document_type_layout" USING btree ("document_type_id");--> statement-breakpoint
CREATE INDEX "document_type_override_document_type_id_idx" ON "document_type_override" USING btree ("document_type_id");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_document_type_id_document_type_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_layout_id_document_type_layout_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."document_type_layout"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_document_type_id_document_type_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_rule" ADD CONSTRAINT "extraction_rule_layout_id_document_type_layout_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."document_type_layout"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_document_type_id_idx" ON "document" USING btree ("document_type_id");--> statement-breakpoint
CREATE INDEX "reminder_document_type_id_idx" ON "reminder" USING btree ("document_type_id");--> statement-breakpoint
CREATE INDEX "extraction_rule_layout_id_idx" ON "extraction_rule" USING btree ("layout_id");--> statement-breakpoint
INSERT INTO "document_type" (
	"id",
	"name",
	"category_id",
	"issuer_party_id",
	"periodicity",
	"start_period",
	"end_period",
	"expected_day",
	"grace_days",
	"enabled",
	"created_at",
	"updated_at"
)
SELECT
	'dty_' || substring("id" from 5),
	"name",
	"category_id",
	"party_id",
	"periodicity",
	"start_period",
	"end_period",
	"expected_day",
	"grace_days",
	"enabled",
	"created_at",
	"updated_at"
FROM "series";--> statement-breakpoint
INSERT INTO "document_type_override" ("document_id", "document_type_id", "included", "created_at")
SELECT "document_id", 'dty_' || substring("series_id" from 5), "included", "created_at"
FROM "document_series_override";--> statement-breakpoint
UPDATE "reminder" SET "document_type_id" = 'dty_' || substring("series_id" from 5) WHERE "series_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_identity_uidx" ON "reminder" USING btree ("kind",coalesce("document_id", ''),coalesce("document_type_id", ''),coalesce("period", '1970-01-01'::date),"due_date");--> statement-breakpoint
DROP TABLE "document_series_override" CASCADE;--> statement-breakpoint
DROP TABLE "series" CASCADE;--> statement-breakpoint
ALTER TABLE "reminder" DROP COLUMN "series_id";
