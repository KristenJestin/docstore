CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'number', 'money', 'date', 'boolean', 'select', 'url', 'party_ref');--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"icon" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" "custom_field_type" NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"category_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "document_field_value" (
	"document_id" text NOT NULL,
	"field_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"confidence" real,
	"source" "assignment_source" DEFAULT 'manual' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_field_value_document_id_field_id_pk" PRIMARY KEY("document_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "document_tag" (
	"document_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"confidence" real,
	"source" "assignment_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_tag_document_id_tag_id_pk" PRIMARY KEY("document_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "category_id" text;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_field_value" ADD CONSTRAINT "document_field_value_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_field_value" ADD CONSTRAINT "document_field_value_field_id_custom_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tag" ADD CONSTRAINT "document_tag_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tag" ADD CONSTRAINT "document_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_parent_id_idx" ON "category" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_parent_slug_uidx" ON "category" USING btree (coalesce("parent_id", ''),"slug");--> statement-breakpoint
CREATE INDEX "custom_field_sort_order_idx" ON "custom_field" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "document_field_value_field_id_idx" ON "document_field_value" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "document_tag_tag_id_idx" ON "document_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_name_lower_uidx" ON "tag" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_category_id_idx" ON "document" USING btree ("category_id");