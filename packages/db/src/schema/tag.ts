import { relations, sql } from "drizzle-orm";
import {
	index,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId } from "../id";
import { assignmentSourceEnum, document } from "./document";

/** Flat tag (SPEC §2). The name is unique, case-insensitively. */
export const tag = pgTable(
	"tag",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("tag_")),
		name: text("name").notNull(),
		color: text("color"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [uniqueIndex("tag_name_lower_uidx").on(sql`lower(${table.name})`)],
);

export const documentTag = pgTable(
	"document_tag",
	{
		documentId: text("document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tag.id, { onDelete: "cascade" }),
		/** 0–1, null when the assignment is manual. */
		confidence: real("confidence"),
		source: assignmentSourceEnum("source").notNull().default("manual"),
		/** When a human approved this tag in Review (SPEC §4). */
		confirmedAt: timestamp("confirmed_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.documentId, table.tagId] }),
		index("document_tag_tag_id_idx").on(table.tagId),
	],
);

export const tagRelations = relations(tag, ({ many }) => ({
	documents: many(documentTag),
}));

export const documentTagRelations = relations(documentTag, ({ one }) => ({
	document: one(document, {
		fields: [documentTag.documentId],
		references: [document.id],
	}),
	tag: one(tag, {
		fields: [documentTag.tagId],
		references: [tag.id],
	}),
}));

export type Tag = typeof tag.$inferSelect;
export type NewTag = typeof tag.$inferInsert;
export type DocumentTag = typeof documentTag.$inferSelect;
export type NewDocumentTag = typeof documentTag.$inferInsert;
