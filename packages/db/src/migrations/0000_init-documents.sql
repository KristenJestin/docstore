CREATE TYPE "public"."assignment_source" AS ENUM('manual', 'rule', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."date_precision" AS ENUM('day', 'month', 'year');--> statement-breakpoint
CREATE TYPE "public"."document_file_kind" AS ENUM('original', 'archive', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."document_party_role" AS ENUM('issuer', 'recipient', 'subject', 'mentioned');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('processing', 'review', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."party_relation_kind" AS ENUM('works_at', 'child_of', 'spouse_of', 'subsidiary_of', 'contact_of');--> statement-breakpoint
CREATE TYPE "public"."party_type" AS ENUM('person', 'company', 'public_body', 'association');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"status" "document_status" DEFAULT 'processing' NOT NULL,
	"document_date" date,
	"date_precision" date_precision,
	"period_start" date,
	"period_end" date,
	"received_at" date,
	"valid_from" date,
	"valid_until" date,
	"sensitive" boolean DEFAULT false NOT NULL,
	"asn" integer,
	"physical_location" text,
	"content" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('french', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "document_asn_unique" UNIQUE("asn")
);
--> statement-breakpoint
CREATE TABLE "document_file" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"kind" "document_file_kind" NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"page_count" integer,
	"ocr_layout" jsonb,
	"encrypted" boolean DEFAULT false NOT NULL,
	"thumbnail_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_file_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "document_party" (
	"document_id" text NOT NULL,
	"party_id" text NOT NULL,
	"role" "document_party_role" NOT NULL,
	"confidence" real,
	"source" "assignment_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_party_document_id_party_id_role_pk" PRIMARY KEY("document_id","party_id","role")
);
--> statement-breakpoint
CREATE TABLE "party" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "party_type" NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"logo_key" text,
	"identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_household_member" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"notes" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_relation" (
	"id" text PRIMARY KEY NOT NULL,
	"from_party_id" text NOT NULL,
	"to_party_id" text NOT NULL,
	"kind" "party_relation_kind" NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_file" ADD CONSTRAINT "document_file_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_party" ADD CONSTRAINT "document_party_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_party" ADD CONSTRAINT "document_party_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party" ADD CONSTRAINT "party_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_relation" ADD CONSTRAINT "party_relation_from_party_id_party_id_fk" FOREIGN KEY ("from_party_id") REFERENCES "public"."party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_relation" ADD CONSTRAINT "party_relation_to_party_id_party_id_fk" FOREIGN KEY ("to_party_id") REFERENCES "public"."party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "document_status_idx" ON "document" USING btree ("status");--> statement-breakpoint
CREATE INDEX "document_document_date_idx" ON "document" USING btree ("document_date");--> statement-breakpoint
CREATE INDEX "document_deleted_at_idx" ON "document" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "document_search_vector_idx" ON "document" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "document_file_document_id_idx" ON "document_file" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_file_sha256_original_uidx" ON "document_file" USING btree ("sha256") WHERE "document_file"."kind" = 'original';--> statement-breakpoint
CREATE INDEX "document_party_party_id_idx" ON "document_party" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "party_name_idx" ON "party" USING btree ("name");--> statement-breakpoint
CREATE INDEX "party_identifiers_gin_idx" ON "party" USING gin ("identifiers");--> statement-breakpoint
CREATE INDEX "party_userId_idx" ON "party" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "party_relation_from_idx" ON "party_relation" USING btree ("from_party_id");--> statement-breakpoint
CREATE INDEX "party_relation_to_idx" ON "party_relation" USING btree ("to_party_id");