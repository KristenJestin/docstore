CREATE TABLE "duplicate_ignore" (
	"document_id" text NOT NULL,
	"other_document_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_ignore_document_id_other_document_id_pk" PRIMARY KEY("document_id","other_document_id"),
	CONSTRAINT "duplicate_ignore_order_ck" CHECK ("duplicate_ignore"."document_id" < "duplicate_ignore"."other_document_id")
);
--> statement-breakpoint
ALTER TABLE "duplicate_ignore" ADD CONSTRAINT "duplicate_ignore_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_ignore" ADD CONSTRAINT "duplicate_ignore_other_document_id_document_id_fk" FOREIGN KEY ("other_document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;