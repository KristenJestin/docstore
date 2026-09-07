import { relations, sql } from "drizzle-orm";
import {
	check,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { document } from "./document";

/**
 * Dismissed duplicate pairs (`document.duplicates`): once a pair is confirmed
 * to be two distinct documents, it is never suggested again.
 *
 * The pair is normalized so `document_id < other_document_id`: a single row
 * covers both directions, and the composite primary key prevents storing it
 * twice.
 */
export const duplicateIgnore = pgTable(
	"duplicate_ignore",
	{
		documentId: text("document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		otherDocumentId: text("other_document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.documentId, table.otherDocumentId] }),
		check(
			"duplicate_ignore_order_ck",
			sql`${table.documentId} < ${table.otherDocumentId}`,
		),
	],
);

export const duplicateIgnoreRelations = relations(
	duplicateIgnore,
	({ one }) => ({
		document: one(document, {
			fields: [duplicateIgnore.documentId],
			references: [document.id],
			relationName: "duplicate_ignore_document",
		}),
		otherDocument: one(document, {
			fields: [duplicateIgnore.otherDocumentId],
			references: [document.id],
			relationName: "duplicate_ignore_other_document",
		}),
	}),
);

export type DuplicateIgnoreRow = typeof duplicateIgnore.$inferSelect;
export type NewDuplicateIgnore = typeof duplicateIgnore.$inferInsert;
