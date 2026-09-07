import type { OcrLayout, ReviewReason } from "@docstore/shared/document";
import {
	ASSIGNMENT_SOURCES,
	DATE_PRECISIONS,
	DOCUMENT_FILE_KINDS,
	DOCUMENT_PARTY_ROLES,
	DOCUMENT_SOURCES,
	DOCUMENT_STATUSES,
} from "@docstore/shared/document";
import type { IntakeMeta } from "@docstore/shared/intake";
import { relations, sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	customType,
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
import { user } from "./auth";
import { category } from "./category";
import { documentType, documentTypeLayout } from "./document-type";
import { party } from "./party";

/**
 * `tsvector` has no native type in drizzle-orm: it is declared here so that the
 * generated column is emitted with the right type in the migrations.
 */
const tsvector = customType<{ data: string; driverData: string }>({
	dataType() {
		return "tsvector";
	},
});

export const documentStatusEnum = pgEnum("document_status", DOCUMENT_STATUSES);
export const datePrecisionEnum = pgEnum("date_precision", DATE_PRECISIONS);
export const documentFileKindEnum = pgEnum(
	"document_file_kind",
	DOCUMENT_FILE_KINDS,
);
export const documentPartyRoleEnum = pgEnum(
	"document_party_role",
	DOCUMENT_PARTY_ROLES,
);
export const assignmentSourceEnum = pgEnum(
	"assignment_source",
	ASSIGNMENT_SOURCES,
);
export const documentSourceEnum = pgEnum("document_source", DOCUMENT_SOURCES);

export const document = pgTable(
	"document",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("doc_")),
		title: text("title").notNull(),
		status: documentStatusEnum("status").notNull().default("processing"),
		documentDate: date("document_date"),
		datePrecision: datePrecisionEnum("date_precision"),
		periodStart: date("period_start"),
		periodEnd: date("period_end"),
		receivedAt: date("received_at"),
		validFrom: date("valid_from"),
		validUntil: date("valid_until"),
		categoryId: text("category_id").references(() => category.id, {
			onDelete: "set null",
		}),
		/** Origin of the category assignment; `null` confidence when manual. */
		categorySource: assignmentSourceEnum("category_source")
			.notNull()
			.default("manual"),
		categoryConfidence: real("category_confidence"),
		/** Document type carried by the document (SPEC §9). */
		documentTypeId: text("document_type_id").references(() => documentType.id, {
			onDelete: "set null",
		}),
		documentTypeSource: assignmentSourceEnum("document_type_source")
			.notNull()
			.default("manual"),
		documentTypeConfidence: real("document_type_confidence"),
		/** Layout of that type selected for this document. */
		layoutId: text("layout_id").references(() => documentTypeLayout.id, {
			onDelete: "set null",
		}),
		sensitive: boolean("sensitive").notNull().default(false),
		/**
		 * Metadata a human entered by hand (`MANUAL_DOCUMENT_FIELDS`).
		 *
		 * The pipeline is free to rewrite everything else on every pass — that is
		 * what makes `document.reprocess` able to fix a date the old analyzer got
		 * wrong. A field named here is off limits: the ingestion never overwrites
		 * a decision someone took (SPEC §5).
		 */
		manualFields: text("manual_fields")
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		/** Physical archive number (Archive Serial Number). */
		asn: integer("asn").unique(),
		physicalLocation: text("physical_location"),
		/** OCR text concatenated from every file of the document. */
		content: text("content"),
		/**
		 * Free-text notes typed by a human (light Markdown). Never written by the
		 * pipeline, and part of the full-text index alongside the title and the
		 * OCR text.
		 */
		notes: text("notes"),
		/** Intake channel: web upload, mailbox, watched folder… */
		source: documentSourceEnum("source").notNull().default("upload"),
		/**
		 * Reference within the intake channel: id of the `intake_source` or of
		 * the `upload_link`, or `Message-ID` of the originating email.
		 */
		sourceRef: text("source_ref"),
		/**
		 * What the channel knows about the document (email sender and subject…).
		 * The rule engine finds it back in `RuleSubject.mail`.
		 */
		intakeMeta: jsonb("intake_meta").$type<IntakeMeta>(),
		/**
		 * Reasons for queueing the document for Review (SPEC §4). Empty = the
		 * document may switch to `active` at the end of the pipeline.
		 */
		reviewReasons: jsonb("review_reasons")
			.$type<ReviewReason[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		/**
		 * Last error from the intake pipeline (SPEC §5). Non-null = the document
		 * stayed in `processing` after all retries were exhausted.
		 */
		processingError: text("processing_error"),
		searchVector: tsvector("search_vector").generatedAlwaysAs(
			sql`to_tsvector('french', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(notes, ''))`,
		),
		createdById: text("created_by_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		/** Trash: non-null = soft-deleted. */
		deletedAt: timestamp("deleted_at"),
	},
	(table) => [
		index("document_status_idx").on(table.status),
		index("document_document_date_idx").on(table.documentDate),
		index("document_deleted_at_idx").on(table.deletedAt),
		index("document_category_id_idx").on(table.categoryId),
		index("document_document_type_id_idx").on(table.documentTypeId),
		index("document_search_vector_idx").using("gin", table.searchVector),
	],
);

export const documentFile = pgTable(
	"document_file",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("fil_")),
		documentId: text("document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		kind: documentFileKindEnum("kind").notNull(),
		filename: text("filename").notNull(),
		mime: text("mime").notNull(),
		size: bigint("size", { mode: "number" }).notNull(),
		sha256: text("sha256").notNull(),
		storageKey: text("storage_key").notNull().unique(),
		pageCount: integer("page_count"),
		/** Simplified hOCR: words + bbox per page. */
		ocrLayout: jsonb("ocr_layout").$type<OcrLayout>(),
		encrypted: boolean("encrypted").notNull().default(false),
		thumbnailKey: text("thumbnail_key"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("document_file_document_id_idx").on(table.documentId),
		// Duplicate detection: only originals are deduplicated.
		uniqueIndex("document_file_sha256_original_uidx")
			.on(table.sha256)
			.where(sql`${table.kind} = 'original'`),
	],
);

export const documentParty = pgTable(
	"document_party",
	{
		documentId: text("document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		partyId: text("party_id")
			.notNull()
			.references(() => party.id, { onDelete: "cascade" }),
		role: documentPartyRoleEnum("role").notNull(),
		/** 0–1, null when the assignment is manual. */
		confidence: real("confidence"),
		source: assignmentSourceEnum("source").notNull().default("manual"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.documentId, table.partyId, table.role],
		}),
		index("document_party_party_id_idx").on(table.partyId),
	],
);

export const documentRelations = relations(document, ({ one, many }) => ({
	createdBy: one(user, {
		fields: [document.createdById],
		references: [user.id],
	}),
	category: one(category, {
		fields: [document.categoryId],
		references: [category.id],
	}),
	documentType: one(documentType, {
		fields: [document.documentTypeId],
		references: [documentType.id],
	}),
	layout: one(documentTypeLayout, {
		fields: [document.layoutId],
		references: [documentTypeLayout.id],
	}),
	files: many(documentFile),
	parties: many(documentParty),
}));

export const documentFileRelations = relations(documentFile, ({ one }) => ({
	document: one(document, {
		fields: [documentFile.documentId],
		references: [document.id],
	}),
}));

export const documentPartyRelations = relations(documentParty, ({ one }) => ({
	document: one(document, {
		fields: [documentParty.documentId],
		references: [document.id],
	}),
	party: one(party, {
		fields: [documentParty.partyId],
		references: [party.id],
	}),
}));

export type Document = typeof document.$inferSelect;
export type NewDocument = typeof document.$inferInsert;
export type DocumentFile = typeof documentFile.$inferSelect;
export type NewDocumentFile = typeof documentFile.$inferInsert;
export type DocumentParty = typeof documentParty.$inferSelect;
export type NewDocumentParty = typeof documentParty.$inferInsert;
