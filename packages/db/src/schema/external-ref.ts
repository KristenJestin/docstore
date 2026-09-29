import { relations } from "drizzle-orm";
import {
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId } from "../id";
import { document } from "./document";

/**
 * Note of an external system that references a document (issue #4): a page
 * of the life wiki citing a contract. A table rather than a jsonb column
 * (D4-01): the filters `referencedBy` / `notReferencedBy` become an indexed
 * `exists`, and the uniqueness of a ref per document and system is enforced
 * by the database.
 */
export const documentExternalRef = pgTable(
	"document_external_ref",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("xrf_")),
		documentId: text("document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		/** Lowercase slug of the external system (`wiki`). */
		system: text("system").notNull(),
		/** Identifier of the note in that system (a wiki page path). */
		ref: text("ref").notNull(),
		url: text("url"),
		label: text("label"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		uniqueIndex("document_external_ref_uidx").on(
			table.documentId,
			table.system,
			table.ref,
		),
		// `referencedBy` / `notReferencedBy`: the documents of one system.
		index("document_external_ref_system_idx").on(
			table.system,
			table.documentId,
		),
	],
);

export const documentExternalRefRelations = relations(
	documentExternalRef,
	({ one }) => ({
		document: one(document, {
			fields: [documentExternalRef.documentId],
			references: [document.id],
		}),
	}),
);

export type DocumentExternalRefRow = typeof documentExternalRef.$inferSelect;
export type NewDocumentExternalRef = typeof documentExternalRef.$inferInsert;
