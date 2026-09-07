import { DOSSIER_STATUSES } from "@docstore/shared/dossier";
import { relations } from "drizzle-orm";
import {
	index,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { createId } from "../id";
import { document } from "./document";

export const dossierStatusEnum = pgEnum("dossier_status", DOSSIER_STATUSES);

/**
 * Dossier (SPEC §2): a flat, cross-cutting collection with a lifecycle.
 * No hierarchy — a document can belong to several Dossiers.
 */
export const dossier = pgTable(
	"dossier",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("dos_")),
		name: text("name").notNull(),
		description: text("description"),
		status: dossierStatusEnum("status").notNull().default("open"),
		closedAt: timestamp("closed_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("dossier_status_idx").on(table.status)],
);

export const documentDossier = pgTable(
	"document_dossier",
	{
		documentId: text("document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		dossierId: text("dossier_id")
			.notNull()
			.references(() => dossier.id, { onDelete: "cascade" }),
		addedAt: timestamp("added_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.documentId, table.dossierId] }),
		index("document_dossier_dossier_id_idx").on(table.dossierId),
	],
);

export const dossierRelations = relations(dossier, ({ many }) => ({
	documents: many(documentDossier),
}));

export const documentDossierRelations = relations(
	documentDossier,
	({ one }) => ({
		document: one(document, {
			fields: [documentDossier.documentId],
			references: [document.id],
		}),
		dossier: one(dossier, {
			fields: [documentDossier.dossierId],
			references: [dossier.id],
		}),
	}),
);

export type Dossier = typeof dossier.$inferSelect;
export type NewDossier = typeof dossier.$inferInsert;
export type DocumentDossierRow = typeof documentDossier.$inferSelect;
export type NewDocumentDossier = typeof documentDossier.$inferInsert;
