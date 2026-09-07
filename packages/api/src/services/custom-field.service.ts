import type { Db } from "@docstore/db";
import { category } from "@docstore/db/schema/category";
import {
	customField,
	documentFieldValue,
} from "@docstore/db/schema/custom-field";
import { slugify } from "@docstore/shared/common";
import type {
	CreateCustomFieldInput,
	CustomField,
	CustomFieldOptions,
	CustomFieldType,
	CustomFieldValue,
	CustomFieldWithUsage,
	ReorderCustomFieldsInput,
	UpdateCustomFieldInput,
} from "@docstore/shared/custom-field";
import {
	customFieldCategoryIssue,
	customFieldValueIssue,
} from "@docstore/shared/custom-field";
import { ORPCError } from "@orpc/server";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";

/** Values entered per field, in one round trip (list screen). */
async function valueCounts(db: Db): Promise<Map<string, number>> {
	const rows = await db
		.select({ fieldId: documentFieldValue.fieldId, value: count() })
		.from(documentFieldValue)
		.groupBy(documentFieldValue.fieldId);
	return new Map(rows.map((row) => [row.fieldId, row.value]));
}

export async function listCustomFields(
	db: Db,
): Promise<CustomFieldWithUsage[]> {
	const [rows, counts] = await Promise.all([
		db
			.select()
			.from(customField)
			.orderBy(
				asc(customField.sortOrder),
				asc(customField.name),
				asc(customField.id),
			),
		valueCounts(db),
	]);
	return rows.map((row) => ({ ...row, valueCount: counts.get(row.id) ?? 0 }));
}

export async function requireCustomField(
	db: Db,
	id: string,
): Promise<CustomField> {
	const rows = await db
		.select()
		.from(customField)
		.where(eq(customField.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Custom field "${id}" not found.`,
		});
	}
	return row;
}

/** Consistency between a field type and its options. */
function assertOptions(type: CustomFieldType, options: CustomFieldOptions) {
	if (type === "select") {
		if (!options.choices || options.choices.length === 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: 'A "select" field must define at least one choice.',
			});
		}
		if (new Set(options.choices).size !== options.choices.length) {
			throw new ORPCError("BAD_REQUEST", {
				message: 'The choices of a "select" field must be distinct.',
			});
		}
	} else if (options.choices && options.choices.length > 0) {
		throw new ORPCError("BAD_REQUEST", {
			message: 'Choices only apply to "select" fields.',
		});
	}

	if (type !== "money" && options.currency) {
		throw new ORPCError("BAD_REQUEST", {
			message: 'The currency only applies to "money" fields.',
		});
	}
}

async function assertCategoriesExist(db: Db, ids: string[]): Promise<void> {
	if (ids.length === 0) {
		return;
	}
	const rows = await db
		.select({ id: category.id })
		.from(category)
		.where(inArray(category.id, ids));
	const found = new Set(rows.map((row) => row.id));
	const missing = ids.filter((id) => !found.has(id));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Category not found: ${missing.join(", ")}.`,
		});
	}
}

async function assertSlugAvailable(
	db: Db,
	slug: string,
	excludeId?: string,
): Promise<void> {
	const rows = await db
		.select({ id: customField.id })
		.from(customField)
		.where(
			excludeId
				? and(eq(customField.slug, slug), ne(customField.id, excludeId))
				: eq(customField.slug, slug),
		)
		.limit(1);
	if (rows[0]) {
		throw new ORPCError("CONFLICT", {
			message: `The slug "${slug}" is already used by another custom field.`,
		});
	}
}

export async function createCustomField(
	db: Db,
	input: CreateCustomFieldInput,
): Promise<CustomFieldWithUsage> {
	const options: CustomFieldOptions = { ...input.options };
	if (input.type === "money" && !options.currency) {
		options.currency = "EUR";
	}
	assertOptions(input.type, options);
	await assertCategoriesExist(db, input.categoryIds);

	const slug = input.slug ?? slugify(input.name);
	if (!slug) {
		throw new ORPCError("BAD_REQUEST", {
			message: "The field name cannot be turned into a slug.",
		});
	}
	await assertSlugAvailable(db, slug);

	const maxRows = await db
		.select({ value: sql<number>`coalesce(max(${customField.sortOrder}), -1)` })
		.from(customField);

	const rows = await db
		.insert(customField)
		.values({
			name: input.name,
			slug,
			type: input.type,
			options,
			categoryIds: input.categoryIds,
			sortOrder: (maxRows[0]?.value ?? -1) + 1,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The custom field could not be created.",
		});
	}
	// A brand new field cannot carry values yet.
	return { ...row, valueCount: 0 };
}

/** Number of values entered for a field (blocks a type change). */
export async function countFieldValues(db: Db, id: string): Promise<number> {
	const rows = await db
		.select({ value: count() })
		.from(documentFieldValue)
		.where(eq(documentFieldValue.fieldId, id));
	return rows[0]?.value ?? 0;
}

export async function updateCustomField(
	db: Db,
	input: UpdateCustomFieldInput,
): Promise<CustomFieldWithUsage> {
	const current = await requireCustomField(db, input.id);
	const valueCount = await countFieldValues(db, input.id);

	const type = input.type ?? current.type;
	if (input.type !== undefined && input.type !== current.type) {
		if (valueCount > 0) {
			throw new ORPCError("CONFLICT", {
				message: `The type of the field "${current.name}" can no longer change: ${valueCount} value(s) entered.`,
			});
		}
	}

	const options: CustomFieldOptions =
		input.options !== undefined ? { ...input.options } : { ...current.options };
	if (type === "money" && !options.currency) {
		options.currency = "EUR";
	}
	if (type !== current.type || input.options !== undefined) {
		assertOptions(type, options);
	}

	const patch: Partial<typeof customField.$inferInsert> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.type !== undefined) patch.type = input.type;
	if (input.options !== undefined || input.type !== undefined) {
		patch.options = options;
	}
	if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
	if (input.categoryIds !== undefined) {
		await assertCategoriesExist(db, input.categoryIds);
		patch.categoryIds = input.categoryIds;
	}
	if (input.slug !== undefined) {
		await assertSlugAvailable(db, input.slug, input.id);
		patch.slug = input.slug;
	}

	if (Object.keys(patch).length === 0) {
		return { ...current, valueCount };
	}

	const rows = await db
		.update(customField)
		.set(patch)
		.where(eq(customField.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Custom field "${input.id}" not found.`,
		});
	}
	return { ...row, valueCount };
}

export async function deleteCustomField(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	await requireCustomField(db, id);
	// `document_field_value` is deleted by cascade.
	await db.delete(customField).where(eq(customField.id, id));
	return { id, deleted: true };
}

export async function reorderCustomFields(
	db: Db,
	input: ReorderCustomFieldsInput,
): Promise<CustomFieldWithUsage[]> {
	const unique = [...new Set(input.ids)];
	const rows = await db
		.select({ id: customField.id })
		.from(customField)
		.where(inArray(customField.id, unique));
	const found = new Set(rows.map((row) => row.id));
	const missing = unique.filter((id) => !found.has(id));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Custom field not found: ${missing.join(", ")}.`,
		});
	}

	await db.transaction(async (tx) => {
		for (const [index, id] of unique.entries()) {
			await tx
				.update(customField)
				.set({ sortOrder: index })
				.where(eq(customField.id, id));
		}
	});

	return listCustomFields(db);
}

/**
 * Checks that a value matches the field definition: type, allowed choice,
 * imposed currency and sign (`@docstore/shared/custom-field`).
 * Checking that a Party exists is delegated to the caller.
 */
export function assertValueMatchesField(
	field: CustomField,
	value: CustomFieldValue,
): void {
	const issue = customFieldValueIssue(field, value);
	if (issue) {
		throw new ORPCError("BAD_REQUEST", { message: issue });
	}
}

/**
 * Checks that the field is offered on the category of the document (its own or
 * one of its ancestors). A field with an empty `categoryIds` is global.
 */
export function assertFieldAppliesToCategory(
	field: CustomField,
	documentCategoryIds: readonly string[],
): void {
	const issue = customFieldCategoryIssue(field, documentCategoryIds);
	if (issue) {
		throw new ORPCError("BAD_REQUEST", { message: issue });
	}
}
