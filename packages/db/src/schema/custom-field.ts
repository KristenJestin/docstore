import type {
	CustomFieldOptions,
	CustomFieldValue,
} from "@docstore/shared/custom-field";
import { CUSTOM_FIELD_TYPES } from "@docstore/shared/custom-field";
import { relations, sql } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { createId } from "../id";
import { assignmentSourceEnum, document } from "./document";

export const customFieldTypeEnum = pgEnum(
	"custom_field_type",
	CUSTOM_FIELD_TYPES,
);

/** Custom field definition (SPEC §2 "CustomFieldDefinition"). */
export const customField = pgTable(
	"custom_field",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("cf_")),
		name: text("name").notNull(),
		slug: text("slug").notNull().unique(),
		type: customFieldTypeEnum("type").notNull(),
		options: jsonb("options").$type<CustomFieldOptions>().notNull().default({}),
		/** Categories where the field is offered; empty = visible everywhere. */
		categoryIds: text("category_ids")
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("custom_field_sort_order_idx").on(table.sortOrder)],
);

export const documentFieldValue = pgTable(
	"document_field_value",
	{
		documentId: text("document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		fieldId: text("field_id")
			.notNull()
			.references(() => customField.id, { onDelete: "cascade" }),
		/** Typed value: the shape depends on the field `type` (discriminated union). */
		value: jsonb("value").$type<CustomFieldValue>().notNull(),
		confidence: real("confidence"),
		source: assignmentSourceEnum("source").notNull().default("manual"),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.documentId, table.fieldId] }),
		index("document_field_value_field_id_idx").on(table.fieldId),
	],
);

export const customFieldRelations = relations(customField, ({ many }) => ({
	values: many(documentFieldValue),
}));

export const documentFieldValueRelations = relations(
	documentFieldValue,
	({ one }) => ({
		document: one(document, {
			fields: [documentFieldValue.documentId],
			references: [document.id],
		}),
		field: one(customField, {
			fields: [documentFieldValue.fieldId],
			references: [customField.id],
		}),
	}),
);

export type CustomFieldRow = typeof customField.$inferSelect;
export type NewCustomField = typeof customField.$inferInsert;
export type DocumentFieldValueRow = typeof documentFieldValue.$inferSelect;
export type NewDocumentFieldValue = typeof documentFieldValue.$inferInsert;
