CREATE TABLE "document_external_ref" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"system" text NOT NULL,
	"ref" text NOT NULL,
	"url" text,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_external_ref" ADD CONSTRAINT "document_external_ref_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_external_ref_uidx" ON "document_external_ref" USING btree ("document_id","system","ref");--> statement-breakpoint
CREATE INDEX "document_external_ref_system_idx" ON "document_external_ref" USING btree ("system","document_id");