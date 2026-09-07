import { DOCUMENT_RELATION_KINDS } from "@docstore/shared/relation";
import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId } from "../id";
import { document } from "./document";

export const documentRelationKindEnum = pgEnum(
	"document_relation_kind",
	DOCUMENT_RELATION_KINDS,
);

/**
 * Typed link between two documents (SPEC §2 "DocumentRelation"): version,
 * page, replacement, free-form pairing, execution of a contract.
 */
export const documentRelation = pgTable(
	"document_relation",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("drl_")),
		fromDocumentId: text("from_document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		toDocumentId: text("to_document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		kind: documentRelationKindEnum("kind").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("document_relation_uidx").on(
			table.fromDocumentId,
			table.toDocumentId,
			table.kind,
		),
		index("document_relation_from_idx").on(table.fromDocumentId),
		index("document_relation_to_idx").on(table.toDocumentId),
		// A document cannot be related to itself.
		check(
			"document_relation_no_self",
			sql`${table.fromDocumentId} <> ${table.toDocumentId}`,
		),
	],
);

export const documentRelationRelations = relations(
	documentRelation,
	({ one }) => ({
		fromDocument: one(document, {
			fields: [documentRelation.fromDocumentId],
			references: [document.id],
			relationName: "document_relation_from",
		}),
		toDocument: one(document, {
			fields: [documentRelation.toDocumentId],
			references: [document.id],
			relationName: "document_relation_to",
		}),
	}),
);

export type DocumentRelationRow = typeof documentRelation.$inferSelect;
export type NewDocumentRelation = typeof documentRelation.$inferInsert;
