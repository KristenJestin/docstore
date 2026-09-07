import { z } from "zod";
import { dateOnlySchema, slugSchema } from "./common";

/**
 * Custom field types (SPEC §2 "CustomFieldDefinition").
 * Single source of truth: the PostgreSQL enum `custom_field_type` derives
 * from it.
 */
export const CUSTOM_FIELD_TYPES = [
	"text",
	"number",
	"money",
	"date",
	"boolean",
	"select",
	"url",
	"party_ref",
] as const;

export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

/** Uppercase ISO 4217 code. */
export const currencySchema = z
	.string()
	.trim()
	.regex(/^[A-Z]{3}$/, { message: "Currency must be an ISO code (EUR)." });

/** Amount with at most two decimals. */
export const moneyAmountSchema = z
	.number()
	.refine(
		(value) =>
			Number.isFinite(value) &&
			Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
		{ message: "Amount cannot have more than two decimals." },
	);

export const customFieldOptionsSchema = z.object({
	/** Allowed values for a `select` field. */
	choices: z.array(z.string().trim().min(1).max(120)).optional(),
	/** Currency imposed on a `money` field; `EUR` when absent. */
	currency: currencySchema.optional(),
	/**
	 * `money`/`number` fields refuse a negative amount unless this is set — a
	 * credit note is the exception, not the rule.
	 */
	allowNegative: z.boolean().optional(),
});
export type CustomFieldOptions = z.infer<typeof customFieldOptionsSchema>;

/** Currency of a `money` field when its options do not name one. */
export const DEFAULT_MONEY_CURRENCY = "EUR";

/**
 * Typed value of a custom field, stored as JSONB.
 * `kind` uses exactly the values of `CUSTOM_FIELD_TYPES`.
 */
export const customFieldValueSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("text"),
		text: z.string().trim().min(1).max(2000),
	}),
	z.object({ kind: z.literal("number"), number: z.number().finite() }),
	z.object({
		kind: z.literal("money"),
		amount: moneyAmountSchema,
		currency: currencySchema,
	}),
	z.object({ kind: z.literal("date"), date: dateOnlySchema }),
	z.object({ kind: z.literal("boolean"), boolean: z.boolean() }),
	z.object({
		kind: z.literal("select"),
		choice: z.string().trim().min(1).max(120),
	}),
	z.object({ kind: z.literal("url"), url: z.url().max(2000) }),
	z.object({ kind: z.literal("party_ref"), partyId: z.string().min(1) }),
]);
export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;

export const customFieldSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	type: customFieldTypeSchema,
	options: customFieldOptionsSchema,
	/** Categories where the field is offered; empty = visible everywhere. */
	categoryIds: z.array(z.string()),
	sortOrder: z.int(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type CustomField = z.infer<typeof customFieldSchema>;

/**
 * A definition plus how many document values already use it.
 *
 * The count is what freezes the type: `customField.update` refuses a `type`
 * change with `CONFLICT` as soon as `valueCount > 0`, so the front end can grey
 * the selector out instead of letting the user hit the error.
 */
export const customFieldWithUsageSchema = customFieldSchema.extend({
	valueCount: z.int().min(0),
});
export type CustomFieldWithUsage = z.infer<typeof customFieldWithUsageSchema>;

export const createCustomFieldInput = z.object({
	name: z.string().trim().min(1).max(100),
	slug: slugSchema.optional(),
	type: customFieldTypeSchema,
	options: customFieldOptionsSchema.default({}),
	categoryIds: z.array(z.string().min(1)).default([]),
});
export type CreateCustomFieldInput = z.infer<typeof createCustomFieldInput>;

export const updateCustomFieldInput = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(100).optional(),
	slug: slugSchema.optional(),
	/** Rejected when values already exist for this field. */
	type: customFieldTypeSchema.optional(),
	options: customFieldOptionsSchema.optional(),
	categoryIds: z.array(z.string().min(1)).optional(),
	sortOrder: z.int().min(0).optional(),
});
export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldInput>;

export const reorderCustomFieldsInput = z.object({
	/** Full or partial list: the array order becomes `sortOrder`. */
	ids: z.array(z.string().min(1)).min(1),
});
export type ReorderCustomFieldsInput = z.infer<typeof reorderCustomFieldsInput>;

/* ------------------------------------------------------------------ */
/* Constraints                                                          */
/* ------------------------------------------------------------------ */

/** What a constraint check needs to know about a field definition. */
export interface CustomFieldConstraints {
	name: string;
	type: CustomFieldType;
	options: CustomFieldOptions;
	/** Categories the field is offered in; empty = global. */
	categoryIds: string[];
}

/**
 * Checks a value against its field definition: matching type, allowed choice,
 * imposed currency and sign.
 *
 * Returns the reason it does not fit, or `null` when it does. Pure on purpose:
 * the API turns it into a `BAD_REQUEST`, the rule engine into a review reason.
 */
export function customFieldValueIssue(
	field: Pick<CustomFieldConstraints, "name" | "type" | "options">,
	value: CustomFieldValue,
): string | null {
	if (value.kind !== field.type) {
		return `The field "${field.name}" expects a value of type "${field.type}", received "${value.kind}".`;
	}
	if (value.kind === "select") {
		const choices = field.options.choices ?? [];
		if (!choices.includes(value.choice)) {
			return `"${value.choice}" is not one of the choices of the field "${field.name}".`;
		}
	}
	if (value.kind === "money") {
		const expected = field.options.currency ?? DEFAULT_MONEY_CURRENCY;
		if (value.currency !== expected) {
			return `The field "${field.name}" is expressed in ${expected}, received ${value.currency}.`;
		}
		if (value.amount < 0 && !field.options.allowNegative) {
			return `The field "${field.name}" does not accept a negative amount.`;
		}
	}
	if (
		value.kind === "number" &&
		value.number < 0 &&
		!field.options.allowNegative
	) {
		return `The field "${field.name}" does not accept a negative value.`;
	}
	return null;
}

/**
 * Checks that a field is offered on a document's category (SPEC §2): a field
 * restricted to a list of categories only applies inside them, a field with an
 * empty `categoryIds` applies everywhere.
 */
export function customFieldCategoryIssue(
	field: Pick<CustomFieldConstraints, "name" | "categoryIds">,
	/** Category of the document **and its ancestors**: a field offered on a
	 * parent category stays offered on its children. */
	documentCategoryIds: readonly string[],
): string | null {
	if (field.categoryIds.length === 0) return null;
	if (field.categoryIds.some((id) => documentCategoryIds.includes(id))) {
		return null;
	}
	return `The field "${field.name}" does not apply to the category of this document.`;
}

/** Filter operators on a field value (v1, see the iteration 2 mission). */
export const FIELD_FILTER_OPS = ["eq", "gt", "lt", "contains"] as const;
export const fieldFilterOpSchema = z.enum(FIELD_FILTER_OPS);
export type FieldFilterOp = z.infer<typeof fieldFilterOpSchema>;

export const documentFieldFilterSchema = z.object({
	fieldId: z.string().min(1),
	op: fieldFilterOpSchema,
	value: z.union([z.string(), z.number(), z.boolean()]),
});
export type DocumentFieldFilter = z.infer<typeof documentFieldFilterSchema>;
