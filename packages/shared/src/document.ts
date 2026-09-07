import { z } from "zod";
import { categorySummarySchema } from "./category";
import { assignmentSourceSchema, dateOnlySchema } from "./common";
import {
	customFieldSchema,
	customFieldValueSchema,
	documentFieldFilterSchema,
} from "./custom-field";
import { dossierSummarySchema } from "./dossier";
import { partyTypeSchema } from "./party";
import { membershipKindSchema } from "./recurrence";
import {
	documentRelationKindSchema,
	relationDirectionSchema,
} from "./relation";
import { tagSummarySchema } from "./tag";

export {
	ASSIGNMENT_SOURCES,
	type AssignmentSource,
	assignmentSourceSchema,
} from "./common";

/**
 * Document enum values. Single source of truth: the PostgreSQL enums of
 * `@docstore/db` are built from these constants.
 */
export const DOCUMENT_STATUSES = [
	"processing",
	"review",
	"active",
	"archived",
	/**
	 * The ingestion pipeline gave up after its last retry: `processingError`
	 * carries the reason. `document.reprocess` puts the document back into
	 * `processing`.
	 */
	"failed",
] as const;

export const DATE_PRECISIONS = ["day", "month", "year"] as const;

export const DOCUMENT_FILE_KINDS = [
	"original",
	"archive",
	"attachment",
] as const;

export const DOCUMENT_PARTY_ROLES = [
	"issuer",
	"recipient",
	"subject",
	"mentioned",
] as const;

/** Channel the document arrived through (SPEC §5). */
export const DOCUMENT_SOURCES = [
	"upload",
	"mail",
	"folder",
	"link",
	"api",
] as const;

/**
 * Who handed out the archive serial number: a human ("Assign next", or a
 * number typed in), or the automatic numbering (`asn.autoAssign` setting, or a
 * document type flagged `paperOriginal`).
 */
export const ASN_SOURCES = ["manual", "auto"] as const;

export const DOCUMENT_SORTS = [
	"documentDate:desc",
	"documentDate:asc",
	"createdAt:desc",
	"createdAt:asc",
	"title:asc",
	"title:desc",
	"validUntil:asc",
] as const;

export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const datePrecisionSchema = z.enum(DATE_PRECISIONS);
export type DatePrecision = z.infer<typeof datePrecisionSchema>;

export const documentFileKindSchema = z.enum(DOCUMENT_FILE_KINDS);
export type DocumentFileKind = z.infer<typeof documentFileKindSchema>;

export const documentPartyRoleSchema = z.enum(DOCUMENT_PARTY_ROLES);
export type DocumentPartyRole = z.infer<typeof documentPartyRoleSchema>;

export const documentSourceSchema = z.enum(DOCUMENT_SOURCES);
export type DocumentSource = z.infer<typeof documentSourceSchema>;

export const asnSourceSchema = z.enum(ASN_SOURCES);
export type AsnSource = z.infer<typeof asnSourceSchema>;

/**
 * Where `document_date` comes from (SPEC §5).
 *
 * `labelled` is a date the text introduces itself ("payé le", "date
 * d'émission", "issued on"), `period` one of the bounds of the covered period
 * the text spells out, `inferred` the bare first date found in the text — the
 * only one weak enough to be worth flagging — and `manual` a date someone
 * typed.
 */
export const DATE_SOURCES = [
	"labelled",
	"period",
	"inferred",
	"manual",
] as const;
export const dateSourceSchema = z.enum(DATE_SOURCES);
export type DateSource = z.infer<typeof dateSourceSchema>;

/**
 * Reasons for moving to the review queue (SPEC §4: "when the confidence is
 * below the threshold, the document goes to review").
 */
export const REVIEW_REASON_CODES = [
	"lowConfidence",
	"missingCategory",
	"missingIssuer",
	"extractionFailed",
	/** An optional extraction rule found nothing: the field is simply empty. */
	"extractionMissed",
	"possibleDuplicate",
	"recurringCandidate",
	/** A document type has layouts but none of them could be selected. */
	"unknownLayout",
	/** A document type was detected below the confidence threshold. */
	"typeCandidate",
] as const;
export const reviewReasonCodeSchema = z.enum(REVIEW_REASON_CODES);
export type ReviewReasonCode = z.infer<typeof reviewReasonCodeSchema>;

/**
 * Purely informational reasons: they are surfaced next to the document (and in
 * the review UI when it is already queued) but never send it to `review` on
 * their own.
 */
export const INFORMATIONAL_REVIEW_REASON_CODES = [
	"recurringCandidate",
	"typeCandidate",
	"extractionMissed",
] as const;

/**
 * Metadata whose `lowConfidence` reason is informational: the value is written,
 * shown with its confidence, and corrected in one click. A date read off the
 * text used to queue every single document (SPEC §5).
 */
const INFORMATIONAL_LOW_CONFIDENCE_FIELDS = ["documentDate"] as const;

export const reviewReasonSchema = z.object({
	code: reviewReasonCodeSchema,
	message: z.string(),
	confidence: z.number().min(0).max(1).optional(),
	ruleId: z.string().optional(),
	/** Field or metadata concerned (`fieldId`, `documentDate`, `issuer`…). */
	field: z.string().optional(),
	/** Related entity id (e.g. the other document of a `possibleDuplicate`). */
	ref: z.string().optional(),
	/** Free-form payload, specific to the code (see each emitter). */
	meta: z.record(z.string(), z.unknown()).optional(),
});
export type ReviewReason = z.infer<typeof reviewReasonSchema>;

/** `true` when the reason justifies the `review` status by itself. */
export function isBlockingReviewReason(reason: {
	code: ReviewReasonCode;
	field?: string | undefined;
}): boolean {
	if (
		(INFORMATIONAL_REVIEW_REASON_CODES as readonly string[]).includes(
			reason.code,
		)
	) {
		return false;
	}
	if (
		reason.code === "lowConfidence" &&
		reason.field !== undefined &&
		(INFORMATIONAL_LOW_CONFIDENCE_FIELDS as readonly string[]).includes(
			reason.field,
		)
	) {
		return false;
	}
	return true;
}

export const documentSortSchema = z.enum(DOCUMENT_SORTS);
export type DocumentSort = z.infer<typeof documentSortSchema>;

/** The Postgres `date` columns are handled as `YYYY-MM-DD`. */
const dateOnly = dateOnlySchema;

/**
 * Metadata `document.update` records in `document.manual_fields`.
 *
 * These are the fields the ingestion also computes: a date read off the text, a
 * period, a validity, a title rendered from a document type. Everything the
 * pipeline writes is rewritten on the next `document.reprocess` — that is how a
 * document analysed by an older version gets its date fixed — *except* what a
 * human touched. A field is added here the moment `document.update` sets it,
 * and never leaves.
 *
 * `sensitive`, `asn` and `physicalLocation` are absent on purpose: no automatic
 * pass ever overwrites them, so marking them would say nothing.
 */
export const MANUAL_DOCUMENT_FIELDS = [
	"title",
	"documentDate",
	"datePrecision",
	"periodStart",
	"periodEnd",
	"validUntil",
] as const;
export type ManualDocumentField = (typeof MANUAL_DOCUMENT_FIELDS)[number];

/** `true` when the field is one the pipeline must leave alone. */
export function isManualField(
	manualFields: readonly string[],
	field: ManualDocumentField,
): boolean {
	return manualFields.includes(field);
}

/** Longest note a document can carry, in characters. */
export const NOTES_MAX_LENGTH = 20_000;

export const updateDocumentInput = z.object({
	title: z.string().trim().min(1).max(500).optional(),
	/** Free text, light Markdown; `null` (or an empty string) clears it. */
	notes: z.string().max(NOTES_MAX_LENGTH).nullish(),
	documentDate: dateOnly.nullish(),
	datePrecision: datePrecisionSchema.nullish(),
	periodStart: dateOnly.nullish(),
	periodEnd: dateOnly.nullish(),
	receivedAt: dateOnly.nullish(),
	validFrom: dateOnly.nullish(),
	validUntil: dateOnly.nullish(),
	sensitive: z.boolean().optional(),
	asn: z.int().positive().nullish(),
	physicalLocation: z.string().trim().max(200).nullish(),
	status: documentStatusSchema.optional(),
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentInput>;

/** Trash scope for `document.list`. */
export const DOCUMENT_DELETED_SCOPES = ["exclude", "only", "include"] as const;
export const documentDeletedScopeSchema = z.enum(DOCUMENT_DELETED_SCOPES);
export type DocumentDeletedScope = z.infer<typeof documentDeletedScopeSchema>;

export const listDocumentsInput = z.object({
	/**
	 * French full-text search (`websearch_to_tsquery`) over the title, the OCR
	 * text and the notes.
	 */
	query: z.string().trim().min(1).optional(),
	status: documentStatusSchema.optional(),
	partyId: z.string().min(1).optional(),
	sensitive: z.boolean().optional(),
	/** Calendar year of `documentDate`. */
	year: z.int().min(1000).max(9999).optional(),
	/** Inclusive bounds on `documentDate`. */
	dateFrom: dateOnly.optional(),
	dateTo: dateOnly.optional(),
	/** Inclusive bounds on `validUntil` (due dates, expiring documents). */
	validUntilFrom: dateOnly.optional(),
	validUntilTo: dateOnly.optional(),
	/** Documents attached to this Dossier. */
	dossierId: z.string().min(1).optional(),
	/** Documents carrying this document type (overrides included). */
	documentTypeId: z.string().min(1).optional(),
	/** `true`: documents linked to at least one other; `false`: no link. */
	hasRelation: z.boolean().optional(),
	/** Physical filing place, case-insensitive "contains". */
	physicalLocation: z.string().trim().min(1).max(200).optional(),
	/** `true`: documents carrying an ASN; `false`: those still without one. */
	hasAsn: z.boolean().optional(),
	/** Category and all its sub-categories. */
	categoryId: z.string().min(1).optional(),
	/** Every listed tag must be present on the document. */
	tagIds: z.array(z.string().min(1)).optional(),
	/** Filters on custom field values (combined with "and"). */
	fieldFilters: z.array(documentFieldFilterSchema).optional(),
	/** `exclude` (default) ignores the trash, `only` shows only it. */
	deleted: documentDeletedScopeSchema.default("exclude"),
	page: z.int().min(1).default(1),
	pageSize: z.int().min(1).max(100).default(25),
	sort: documentSortSchema.default("documentDate:desc"),
});
export type ListDocumentsInput = z.infer<typeof listDocumentsInput>;

/** Simplified hOCR: a word with its bbox and confidence, in page pixels. */
export const ocrWordSchema = z.object({
	text: z.string(),
	x0: z.number(),
	y0: z.number(),
	x1: z.number(),
	y1: z.number(),
	conf: z.number(),
});
export type OcrWord = z.infer<typeof ocrWordSchema>;

export const ocrPageSchema = z.object({
	width: z.number().positive(),
	height: z.number().positive(),
	/**
	 * Resolution the coordinates are expressed in: 72 for a PDF text layer
	 * (points), the render resolution for a page that went through OCR.
	 * Optional, because layouts stored before it was surfaced have none.
	 */
	dpi: z.number().positive().optional(),
	words: z.array(ocrWordSchema),
});
export type OcrPage = z.infer<typeof ocrPageSchema>;

export const ocrLayoutSchema = z.object({
	pages: z.array(ocrPageSchema),
});
export type OcrLayout = z.infer<typeof ocrLayoutSchema>;

/** Party linked to a document, as exposed in lists and in the detail. */
export const documentPartyLinkSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: partyTypeSchema,
	role: documentPartyRoleSchema,
	logoKey: z.string().nullable(),
	source: assignmentSourceSchema,
	confidence: z.number().nullable(),
});
export type DocumentPartyLink = z.infer<typeof documentPartyLinkSchema>;

/**
 * Compact view of the document type carried by a list row.
 *
 * Both this schema and {@link documentTypeMembershipSchema} live here rather
 * than in `document-type.ts`: that module needs the rule condition tree, which
 * itself imports this file, and Zod schemas are evaluated at import time.
 * `@docstore/shared/document-type` re-exports them.
 */
export const documentTypeSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string().nullable(),
});
export type DocumentTypeSummary = z.infer<typeof documentTypeSummarySchema>;

/** The document type of a document, with how the document belongs to it. */
export const documentTypeMembershipSchema = z.object({
	id: z.string(),
	name: z.string(),
	icon: z.string().nullable(),
	color: z.string().nullable(),
	source: assignmentSourceSchema,
	confidence: z.number().nullable(),
	layout: z
		.object({ id: z.string(), name: z.string(), isDefault: z.boolean() })
		.nullable(),
	/** Key of the period the document falls into, for a recurring type. */
	period: z.string().nullable(),
	membership: membershipKindSchema,
});
export type DocumentTypeMembership = z.infer<
	typeof documentTypeMembershipSchema
>;

/** List row: just what the table/grid view needs. */
export const documentListItemSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: documentStatusSchema,
	documentDate: z.string().nullable(),
	datePrecision: datePrecisionSchema.nullable(),
	sensitive: z.boolean(),
	createdAt: z.date(),
	deletedAt: z.date().nullable(),
	parties: z.array(documentPartyLinkSchema),
	category: categorySummarySchema.nullable(),
	tags: z.array(tagSummarySchema),
	documentType: documentTypeSummarySchema.nullable(),
	/**
	 * Id of the file the thumbnail belongs to: the `original` file, otherwise
	 * the oldest one. Feed it to `file.thumbnail` (`GET
	 * /files/{fileId}/thumbnail`) to render the preview.
	 */
	thumbnailFileId: z.string().nullable(),
	/**
	 * Storage key of that same thumbnail. Kept for compatibility; prefer
	 * `thumbnailFileId`, which is what the download routes take.
	 */
	thumbnailKey: z.string().nullable(),
	pageCount: z.int().nullable(),
});
export type DocumentListItem = z.infer<typeof documentListItemSchema>;

/** File of a document, without `ocrLayout` (see `document.getFileLayout`). */
export const documentFileSchema = z.object({
	id: z.string(),
	documentId: z.string(),
	kind: documentFileKindSchema,
	filename: z.string(),
	mime: z.string(),
	size: z.number(),
	sha256: z.string(),
	storageKey: z.string(),
	pageCount: z.int().nullable(),
	encrypted: z.boolean(),
	thumbnailKey: z.string().nullable(),
	createdAt: z.date(),
});
export type DocumentFileDto = z.infer<typeof documentFileSchema>;

export const documentSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: documentStatusSchema,
	documentDate: z.string().nullable(),
	datePrecision: datePrecisionSchema.nullable(),
	/** How `documentDate` was obtained; `null` while the document has none. */
	dateSource: dateSourceSchema.nullable(),
	/** 0–1 confidence of an automatic date; `null` when a human set it. */
	dateConfidence: z.number().nullable(),
	periodStart: z.string().nullable(),
	periodEnd: z.string().nullable(),
	receivedAt: z.string().nullable(),
	validFrom: z.string().nullable(),
	validUntil: z.string().nullable(),
	sensitive: z.boolean(),
	asn: z.int().nullable(),
	/** `auto` when the numbering handed it out instead of a human. */
	asnSource: asnSourceSchema,
	physicalLocation: z.string().nullable(),
	content: z.string().nullable(),
	/** Free-text notes typed by a human, in light Markdown. */
	notes: z.string().nullable(),
	categoryId: z.string().nullable(),
	/**
	 * Fields a human set by hand (see {@link MANUAL_DOCUMENT_FIELDS}): the
	 * ingestion never overwrites them, whatever it reads in the document.
	 */
	manualFields: z.array(z.string()),
	/** Intake channel (web upload, mail, watched folder…). */
	source: documentSourceSchema,
	/** Reasons for entering the review queue; empty when all is well. */
	reviewReasons: z.array(reviewReasonSchema),
	/** Last error of the ingestion pipeline (null when all went well). */
	processingError: z.string().nullable(),
	createdById: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	deletedAt: z.date().nullable(),
});
export type DocumentDto = z.infer<typeof documentSchema>;

/** Value of a custom field on a document, with its definition. */
export const documentFieldValueSchema = z.object({
	fieldId: z.string(),
	value: customFieldValueSchema,
	confidence: z.number().nullable(),
	source: assignmentSourceSchema,
	updatedAt: z.date(),
	field: customFieldSchema,
});
export type DocumentFieldValue = z.infer<typeof documentFieldValueSchema>;

/** Summary of the other document at the end of a relation. */
export const relatedDocumentSchema = z.object({
	id: z.string(),
	title: z.string(),
	documentDate: z.string().nullable(),
	datePrecision: datePrecisionSchema.nullable(),
});
export type RelatedDocument = z.infer<typeof relatedDocumentSchema>;

/**
 * Relation seen from the document being viewed: `outgoing` when it is the
 * source (`fromDocumentId`), `incoming` when it is the target.
 */
export const documentRelationLinkSchema = z.object({
	id: z.string(),
	kind: documentRelationKindSchema,
	direction: relationDirectionSchema,
	document: relatedDocumentSchema,
	createdAt: z.date(),
});
export type DocumentRelationLink = z.infer<typeof documentRelationLinkSchema>;

export const documentDetailSchema = documentSchema.extend({
	files: z.array(documentFileSchema),
	parties: z.array(documentPartyLinkSchema),
	category: categorySummarySchema.nullable(),
	tags: z.array(tagSummarySchema),
	fieldValues: z.array(documentFieldValueSchema),
	relations: z.array(documentRelationLinkSchema),
	dossiers: z.array(dossierSummarySchema),
	/** Document type carried by the document, `null` when it has none. */
	documentType: documentTypeMembershipSchema.nullable(),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;

export const setDocumentCategoryInput = z.object({
	id: z.string().min(1),
	categoryId: z.string().min(1).nullable(),
});
export type SetDocumentCategoryInput = z.infer<typeof setDocumentCategoryInput>;

export const setDocumentTagsInput = z.object({
	id: z.string().min(1),
	tagIds: z.array(z.string().min(1)),
});
export type SetDocumentTagsInput = z.infer<typeof setDocumentTagsInput>;

export const documentTagInput = z.object({
	id: z.string().min(1),
	tagId: z.string().min(1),
});
export type DocumentTagInput = z.infer<typeof documentTagInput>;

export const setDocumentFieldValueInput = z.object({
	id: z.string().min(1),
	fieldId: z.string().min(1),
	value: customFieldValueSchema,
	/**
	 * `rule` when the caller applies the result of a tested extraction rule
	 * (SPEC §9): the value is then stored with its confidence, exactly like an
	 * automatic run. Manual entry stays the default.
	 */
	source: z.enum(["manual", "rule"]).default("manual"),
	confidence: z.number().min(0).max(1).nullish(),
});
export type SetDocumentFieldValueInput = z.infer<
	typeof setDocumentFieldValueInput
>;

export const clearDocumentFieldValueInput = z.object({
	id: z.string().min(1),
	fieldId: z.string().min(1),
});
export type ClearDocumentFieldValueInput = z.infer<
	typeof clearDocumentFieldValueInput
>;

/** Actions applicable in bulk to a selection of documents. */
export const documentBulkActionSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("setCategory"),
		categoryId: z.string().min(1).nullable(),
	}),
	z.object({
		type: z.literal("addTags"),
		tagIds: z.array(z.string().min(1)).min(1),
	}),
	z.object({
		type: z.literal("removeTags"),
		tagIds: z.array(z.string().min(1)).min(1),
	}),
	z.object({ type: z.literal("setSensitive"), sensitive: z.boolean() }),
	/**
	 * Rewrites the title of each document from the title template of the type it
	 * carries. Documents without a type, or whose type has no template, are left
	 * alone, as are titles set by hand.
	 */
	z.object({ type: z.literal("regenerateTitle") }),
	z.object({ type: z.literal("trash") }),
	z.object({ type: z.literal("restore") }),
	z.object({
		type: z.literal("addParty"),
		partyId: z.string().min(1),
		role: documentPartyRoleSchema,
	}),
	/** Applies a document type to the selection (category, parties, tags…). */
	z.object({
		type: z.literal("setDocumentType"),
		documentTypeId: z.string().min(1).nullable(),
		layoutId: z.string().min(1).nullish(),
	}),
]);
export type DocumentBulkAction = z.infer<typeof documentBulkActionSchema>;

export const documentBulkInput = z.object({
	ids: z.array(z.string().min(1)).min(1).max(500),
	action: documentBulkActionSchema,
});
export type DocumentBulkInput = z.infer<typeof documentBulkInput>;

export const documentBulkResultSchema = z.object({
	updated: z.int().min(0),
});
export type DocumentBulkResult = z.infer<typeof documentBulkResultSchema>;

/** Reason why two documents are considered duplicates. */
export const DUPLICATE_REASONS = [
	"sameOriginalHash",
	"sameTitleAndDate",
] as const;
export const duplicateReasonSchema = z.enum(DUPLICATE_REASONS);
export type DuplicateReason = z.infer<typeof duplicateReasonSchema>;

export const documentDuplicateSchema = z.object({
	documentId: z.string(),
	title: z.string(),
	documentDate: z.string().nullable(),
	datePrecision: datePrecisionSchema.nullable(),
	thumbnailFileId: z.string().nullable(),
	duplicateOfId: z.string(),
	duplicateOfTitle: z.string(),
	duplicateOfDate: z.string().nullable(),
	duplicateOfDatePrecision: datePrecisionSchema.nullable(),
	duplicateOfThumbnailFileId: z.string().nullable(),
	reason: duplicateReasonSchema,
	/** `true` when this pair was dismissed through `document.ignoreDuplicate`. */
	ignored: z.boolean(),
});
export type DocumentDuplicate = z.infer<typeof documentDuplicateSchema>;

export const listDocumentDuplicatesInput = z.object({
	/** `false` (default) hides pairs dismissed through `ignoreDuplicate`. */
	includeIgnored: z.boolean().default(false),
});
export type ListDocumentDuplicatesInput = z.infer<
	typeof listDocumentDuplicatesInput
>;

export const ignoreDuplicateInput = z.object({
	documentId: z.string().min(1),
	otherDocumentId: z.string().min(1),
});
export type IgnoreDuplicateInput = z.infer<typeof ignoreDuplicateInput>;

/** Ids come back normalized (`documentId < otherDocumentId`), as stored. */
export const duplicateIgnoreResultSchema = z.object({
	documentId: z.string(),
	otherDocumentId: z.string(),
	ignored: z.boolean(),
});
export type DuplicateIgnoreResult = z.infer<typeof duplicateIgnoreResultSchema>;

export const documentFileLayoutSchema = z.object({
	fileId: z.string(),
	documentId: z.string(),
	pageCount: z.int().nullable(),
	ocrLayout: ocrLayoutSchema.nullable(),
});
export type DocumentFileLayout = z.infer<typeof documentFileLayoutSchema>;

export const documentPartyAssignmentSchema = z.object({
	partyId: z.string().min(1),
	role: documentPartyRoleSchema,
});
export type DocumentPartyAssignment = z.infer<
	typeof documentPartyAssignmentSchema
>;

export const setDocumentPartiesInput = z.object({
	id: z.string().min(1),
	parties: z.array(documentPartyAssignmentSchema),
});
export type SetDocumentPartiesInput = z.infer<typeof setDocumentPartiesInput>;

export const documentStatsSchema = z.object({
	total: z.int().min(0),
	byStatus: z.record(documentStatusSchema, z.int().min(0)),
	review: z.int().min(0),
	/** Disk usage, all files taken together (trash included). */
	storage: z.object({
		bytes: z.int().min(0),
		files: z.int().min(0),
	}),
	/** Non-deleted documents whose `validUntil` falls within 30 days. */
	expiringSoon: z.int().min(0),
	/** Non-archived parties. */
	parties: z.int().min(0),
});
export type DocumentStats = z.infer<typeof documentStatsSchema>;

/**
 * Physical archiving (SPEC §2 "Document"): the ASN is the number written on
 * the paper folder, so it must be handed out without a gap and without a
 * duplicate.
 */
export const nextAsnResultSchema = z.object({
	/** Next free number: `max(asn) + 1`, therefore `1` on an empty store. */
	next: z.int().positive(),
});
export type NextAsnResult = z.infer<typeof nextAsnResultSchema>;

export const documentByAsnInput = z.object({ asn: z.int().positive() });
export type DocumentByAsnInput = z.infer<typeof documentByAsnInput>;

/** Result of `document.mergeAsVersion` (duplicate resolution). */
export const mergeAsVersionResultSchema = z.object({
	/** Document kept, reloaded after the merge. */
	target: documentDetailSchema,
	/** Document absorbed, now in the trash. */
	trashedId: z.string(),
	movedFiles: z.int().min(0),
});
export type MergeAsVersionResult = z.infer<typeof mergeAsVersionResultSchema>;
