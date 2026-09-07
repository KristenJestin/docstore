CREATE TABLE "share_link" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"document_id" text,
	"dossier_id" text,
	"expires_at" timestamp,
	"password_hash" text,
	"max_views" integer,
	"views" integer DEFAULT 0 NOT NULL,
	"allow_download" boolean DEFAULT true NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "share_link_token_unique" UNIQUE("token"),
	CONSTRAINT "share_link_target_ck" CHECK (("share_link"."document_id" is not null) <> ("share_link"."dossier_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_dossier_id_dossier_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_link_document_id_idx" ON "share_link" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "share_link_dossier_id_idx" ON "share_link" USING btree ("dossier_id");