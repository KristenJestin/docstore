import { z } from "zod";
import { dateOnlySchema, iconNameSchema } from "./common";
import { extractionResultSchema } from "./extraction";
import {
	periodicitySchema,
	recurrencePeriodSchema,
	recurrenceRangeSchema,
	recurrenceStatsSchema,
} from "./recurrence";
import { ruleConditionSchema } from "./rule";

/**
 * Both schemas live in `./document` (they are part of the document DTOs, and
 * this module cannot be imported from there without a cycle) and are re-exported
 * here so that consumers only need one import path.
 */
export {
	type DocumentTypeMembership,
	type DocumentTypeSummary,
	documentTypeMembershipSchema,
	documentTypeSummarySchema,
} from "./document";

/**
 * Document types (SPEC §9).
 *
 * A document type is "the same document we keep receiving": identity
 * (category, issuer, subject, tags, title template), optional recurrence
 * (the former Series), layouts carrying the extraction rules, and an optional
 * detection condition reusing the rule engine's condition tree.
 */

const dateOnly = dateOnlySchema;

/** Default confidence of a type matched by its detection condition. */
export const DEFAULT_DETECTION_CONFIDENCE = 0.9;

/**
 * Minimum average extraction confidence for a layout to be selected by trial
 * when neither its signature nor its date range decided.
 */
export const LAYOUT_TRIAL_THRESHOLD = 0.5;

/** Number of distinctive tokens seeded into a layout signature. */
export const LAYOUT_SIGNATURE_TOKENS = 5;

/**
 * Title template a **new recurring** type starts with (see the "Titles"
 * section of `docs/document-types.md`). A one-off type keeps an empty
 * template: its documents keep the title they arrived with.
 */
export const DEFAULT_RECURRING_TITLE_TEMPLATE = "{type} {period:MMMM yyyy}";

/* ------------------------------------------------------------------ */
/* DTOs                                                                 */
/* ------------------------------------------------------------------ */

export const documentTypeSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	icon: z.string().nullable(),
	color: z.string().nullable(),
	categoryId: z.string().nullable(),
	issuerPartyId: z.string().nullable(),
	subjectPartyId: z.string().nullable(),
	tagIds: z.array(z.string()),
	sensitiveDefault: z.boolean(),
	/** Applying the type hands the document an archive serial number. */
	paperOriginal: z.boolean(),
	titleTemplate: z.string().nullable(),
	/** Same condition tree as the rules; `null` = never detected automatically. */
	detection: ruleConditionSchema.nullable(),
	detectionConfidence: z.number().min(0).max(1),
	enabled: z.boolean(),
	priority: z.int(),
	/**
	 * `Any <Category>`: holds the extraction rules of a category that has no
	 * type of its own. Never detected, never assigned to a document.
	 */
	generic: z.boolean(),
	/** `null` = the type is not recurring. */
	periodicity: periodicitySchema.nullable(),
	/** `null` = the recurrence starts at the oldest document of the type. */
	startPeriod: z.string().nullable(),
	endPeriod: z.string().nullable(),
	expectedDay: z.int().nullable(),
	graceDays: z.int().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type DocumentTypeDto = z.infer<typeof documentTypeSchema>;

export const documentTypeLayoutSchema = z.object({
	id: z.string(),
	documentTypeId: z.string(),
	name: z.string(),
	/** The layout created with the type: fallback, and never left alone. */
	isDefault: z.boolean(),
	validFrom: z.string().nullable(),
	validUntil: z.string().nullable(),
	/** Condition tree identifying the layout; `null` = no signature. */
	signature: ruleConditionSchema.nullable(),
	sortOrder: z.int(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type DocumentTypeLayoutDto = z.infer<typeof documentTypeLayoutSchema>;

/** Party named by a document type (issuer or subject), enough to render an avatar. */
export const documentTypePartyRefSchema = z.object({
	id: z.string(),
	name: z.string(),
	logoKey: z.string().nullable(),
});
export type DocumentTypePartyRef = z.infer<typeof documentTypePartyRefSchema>;

/**
 * Sibling layout whose validity window meets the one just saved. Two layouts
 * covering the same day are both eligible on a document dated there, and only
 * `sortOrder` decides — which is a coin toss nobody meant to make.
 */
export const layoutOverlapSchema = z.object({
	id: z.string(),
	name: z.string(),
	/** Bounds of the shared window; `null` = open on that side. */
	from: z.string().nullable(),
	until: z.string().nullable(),
});
export type LayoutOverlap = z.infer<typeof layoutOverlapSchema>;

/**
 * A layout as `addLayout`/`updateLayout` hand it back: the row, plus what it
 * now collides with. Purely informational — the write always goes through.
 */
export const savedDocumentTypeLayoutSchema = documentTypeLayoutSchema.extend({
	overlaps: z.array(layoutOverlapSchema),
});
export type SavedDocumentTypeLayout = z.infer<
	typeof savedDocumentTypeLayoutSchema
>;

export const documentTypeItemSchema = documentTypeSchema.extend({
	categoryName: z.string().nullable(),
	/** @deprecated Use `issuer.name`; kept for compatibility. */
	issuerName: z.string().nullable(),
	/** @deprecated Use `subject.name`; kept for compatibility. */
	subjectName: z.string().nullable(),
	issuer: documentTypePartyRefSchema.nullable(),
	subject: documentTypePartyRefSchema.nullable(),
	layoutCount: z.int().min(0),
	/** Documents carrying this type. */
	documentCount: z.int().min(0),
	/** Only computed for a recurring type. */
	stats: recurrenceStatsSchema.nullable(),
	/**
	 * Periods actually covered, missing bounds filled in from the member
	 * documents. `null` for a one-off type, and for a recurrence with neither an
	 * explicit `startPeriod` nor a single member.
	 */
	range: recurrenceRangeSchema.nullable(),
});
export type DocumentTypeItem = z.infer<typeof documentTypeItemSchema>;

/**
 * Member whose period falls before an **explicit** `startPeriod`: the document
 * belongs to the type but the recurrence does not cover it, so it appears
 * nowhere on the timeline. Surfaced so the user can widen `startPeriod` (or
 * exclude it). Without an explicit start nothing is ever out of range — the
 * effective range simply extends down to the oldest document.
 */
export const documentTypeOutOfRangeSchema = z.object({
	documentId: z.string(),
	title: z.string(),
	/** Readable key of the period (`2024-03`, `2024-Q1`, `2024`). */
	period: z.string(),
	/** First day of that period (`YYYY-MM-DD`). */
	periodStart: z.string(),
});
export type DocumentTypeOutOfRange = z.infer<
	typeof documentTypeOutOfRangeSchema
>;

export const documentTypeDetailSchema = documentTypeItemSchema.extend({
	layouts: z.array(documentTypeLayoutSchema),
	/** Period-by-period timeline; empty for a non-recurring type. */
	timeline: z.array(recurrencePeriodSchema),
	/** Documents counted as members of the recurrence (overrides included). */
	memberCount: z.int().min(0),
	/** Members older than an explicit `startPeriod`; empty otherwise. */
	outOfRange: z.array(documentTypeOutOfRangeSchema),
});
export type DocumentTypeDetail = z.infer<typeof documentTypeDetailSchema>;

/* ------------------------------------------------------------------ */
/* CRUD inputs                                                          */
/* ------------------------------------------------------------------ */

export const listDocumentTypesInput = z.object({
	/** Case-insensitive match on the name. */
	query: z.string().trim().min(1).optional(),
	/** Only the types carrying a recurrence (the former Series page). */
	recurringOnly: z.boolean().default(false),
	includeDisabled: z.boolean().default(true),
});
export type ListDocumentTypesInput = z.infer<typeof listDocumentTypesInput>;

/** Recurrence block, shared by `create` and `createFromDocument`. */
export const recurrenceInput = z.object({
	periodicity: periodicitySchema,
	/**
	 * Snapped to the first day of its period. Left empty, the recurrence starts
	 * at the oldest document of the type, and follows it as older ones arrive.
	 */
	startPeriod: dateOnly.nullish(),
	endPeriod: dateOnly.nullish(),
	expectedDay: z.int().min(1).max(31).nullish(),
	graceDays: z.int().min(0).max(365).optional(),
});
export type RecurrenceInput = z.infer<typeof recurrenceInput>;

export const createDocumentTypeInput = z.object({
	name: z.string().trim().min(1).max(200),
	description: z.string().trim().max(2000).nullish(),
	icon: iconNameSchema.nullish(),
	color: z.string().trim().max(30).nullish(),
	categoryId: z.string().min(1).nullish(),
	issuerPartyId: z.string().min(1).nullish(),
	subjectPartyId: z.string().min(1).nullish(),
	tagIds: z.array(z.string().min(1)).default([]),
	sensitiveDefault: z.boolean().default(false),
	/** Numbers every document this type is applied to (SPEC §2). */
	paperOriginal: z.boolean().default(false),
	titleTemplate: z.string().trim().max(300).nullish(),
	detection: ruleConditionSchema.nullish(),
	detectionConfidence: z.number().min(0).max(1).optional(),
	enabled: z.boolean().optional(),
	priority: z.int().min(0).max(10_000).optional(),
	/** `null` (or absent) = no recurrence. */
	recurrence: recurrenceInput.nullish(),
});
export type CreateDocumentTypeInput = z.infer<typeof createDocumentTypeInput>;

export const updateDocumentTypeInput = createDocumentTypeInput
	.partial()
	.extend({ id: z.string().min(1) });
export type UpdateDocumentTypeInput = z.infer<typeof updateDocumentTypeInput>;

export const deleteDocumentTypeInput = z.object({
	id: z.string().min(1),
	/**
	 * `true` clears `documentTypeId` on the documents carrying it (the default:
	 * the foreign key already sets it to null, this only makes the intent
	 * explicit and also clears the layout and the assignment metadata).
	 */
	detachDocuments: z.boolean().default(true),
});
export type DeleteDocumentTypeInput = z.infer<typeof deleteDocumentTypeInput>;

export const toggleDocumentTypeInput = z.object({
	id: z.string().min(1),
	enabled: z.boolean(),
});
export type ToggleDocumentTypeInput = z.infer<typeof toggleDocumentTypeInput>;

export const reorderDocumentTypesInput = z.object({
	/** The array order becomes the priority (0, 1, 2…). */
	ids: z.array(z.string().min(1)).min(1),
});
export type ReorderDocumentTypesInput = z.infer<
	typeof reorderDocumentTypesInput
>;

export const ensureGenericDocumentTypeInput = z.object({
	categoryId: z.string().min(1),
});
export type EnsureGenericDocumentTypeInput = z.infer<
	typeof ensureGenericDocumentTypeInput
>;

export const createDocumentTypeFromDocumentInput = z.object({
	documentId: z.string().min(1),
	/** Defaults to `<Issuer> — <Category>`, else the document title. */
	name: z.string().trim().min(1).max(200).optional(),
	recurrence: recurrenceInput.nullish(),
});
export type CreateDocumentTypeFromDocumentInput = z.infer<
	typeof createDocumentTypeFromDocumentInput
>;

export const setDocumentTypeOverrideInput = z.object({
	documentTypeId: z.string().min(1),
	documentId: z.string().min(1),
	/**
	 * `true` forces membership, `false` excludes it, `null` removes the override
	 * and hands the document back to the computed membership.
	 */
	included: z.boolean().nullable(),
});
export type SetDocumentTypeOverrideInput = z.infer<
	typeof setDocumentTypeOverrideInput
>;

/* ------------------------------------------------------------------ */
/* Suggestions                                                          */
/* ------------------------------------------------------------------ */

export const documentTypeSuggestionSchema = z.object({
	partyId: z.string(),
	partyName: z.string(),
	partyLogoKey: z.string().nullable(),
	categoryId: z.string(),
	categoryName: z.string(),
	periodicity: periodicitySchema,
	/** First day of the period of the earliest observed document. */
	startPeriod: z.string(),
	/** First day of the period of the latest observed document. */
	endPeriod: z.string(),
	/** Number of distinct monthly periods observed. */
	sampleCount: z.int().min(0),
	/** Documents behind the suggestion, oldest first. */
	documentIds: z.array(z.string()),
});
export type DocumentTypeSuggestion = z.infer<
	typeof documentTypeSuggestionSchema
>;

/** Turns a {@link DocumentTypeSuggestion} into a real document type. */
export const createDocumentTypeFromSuggestionInput = z.object({
	partyId: z.string().min(1),
	categoryId: z.string().min(1),
	periodicity: periodicitySchema,
	/** Left empty, the range is read from the documents behind the suggestion. */
	startPeriod: dateOnly.nullish(),
	endPeriod: dateOnly.nullish(),
	/** Defaults to `<Party> — <Category>`. */
	name: z.string().trim().min(1).max(200).optional(),
});
export type CreateDocumentTypeFromSuggestionInput = z.infer<
	typeof createDocumentTypeFromSuggestionInput
>;

/** Default name of a document type created from a suggestion. */
export function suggestedDocumentTypeName(
	partyName: string,
	categoryName: string,
): string {
	return `${partyName} — ${categoryName}`;
}

/**
 * `true` when a document type with these criteria covers the issuer + category
 * couple. A `null` criterion is a wildcard: the type then matches every Party
 * (resp. every category).
 */
export function documentTypeCoversCouple(
	criteria: { issuerPartyId: string | null; categoryId: string | null },
	partyId: string,
	categoryId: string,
): boolean {
	return (
		(criteria.issuerPartyId === null || criteria.issuerPartyId === partyId) &&
		(criteria.categoryId === null || criteria.categoryId === categoryId)
	);
}

/* ------------------------------------------------------------------ */
/* Titles                                                               */
/* ------------------------------------------------------------------ */

export const previewDocumentTypeTitlesInput = z.object({
	id: z.string().min(1),
	limit: z.int().min(1).max(50).default(5),
});
export type PreviewDocumentTypeTitlesInput = z.infer<
	typeof previewDocumentTypeTitlesInput
>;

export const documentTypeTitlePreviewSchema = z.object({
	documentId: z.string(),
	currentTitle: z.string(),
	/** `null` when the template renders nothing for this document. */
	title: z.string().nullable(),
	/** `true` when the title was set by hand: kept unless `overwriteManual`. */
	manual: z.boolean(),
});
export type DocumentTypeTitlePreview = z.infer<
	typeof documentTypeTitlePreviewSchema
>;

export const regenerateDocumentTypeTitlesInput = z.object({
	id: z.string().min(1),
	/** `true` also rewrites the titles someone typed by hand. */
	overwriteManual: z.boolean().default(false),
});
export type RegenerateDocumentTypeTitlesInput = z.infer<
	typeof regenerateDocumentTypeTitlesInput
>;

export const regenerateTitlesResultSchema = z.object({
	/** Documents whose title was actually rewritten. */
	updated: z.int().min(0),
	/** Titles left alone: manual, unchanged, or rendered empty. */
	skipped: z.int().min(0),
});
export type RegenerateTitlesResult = z.infer<
	typeof regenerateTitlesResultSchema
>;

/* ------------------------------------------------------------------ */
/* Layouts                                                              */
/* ------------------------------------------------------------------ */

export const addDocumentTypeLayoutInput = z.object({
	documentTypeId: z.string().min(1),
	name: z.string().trim().min(1).max(200),
	validFrom: dateOnly.nullish(),
	validUntil: dateOnly.nullish(),
	signature: ruleConditionSchema.nullish(),
});
export type AddDocumentTypeLayoutInput = z.infer<
	typeof addDocumentTypeLayoutInput
>;

export const updateDocumentTypeLayoutInput = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(200).optional(),
	validFrom: dateOnly.nullish(),
	validUntil: dateOnly.nullish(),
	signature: ruleConditionSchema.nullish(),
});
export type UpdateDocumentTypeLayoutInput = z.infer<
	typeof updateDocumentTypeLayoutInput
>;

export const removeDocumentTypeLayoutInput = z.object({
	id: z.string().min(1),
});
export type RemoveDocumentTypeLayoutInput = z.infer<
	typeof removeDocumentTypeLayoutInput
>;

export const setDefaultDocumentTypeLayoutInput = z.object({
	/** Layout that becomes the fallback of its type; the other one is demoted. */
	id: z.string().min(1),
});
export type SetDefaultDocumentTypeLayoutInput = z.infer<
	typeof setDefaultDocumentTypeLayoutInput
>;

export const reorderDocumentTypeLayoutsInput = z.object({
	documentTypeId: z.string().min(1),
	/** The array order becomes `sortOrder` (0, 1, 2…). */
	ids: z.array(z.string().min(1)).min(1),
});
export type ReorderDocumentTypeLayoutsInput = z.infer<
	typeof reorderDocumentTypeLayoutsInput
>;

export const createLayoutFromDocumentInput = z.object({
	documentTypeId: z.string().min(1),
	documentId: z.string().min(1),
	name: z.string().trim().min(1).max(200),
});
export type CreateLayoutFromDocumentInput = z.infer<
	typeof createLayoutFromDocumentInput
>;

export const testDocumentTypeLayoutInput = z.object({
	layoutId: z.string().min(1),
	documentId: z.string().min(1),
});
export type TestDocumentTypeLayoutInput = z.infer<
	typeof testDocumentTypeLayoutInput
>;

export const layoutFieldResultSchema = extractionResultSchema.extend({
	extractionRuleId: z.string(),
	extractionRuleName: z.string(),
	/** `field`, `document_date`, `period`, `valid_until` or `title`. */
	targetKind: z.string(),
	fieldId: z.string().nullable(),
});
export type LayoutFieldResult = z.infer<typeof layoutFieldResultSchema>;

export const testDocumentTypeLayoutResultSchema = z.object({
	layoutId: z.string(),
	layoutName: z.string(),
	results: z.array(layoutFieldResultSchema),
	/** Mean confidence over the rules that produced a value; `0` without any. */
	averageConfidence: z.number().min(0).max(1),
	/** `true` when the signature of the layout matches the document. */
	signatureMatched: z.boolean().nullable(),
});
export type TestDocumentTypeLayoutResult = z.infer<
	typeof testDocumentTypeLayoutResultSchema
>;

/* ------------------------------------------------------------------ */
/* Apply / detect / preview                                             */
/* ------------------------------------------------------------------ */

export const applyDocumentTypeInput = z.object({
	documentTypeId: z.string().min(1),
	documentIds: z.array(z.string().min(1)).min(1).max(500),
	/** Forces a layout instead of letting the selection decide. */
	layoutId: z.string().min(1).nullish(),
	/** Applies the type even when it is disabled. */
	force: z.boolean().default(false),
});
export type ApplyDocumentTypeInput = z.infer<typeof applyDocumentTypeInput>;

/** Why a layout was picked. */
export const LAYOUT_SELECTION_REASONS = [
	"forced",
	"signature",
	"dateRange",
	"bestConfidence",
	"only",
	/** Nothing else matched: the default layout of the type took over. */
	"default",
	"none",
] as const;
export const layoutSelectionReasonSchema = z.enum(LAYOUT_SELECTION_REASONS);
export type LayoutSelectionReason = z.infer<typeof layoutSelectionReasonSchema>;

export const applyDocumentTypeResultItemSchema = z.object({
	documentId: z.string(),
	applied: z.boolean(),
	layoutId: z.string().nullable(),
	layoutReason: layoutSelectionReasonSchema,
	/** Custom fields (and dates) written by the extraction rules. */
	fieldsWritten: z.int().min(0),
	/** Set when `applied` is false. */
	error: z.string().nullable(),
});
export type ApplyDocumentTypeResultItem = z.infer<
	typeof applyDocumentTypeResultItemSchema
>;

export const applyDocumentTypeResultSchema = z.object({
	applied: z.int().min(0),
	results: z.array(applyDocumentTypeResultItemSchema),
});
export type ApplyDocumentTypeResult = z.infer<
	typeof applyDocumentTypeResultSchema
>;

export const detectDocumentTypeInput = z.object({
	documentId: z.string().min(1),
});
export type DetectDocumentTypeInput = z.infer<typeof detectDocumentTypeInput>;

export const documentTypeCandidateSchema = z.object({
	documentTypeId: z.string(),
	name: z.string(),
	confidence: z.number().min(0).max(1),
	layoutId: z.string().nullable(),
	layoutReason: layoutSelectionReasonSchema,
});
export type DocumentTypeCandidate = z.infer<typeof documentTypeCandidateSchema>;

export const detectDocumentTypeResultSchema = z.object({
	candidates: z.array(documentTypeCandidateSchema),
});
export type DetectDocumentTypeResult = z.infer<
	typeof detectDocumentTypeResultSchema
>;

/** Unsaved draft, for `documentType.preview`. */
export const documentTypeDraftSchema = z.object({
	name: z.string().trim().min(1).max(200).default("Draft"),
	categoryId: z.string().min(1).nullish(),
	issuerPartyId: z.string().min(1).nullish(),
	subjectPartyId: z.string().min(1).nullish(),
	tagIds: z.array(z.string().min(1)).default([]),
	sensitiveDefault: z.boolean().default(false),
	titleTemplate: z.string().trim().max(300).nullish(),
});
export type DocumentTypeDraft = z.infer<typeof documentTypeDraftSchema>;

export const previewDocumentTypeInput = z
	.object({
		id: z.string().min(1).optional(),
		draft: documentTypeDraftSchema.optional(),
		documentId: z.string().min(1),
	})
	.refine((input) => Boolean(input.id) !== Boolean(input.draft), {
		message: "Provide either `id` or `draft`, not both.",
	});
export type PreviewDocumentTypeInput = z.infer<typeof previewDocumentTypeInput>;

export const previewDocumentTypeResultSchema = z.object({
	documentTypeId: z.string().nullable(),
	name: z.string(),
	category: z.object({ id: z.string(), name: z.string() }).nullable(),
	parties: z.array(
		z.object({ partyId: z.string(), name: z.string(), role: z.string() }),
	),
	tags: z.array(z.object({ id: z.string(), name: z.string() })),
	/** `null` when the type would not touch the flag. */
	sensitive: z.boolean().nullable(),
	/** `null` when the title of the document would be left as it is. */
	title: z.string().nullable(),
	layout: z
		.object({
			id: z.string(),
			name: z.string(),
			reason: layoutSelectionReasonSchema,
		})
		.nullable(),
	extractions: z.array(layoutFieldResultSchema),
	/** Key of the period the document would fall into, for a recurring type. */
	period: z.string().nullable(),
});
export type PreviewDocumentTypeResult = z.infer<
	typeof previewDocumentTypeResultSchema
>;
