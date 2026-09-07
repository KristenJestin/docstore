import { z } from "zod";
import { datePrecisionSchema, documentPartyRoleSchema } from "./document";
import { extractionResultSchema } from "./extraction";

/**
 * Unified rule engine (SPEC §3).
 *
 * A rule = triggers + condition (boolean tree) + actions. The evaluation
 * engine lives in `@docstore/rules`: this file only carries the schemas
 * shared between the API, the pipeline and the frontend.
 */

/** Moments when a rule can be evaluated. */
export const RULE_TRIGGERS = [
	"ingest",
	"update",
	"manual",
	"scheduled",
] as const;
export const ruleTriggerSchema = z.enum(RULE_TRIGGERS);
export type RuleTrigger = z.infer<typeof ruleTriggerSchema>;

/** Group operators of the condition tree. */
export const RULE_CONDITION_OPS = ["and", "or", "not"] as const;
export const ruleConditionOpSchema = z.enum(RULE_CONDITION_OPS);
export type RuleConditionOp = z.infer<typeof ruleConditionOpSchema>;

/**
 * Fields usable in a condition (SPEC §3). Closed list: the frontend can show
 * it as is in a picker.
 */
export const RULE_CONDITION_FIELDS = [
	"content",
	"filename",
	"mime",
	"page_count",
	"source",
	"mail.from",
	"mail.subject",
	"detected_identifiers.siren",
	"detected_identifiers.siret",
	"detected_identifiers.vat",
	"detected_identifiers.iban",
	"detected_identifiers.email",
	"detected_identifiers.domain",
	"detected_identifiers.phone",
	"party.id",
	"party.name",
	"category",
	"tags",
	"document_date",
	"title",
] as const;
export const ruleConditionFieldSchema = z.enum(RULE_CONDITION_FIELDS);
export type RuleConditionField = z.infer<typeof ruleConditionFieldSchema>;

export const RULE_COMPARATORS = [
	"eq",
	"neq",
	"contains",
	"icontains",
	"startsWith",
	"endsWith",
	"regex",
	"in",
	"gt",
	"lt",
	"between",
	"exists",
] as const;
export const ruleComparatorSchema = z.enum(RULE_COMPARATORS);
export type RuleComparator = z.infer<typeof ruleComparatorSchema>;

/** Operand of a comparison: scalar, or list for `in` / `between`. */
export const ruleConditionValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.array(z.union([z.string(), z.number()])),
]);
export type RuleConditionValue = z.infer<typeof ruleConditionValueSchema>;

export type RuleConditionGroup = {
	op: RuleConditionOp;
	children: RuleCondition[];
};

export type RuleConditionLeaf = {
	field: RuleConditionField;
	cmp: RuleComparator;
	value?: RuleConditionValue;
	/** `RegExp` flags for `cmp: "regex"` (default `"i"`). */
	flags?: string;
};

export type RuleCondition = RuleConditionGroup | RuleConditionLeaf;

export const ruleConditionLeafSchema: z.ZodType<RuleConditionLeaf> = z.object({
	field: ruleConditionFieldSchema,
	cmp: ruleComparatorSchema,
	value: ruleConditionValueSchema.optional(),
	flags: z
		.string()
		.max(8)
		.regex(/^[dgimsuvy]*$/)
		.optional(),
});

/** Recursive tree: the getter is the form recommended by Zod 4. */
export const ruleConditionSchema: z.ZodType<RuleCondition> = z.union([
	z.object({
		op: ruleConditionOpSchema,
		get children() {
			return z.array(ruleConditionSchema);
		},
	}),
	ruleConditionLeafSchema,
]);

/** Always-true condition: an `and` group without children. */
export const ALWAYS_TRUE_CONDITION: RuleCondition = { op: "and", children: [] };

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

export const RULE_ACTION_TYPES = [
	"set_document_type",
	"add_tag",
	"remove_tag",
	"link_party",
	"set_field",
	"set_document_date",
	"set_period",
	"set_valid_until",
	"set_title",
	"set_sensitive",
	"webhook",
] as const;
export const ruleActionTypeSchema = z.enum(RULE_ACTION_TYPES);
export type RuleActionType = z.infer<typeof ruleActionTypeSchema>;

/**
 * Literal value set by `set_field`: the typed shape of a custom field is
 * validated at write time (the field type is only known in the database).
 */
export const ruleLiteralValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
]);
export type RuleLiteralValue = z.infer<typeof ruleLiteralValueSchema>;

export const ruleActionSchema = z.discriminatedUnion("type", [
	/** Applies a whole document type: category, parties, tags, title, layout. */
	z.object({
		type: z.literal("set_document_type"),
		documentTypeId: z.string().min(1),
	}),
	z.object({ type: z.literal("add_tag"), tagId: z.string().min(1) }),
	z.object({ type: z.literal("remove_tag"), tagId: z.string().min(1) }),
	z.object({
		type: z.literal("link_party"),
		partyId: z.string().min(1),
		role: documentPartyRoleSchema,
	}),
	z.object({
		type: z.literal("set_field"),
		fieldId: z.string().min(1),
		/**
		 * Literal value only: extracting into a field is the job of the
		 * extraction rules of a layout (SPEC §9).
		 */
		value: ruleLiteralValueSchema,
	}),
	z.object({
		type: z.literal("set_document_date"),
		/** Absent = date detected automatically in the text. */
		extractionRuleId: z.string().min(1).optional(),
	}),
	z.object({
		type: z.literal("set_period"),
		extractionRuleId: z.string().min(1).optional(),
	}),
	z.object({
		type: z.literal("set_valid_until"),
		extractionRuleId: z.string().min(1).optional(),
	}),
	z.object({
		type: z.literal("set_title"),
		template: z.string().trim().min(1).max(300),
	}),
	z.object({ type: z.literal("set_sensitive"), sensitive: z.boolean() }),
	/** Reserved for iteration 6: planned but never executed here. */
	z.object({ type: z.literal("webhook"), url: z.url().max(2000) }),
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

/* ------------------------------------------------------------------ */
/* Planned operations                                                   */
/* ------------------------------------------------------------------ */

/**
 * Pure result of the engine: what would have to be written, without having
 * written it. `rule.test` returns these operations as is.
 */
export const plannedOperationSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("set_document_type"),
		documentTypeId: z.string(),
		confidence: z.number().nullable(),
	}),
	z.object({ type: z.literal("add_tag"), tagId: z.string() }),
	z.object({ type: z.literal("remove_tag"), tagId: z.string() }),
	z.object({
		type: z.literal("link_party"),
		partyId: z.string(),
		role: documentPartyRoleSchema,
		confidence: z.number().nullable(),
	}),
	z.object({
		type: z.literal("set_field"),
		fieldId: z.string(),
		value: z.unknown(),
		confidence: z.number().nullable(),
		extractionRuleId: z.string().optional(),
	}),
	z.object({
		type: z.literal("set_document_date"),
		date: z.string(),
		precision: datePrecisionSchema,
		confidence: z.number().nullable(),
	}),
	z.object({
		type: z.literal("set_period"),
		start: z.string().nullable(),
		end: z.string().nullable(),
		confidence: z.number().nullable(),
	}),
	z.object({
		type: z.literal("set_valid_until"),
		date: z.string(),
		confidence: z.number().nullable(),
	}),
	z.object({ type: z.literal("set_title"), title: z.string() }),
	z.object({ type: z.literal("set_sensitive"), sensitive: z.boolean() }),
	/** Logged but not executed (iteration 6). */
	z.object({ type: z.literal("webhook"), url: z.string() }),
	/** The extraction produced nothing: feeds the review queue. */
	z.object({
		type: z.literal("extraction_failed"),
		extractionRuleId: z.string(),
		extractionRuleName: z.string(),
		fieldId: z.string().optional(),
	}),
]);
export type PlannedOperation = z.infer<typeof plannedOperationSchema>;

/* ------------------------------------------------------------------ */
/* DTOs and CRUD inputs                                                 */
/* ------------------------------------------------------------------ */

export const ruleSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	enabled: z.boolean(),
	priority: z.int(),
	triggers: z.array(ruleTriggerSchema),
	condition: ruleConditionSchema,
	actions: z.array(ruleActionSchema),
	stopOnMatch: z.boolean(),
	matchCount: z.int().min(0),
	lastMatchedAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type Rule = z.infer<typeof ruleSchema>;

export const createRuleInput = z.object({
	name: z.string().trim().min(1).max(150),
	description: z.string().trim().max(2000).nullish(),
	enabled: z.boolean().default(true),
	priority: z.int().min(0).max(10_000).optional(),
	triggers: z.array(ruleTriggerSchema).min(1).default(["ingest"]),
	condition: ruleConditionSchema,
	actions: z.array(ruleActionSchema).default([]),
	stopOnMatch: z.boolean().default(false),
});
export type CreateRuleInput = z.infer<typeof createRuleInput>;

export const updateRuleInput = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(150).optional(),
	description: z.string().trim().max(2000).nullish(),
	enabled: z.boolean().optional(),
	priority: z.int().min(0).max(10_000).optional(),
	triggers: z.array(ruleTriggerSchema).min(1).optional(),
	condition: ruleConditionSchema.optional(),
	actions: z.array(ruleActionSchema).optional(),
	stopOnMatch: z.boolean().optional(),
});
export type UpdateRuleInput = z.infer<typeof updateRuleInput>;

/** Unsaved draft, for `rule.test`. */
export const ruleDraftSchema = z.object({
	name: z.string().trim().min(1).max(150).default("Draft"),
	condition: ruleConditionSchema,
	actions: z.array(ruleActionSchema).default([]),
});
export type RuleDraft = z.infer<typeof ruleDraftSchema>;

export const reorderRulesInput = z.object({
	/** The array order becomes the priority (0, 1, 2…). */
	ids: z.array(z.string().min(1)).min(1),
});
export type ReorderRulesInput = z.infer<typeof reorderRulesInput>;

export const toggleRuleInput = z.object({
	id: z.string().min(1),
	enabled: z.boolean(),
});
export type ToggleRuleInput = z.infer<typeof toggleRuleInput>;

export const testRuleInput = z
	.object({
		ruleId: z.string().min(1).optional(),
		rule: ruleDraftSchema.optional(),
		documentId: z.string().min(1),
	})
	.refine((input) => Boolean(input.ruleId) !== Boolean(input.rule), {
		message: "Provide either `ruleId` or `rule` (draft), not both.",
	});
export type TestRuleInput = z.infer<typeof testRuleInput>;

/** Node kind of a trace entry: an `and`/`or`/`not` group, or a comparison leaf. */
export const CONDITION_TRACE_KINDS = ["group", "leaf"] as const;
export const conditionTraceKindSchema = z.enum(CONDITION_TRACE_KINDS);
export type ConditionTraceKind = z.infer<typeof conditionTraceKindSchema>;

/**
 * One evaluation step, for the display of the test mode.
 *
 * `path` locates the node in the condition tree by child index from the root
 * (`[]` = the root itself), so the frontend can map a trace entry back to the
 * tree it renders without relying on the trace's array order.
 */
export const conditionTraceEntrySchema = z.object({
	node: ruleConditionSchema,
	result: z.boolean(),
	path: z.array(z.int().min(0)),
	kind: conditionTraceKindSchema,
});
export type ConditionTraceEntry = z.infer<typeof conditionTraceEntrySchema>;

export const namedExtractionResultSchema = extractionResultSchema.extend({
	extractionRuleId: z.string(),
	extractionRuleName: z.string(),
});
export type NamedExtractionResult = z.infer<typeof namedExtractionResultSchema>;

export const testRuleResultSchema = z.object({
	matched: z.boolean(),
	trace: z.array(conditionTraceEntrySchema),
	/** Operations the automation would apply; empty when it does not match. */
	plannedActions: z.array(plannedOperationSchema),
	extractions: z.array(namedExtractionResultSchema),
	/**
	 * `false` when the automation carries no action at all: `plannedActions` is
	 * then empty even on a match, and the automation does nothing.
	 */
	hasActions: z.boolean(),
	/** State of the tested automation; a disabled one is still testable. */
	enabled: z.boolean(),
});
export type TestRuleResult = z.infer<typeof testRuleResultSchema>;

export const runRulesInput = z.object({
	ruleId: z.string().min(1).optional(),
	documentIds: z.array(z.string().min(1)).max(500).optional(),
	/** Processes every non-deleted document (500 at most per call). */
	all: z.boolean().default(false),
	/** Runs `ruleId` even when the automation is disabled. */
	force: z.boolean().default(false),
});
export type RunRulesInput = z.infer<typeof runRulesInput>;

/** Maximum number of documents processed by `rule.run({ all: true })`. */
export const RULE_RUN_ALL_LIMIT = 500;

export const runRulesResultSchema = z.object({
	processed: z.int().min(0),
	matched: z.int().min(0),
});
export type RunRulesResult = z.infer<typeof runRulesResultSchema>;

export const ruleRunSchema = z.object({
	id: z.string(),
	ruleId: z.string(),
	documentId: z.string(),
	matched: z.boolean(),
	actionsApplied: z.array(plannedOperationSchema),
	durationMs: z.int().min(0),
	createdAt: z.date(),
});
export type RuleRun = z.infer<typeof ruleRunSchema>;

export const listRuleRunsInput = z.object({
	ruleId: z.string().min(1).optional(),
	documentId: z.string().min(1).optional(),
	page: z.int().min(1).default(1),
	pageSize: z.int().min(1).max(100).default(25),
});
export type ListRuleRunsInput = z.infer<typeof listRuleRunsInput>;

/** Retention of the `rule_run` journal. */
export const RULE_RUN_RETENTION_DAYS = 90;
