import { PERIODICITIES } from "@docstore/shared/recurrence";
import type { RuleCondition } from "@docstore/shared/rule";
import { relations, sql } from "drizzle-orm";
import {
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId } from "../id";
import { category } from "./category";
import { document } from "./document";
import { party } from "./party";

/**
 * Document types (SPEC §9) — "the same document we keep receiving".
 *
 * A type carries the identity (category, issuer, subject, tags, title
 * template), an optional detection condition (the rule engine's tree), an
 * optional recurrence (which absorbed the former `series` table) and its
 * layouts, each of them owning its extraction rules.
 *
 * The enum keeps its historical name `series_periodicity`: renaming a
 * PostgreSQL type buys nothing and would break the migration of the existing
 * rows.
 */
export const periodicityEnum = pgEnum("series_periodicity", PERIODICITIES);

export const documentType = pgTable(
	"document_type",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("dty_")),
		name: text("name").notNull(),
		description: text("description"),
		icon: text("icon"),
		color: text("color"),
		categoryId: text("category_id").references(() => category.id, {
			onDelete: "set null",
		}),
		issuerPartyId: text("issuer_party_id").references(() => party.id, {
			onDelete: "set null",
		}),
		subjectPartyId: text("subject_party_id").references(() => party.id, {
			onDelete: "set null",
		}),
		tagIds: text("tag_ids").array().notNull().default(sql`'{}'::text[]`),
		sensitiveDefault: boolean("sensitive_default").notNull().default(false),
		/**
		 * "We keep the paper": applying this type hands the document the next
		 * archive serial number, so the binder and the library stay in step
		 * (SPEC §2). A document that already carries an ASN keeps it.
		 */
		paperOriginal: boolean("paper_original").notNull().default(false),
		/** Rendered when the title is still the one derived from the filename. */
		titleTemplate: text("title_template"),
		/** Condition tree evaluated by `@docstore/rules`; null = never detected. */
		detection: jsonb("detection").$type<RuleCondition>(),
		detectionConfidence: real("detection_confidence").notNull().default(0.9),
		enabled: boolean("enabled").notNull().default(true),
		/** Ascending detection order: 0 is evaluated before 1. */
		priority: integer("priority").notNull().default(0),
		/**
		 * `Any <Category>`: the type that exists only to hold extraction rules for
		 * a category that has no type of its own (SPEC §9). It never detects
		 * anything and is never assigned to a document — the pipeline just runs
		 * the extraction rules of its default layout on the documents of its
		 * category. At most one per category.
		 */
		generic: boolean("generic").notNull().default(false),

		/* Recurrence (all null for a non-recurring type). */
		periodicity: periodicityEnum("periodicity"),
		/** Always normalized to the first day of its period. */
		startPeriod: date("start_period"),
		/** The recurrence stays open as long as the bound is null. */
		endPeriod: date("end_period"),
		/** Expected day of arrival; null = last day of the period. */
		expectedDay: integer("expected_day"),
		/** Tolerance in days after the expected date before flagging it missing. */
		graceDays: integer("grace_days"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("document_type_enabled_priority_idx").on(
			table.enabled,
			table.priority,
		),
		index("document_type_category_id_idx").on(table.categoryId),
		index("document_type_issuer_party_id_idx").on(table.issuerPartyId),
		index("document_type_periodicity_idx").on(table.periodicity),
		// One generic type per category: `ensureGenericForCategory` reuses it
		// instead of piling up an `Any Invoice` per visit.
		uniqueIndex("document_type_generic_category_idx")
			.on(table.categoryId)
			.where(sql`${table.generic}`),
	],
);

/**
 * Layout of a document type: a page variant, with its own extraction rules
 * (`extraction_rule.layout_id`).
 */
export const documentTypeLayout = pgTable(
	"document_type_layout",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("dtl_")),
		documentTypeId: text("document_type_id")
			.notNull()
			.references(() => documentType.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/**
		 * The layout every type gets on creation: the home of its extraction
		 * rules, and the fallback when no other layout matches. A type always
		 * keeps at least one layout.
		 */
		isDefault: boolean("is_default").notNull().default(false),
		/** Optional validity window used when no signature decides. */
		validFrom: date("valid_from"),
		validUntil: date("valid_until"),
		/** Condition tree identifying the layout; null = no signature. */
		signature: jsonb("signature").$type<RuleCondition>(),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("document_type_layout_document_type_id_idx").on(table.documentTypeId),
	],
);

/** Forced membership (`included`) or manual exclusion of a document. */
export const documentTypeOverride = pgTable(
	"document_type_override",
	{
		documentId: text("document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		documentTypeId: text("document_type_id")
			.notNull()
			.references(() => documentType.id, { onDelete: "cascade" }),
		included: boolean("included").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.documentId, table.documentTypeId] }),
		index("document_type_override_document_type_id_idx").on(
			table.documentTypeId,
		),
	],
);

export const documentTypeRelations = relations(
	documentType,
	({ one, many }) => ({
		category: one(category, {
			fields: [documentType.categoryId],
			references: [category.id],
		}),
		issuer: one(party, {
			fields: [documentType.issuerPartyId],
			references: [party.id],
		}),
		subject: one(party, {
			fields: [documentType.subjectPartyId],
			references: [party.id],
		}),
		layouts: many(documentTypeLayout),
		overrides: many(documentTypeOverride),
	}),
);

export const documentTypeLayoutRelations = relations(
	documentTypeLayout,
	({ one }) => ({
		documentType: one(documentType, {
			fields: [documentTypeLayout.documentTypeId],
			references: [documentType.id],
		}),
	}),
);

export const documentTypeOverrideRelations = relations(
	documentTypeOverride,
	({ one }) => ({
		document: one(document, {
			fields: [documentTypeOverride.documentId],
			references: [document.id],
		}),
		documentType: one(documentType, {
			fields: [documentTypeOverride.documentTypeId],
			references: [documentType.id],
		}),
	}),
);

export type DocumentTypeRow = typeof documentType.$inferSelect;
export type NewDocumentType = typeof documentType.$inferInsert;
export type DocumentTypeLayoutRow = typeof documentTypeLayout.$inferSelect;
export type NewDocumentTypeLayout = typeof documentTypeLayout.$inferInsert;
export type DocumentTypeOverrideRow = typeof documentTypeOverride.$inferSelect;
export type NewDocumentTypeOverride = typeof documentTypeOverride.$inferInsert;
