import { SHARE_LINK_REVOKED_REASONS } from "@docstore/shared/share-link";
import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { createId } from "../id";
import { user } from "./auth";
import { document } from "./document";
import { dossier } from "./dossier";

/**
 * Share links (SPEC §2 "Misc"): a public URL `/s/<token>` onto a single
 * document or a whole dossier, with an expiry, an optional password and a view
 * quota.
 *
 * A link points at exactly one target — the `share_link_target_ck` constraint
 * enforces it in the database, not just in the Zod schema. Documents flagged
 * `sensitive` can never be shared (checked by the service).
 */
export const shareLinkRevokedReasonEnum = pgEnum(
	"share_link_revoked_reason",
	SHARE_LINK_REVOKED_REASONS,
);

export const shareLink = pgTable(
	"share_link",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("shl_")),
		/** 32 random characters, exposed in the public URL `/s/<token>`. */
		token: text("token").notNull().unique(),
		documentId: text("document_id").references(() => document.id, {
			onDelete: "cascade",
		}),
		dossierId: text("dossier_id").references(() => dossier.id, {
			onDelete: "cascade",
		}),
		expiresAt: timestamp("expires_at"),
		/** Argon2id hash produced by `Bun.password`; `null` = no password. */
		passwordHash: text("password_hash"),
		/** `null` = unlimited. */
		maxViews: integer("max_views"),
		views: integer("views").notNull().default(0),
		/** `false` = metadata only, the files stay out of reach. */
		allowDownload: boolean("allow_download").notNull().default(true),
		createdById: text("created_by_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		/** Non-null = revoked: the link answers 410 for good. */
		revokedAt: timestamp("revoked_at"),
		/**
		 * Why it was revoked: by hand, or automatically because the document (or
		 * one of the dossier's documents) became sensitive.
		 */
		revokedReason: shareLinkRevokedReasonEnum("revoked_reason"),
	},
	(table) => [
		index("share_link_document_id_idx").on(table.documentId),
		index("share_link_dossier_id_idx").on(table.dossierId),
		check(
			"share_link_target_ck",
			sql`(${table.documentId} is not null) <> (${table.dossierId} is not null)`,
		),
	],
);

export const shareLinkRelations = relations(shareLink, ({ one }) => ({
	createdBy: one(user, {
		fields: [shareLink.createdById],
		references: [user.id],
	}),
	document: one(document, {
		fields: [shareLink.documentId],
		references: [document.id],
	}),
	dossier: one(dossier, {
		fields: [shareLink.dossierId],
		references: [dossier.id],
	}),
}));

export type ShareLinkRow = typeof shareLink.$inferSelect;
export type NewShareLink = typeof shareLink.$inferInsert;
