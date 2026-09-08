import { z } from "zod";
import { datePrecisionSchema, ocrWordSchema } from "./document";

/**
 * Data extraction (SPEC §4).
 *
 * An `ExtractionRule` targets a document field and describes *how* to find the
 * value in the text or in the OCR layer. Execution lives in `@docstore/rules`
 * (pure); this file only carries the schemas.
 */

export const EXTRACTION_TARGET_KINDS = [
	"field",
	"document_date",
	"period",
	"valid_until",
	"title",
] as const;
export const extractionTargetKindSchema = z.enum(EXTRACTION_TARGET_KINDS);
export type ExtractionTargetKind = z.infer<typeof extractionTargetKindSchema>;

export const extractionTargetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("field"), fieldId: z.string().min(1) }),
	z.object({ kind: z.literal("document_date") }),
	/**
	 * Covered period. The extracted value bounds it according to its precision:
	 * a day is a single day, a month the whole month, and a bare year
	 * ("2025", or a date with `year` precision) the whole year — a tax notice
	 * prints its year and nothing else.
	 */
	z.object({ kind: z.literal("period") }),
	z.object({ kind: z.literal("valid_until") }),
	z.object({ kind: z.literal("title") }),
]);
export type ExtractionTarget = z.infer<typeof extractionTargetSchema>;

/** Maximum pattern length: a guard against pathological regexes. */
export const MAX_REGEX_LENGTH = 500;

const patternSchema = z.string().min(1).max(MAX_REGEX_LENGTH);
const flagsSchema = z
	.string()
	.max(8)
	.regex(/^[dgimsuvy]*$/)
	.optional();

/** Where to look for the value, relative to the anchor label. */
export const ANCHOR_POSITIONS = [
	"sameLine",
	"nextLine",
	"right",
	"below",
] as const;
export const anchorPositionSchema = z.enum(ANCHOR_POSITIONS);
export type AnchorPosition = z.infer<typeof anchorPositionSchema>;

export const extractionStrategySchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("regex"),
		pattern: patternSchema,
		/** Capture group used (1 by default; 0 = the whole pattern). */
		group: z.int().min(0).max(20).default(1),
		flags: flagsSchema,
	}),
	z.object({
		kind: z.literal("anchor"),
		/** Label regex, searched line by line in the OCR layer. */
		label: patternSchema,
		position: anchorPositionSchema,
		/** Search radius in page pixels (`right` / `below` positions). */
		maxDistancePx: z.number().positive().max(5000).optional(),
		/** Pattern applied to the candidate text to isolate the value. */
		valuePattern: patternSchema.optional(),
		flags: flagsSchema,
	}),
	z.object({
		kind: z.literal("zone"),
		/** Page number, 1 for the first one. */
		page: z.int().min(1).default(1),
		x0: z.number().min(0).max(1),
		y0: z.number().min(0).max(1),
		x1: z.number().min(0).max(1),
		y1: z.number().min(0).max(1),
	}),
]);
export type ExtractionStrategy = z.infer<typeof extractionStrategySchema>;

export const SIMPLE_POSTPROCESS_STEPS = [
	"trim",
	"number_fr",
	"date_fr",
	"month_fr",
	"uppercase",
] as const;
export const simplePostprocessStepSchema = z.enum(SIMPLE_POSTPROCESS_STEPS);
export type SimplePostprocessStep = z.infer<typeof simplePostprocessStepSchema>;

export const postprocessStepSchema = z.union([
	simplePostprocessStepSchema,
	z.object({
		regex_replace: z.object({
			pattern: patternSchema,
			replacement: z.string().max(200),
			flags: flagsSchema,
		}),
	}),
]);
export type PostprocessStep = z.infer<typeof postprocessStepSchema>;

/** Bounding box of a word kept by the extraction. */
export const extractionBoxSchema = ocrWordSchema.extend({
	/** Page index, 0 for the first one. */
	page: z.int().min(0),
});
export type ExtractionBox = z.infer<typeof extractionBoxSchema>;

export const extractionResultSchema = z.object({
	/** Raw text kept before post-processing, `null` when nothing matched. */
	raw: z.string().nullable(),
	/** Value after post-processing (number, `YYYY-MM-DD` date, text…). */
	value: z.unknown(),
	/** 0–1. Weighted by the average OCR confidence of the words used. */
	confidence: z.number().min(0).max(1),
	matchedWords: z.array(extractionBoxSchema).optional(),
	/** Set by `date_fr` / `month_fr`. */
	precision: datePrecisionSchema.optional(),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/* ------------------------------------------------------------------ */
/* DTOs and CRUD inputs                                                 */
/* ------------------------------------------------------------------ */

export const extractionRuleSchema = z.object({
	id: z.string(),
	name: z.string(),
	target: extractionTargetSchema,
	strategy: extractionStrategySchema,
	postprocess: z.array(postprocessStepSchema),
	/**
	 * `true` when the document is unusable without this value: a rule that finds
	 * nothing then blocks the document in Review. Optional by default — a miss
	 * leaves the field empty and only raises the informational `extractionMissed`
	 * reason.
	 */
	required: z.boolean(),
	/**
	 * Layout the rule belongs to. An extraction rule only exists inside a
	 * document type: it runs when its layout is selected, and the type carries
	 * the category.
	 */
	layoutId: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type ExtractionRule = z.infer<typeof extractionRuleSchema>;

export const createExtractionRuleInput = z.object({
	name: z.string().trim().min(1).max(150),
	target: extractionTargetSchema,
	strategy: extractionStrategySchema,
	postprocess: z.array(postprocessStepSchema).default([]),
	/** `true` sends the document to Review when the rule finds nothing. */
	required: z.boolean().default(false),
	/** Required: a rule always belongs to a layout of a document type. */
	layoutId: z.string().min(1),
});
export type CreateExtractionRuleInput = z.infer<
	typeof createExtractionRuleInput
>;

export const updateExtractionRuleInput = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(150).optional(),
	target: extractionTargetSchema.optional(),
	strategy: extractionStrategySchema.optional(),
	postprocess: z.array(postprocessStepSchema).optional(),
	required: z.boolean().optional(),
	/** Moves the rule to another layout (of any type). */
	layoutId: z.string().min(1).optional(),
});
export type UpdateExtractionRuleInput = z.infer<
	typeof updateExtractionRuleInput
>;

/**
 * Lists the extraction rules of one layout, or of every layout of a document
 * type. One of the two is required: there is no standalone rule to list.
 */
export const listExtractionRulesInput = z
	.object({
		layoutId: z.string().min(1).optional(),
		documentTypeId: z.string().min(1).optional(),
	})
	.refine((input) => Boolean(input.layoutId) || Boolean(input.documentTypeId), {
		message: "Provide either `layoutId` or `documentTypeId`.",
	});
export type ListExtractionRulesInput = z.infer<typeof listExtractionRulesInput>;

/** Rules of the layout of a document, for the "Extract" action on a field. */
export const applicableExtractionRulesInput = z.object({
	documentId: z.string().min(1),
});
export type ApplicableExtractionRulesInput = z.infer<
	typeof applicableExtractionRulesInput
>;

export const extractionRuleDraftSchema = z.object({
	name: z.string().trim().min(1).max(150).default("Draft"),
	target: extractionTargetSchema.default({ kind: "title" }),
	strategy: extractionStrategySchema,
	postprocess: z.array(postprocessStepSchema).default([]),
	required: z.boolean().default(false),
});
export type ExtractionRuleDraft = z.infer<typeof extractionRuleDraftSchema>;

export const testExtractionRuleInput = z
	.object({
		extractionRuleId: z.string().min(1).optional(),
		rule: extractionRuleDraftSchema.optional(),
		documentId: z.string().min(1),
		/** Target file; defaults to the original file of the document. */
		fileId: z.string().min(1).optional(),
	})
	.refine((input) => Boolean(input.extractionRuleId) !== Boolean(input.rule), {
		message: "Provide either `extractionRuleId` or `rule` (draft), not both.",
	});
export type TestExtractionRuleInput = z.infer<typeof testExtractionRuleInput>;

/** Line rebuilt from the OCR layer, to help write an anchor. */
export const layoutLineSchema = z.object({
	/** Page index, 0 for the first one. */
	page: z.int().min(0),
	/** Y coordinate of the top of the line, in page pixels. */
	y: z.number(),
	text: z.string(),
});
export type LayoutLine = z.infer<typeof layoutLineSchema>;

export const previewLayoutInput = z.object({
	documentId: z.string().min(1),
	fileId: z.string().min(1).optional(),
});
export type PreviewLayoutInput = z.infer<typeof previewLayoutInput>;

export const previewLayoutResultSchema = z.object({
	fileId: z.string(),
	pageCount: z.int().min(0),
	lines: z.array(layoutLineSchema),
});
export type PreviewLayoutResult = z.infer<typeof previewLayoutResultSchema>;
