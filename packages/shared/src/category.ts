import { z } from "zod";
import {
	assignmentSourceSchema,
	hexColorSchema,
	iconNameSchema,
	slugSchema,
} from "./common";

/** Maximum tree depth: root = 1 (SPEC §2 "Category"). */
export const CATEGORY_MAX_DEPTH = 3;

const categoryFields = {
	id: z.string(),
	parentId: z.string().nullable(),
	name: z.string(),
	slug: z.string(),
	/** Lucide icon name in kebab-case (`receipt`, `file-signature`…). */
	icon: z.string().nullable(),
	color: z.string().nullable(),
	sortOrder: z.int(),
	createdAt: z.date(),
	updatedAt: z.date(),
};

export const categorySchema = z.object(categoryFields);
export type Category = z.infer<typeof categorySchema>;

/**
 * Lightweight version embedded in `document.list` rows.
 *
 * `source`/`confidence` describe the assignment of *this* category to *this*
 * document (`document.category_source`/`category_confidence`), not a property
 * of the category itself.
 */
export const categorySummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string().nullable(),
	source: assignmentSourceSchema,
	confidence: z.number().nullable(),
});
export type CategorySummary = z.infer<typeof categorySummarySchema>;

export interface CategoryNode extends Category {
	/** 1 for a root, 3 at most. */
	depth: number;
	/** Documents attached directly to this category. */
	ownDocumentCount: number;
	/** `ownDocumentCount` + every descendant. */
	documentCount: number;
	children: CategoryNode[];
}

/**
 * Tree node. The `children` getter is the form recommended by Zod 4 for
 * recursive schemas (it avoids a use-before-initialization reference).
 */
export const categoryNodeSchema: z.ZodType<CategoryNode> = z.object({
	...categoryFields,
	depth: z.int().min(1).max(CATEGORY_MAX_DEPTH),
	ownDocumentCount: z.int().min(0),
	documentCount: z.int().min(0),
	get children() {
		return z.array(categoryNodeSchema);
	},
});

export const createCategoryInput = z.object({
	parentId: z.string().min(1).nullish(),
	name: z.string().trim().min(1).max(100),
	icon: iconNameSchema.nullish(),
	color: hexColorSchema.nullish(),
});
export type CreateCategoryInput = z.infer<typeof createCategoryInput>;

export const updateCategoryInput = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(100).optional(),
	slug: slugSchema.optional(),
	icon: iconNameSchema.nullish(),
	color: hexColorSchema.nullish(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategoryInput>;

export const moveCategoryInput = z.object({
	id: z.string().min(1),
	/** `null` moves the category back to the root. */
	parentId: z.string().min(1).nullable(),
	sortOrder: z.int().min(0).default(0),
});
export type MoveCategoryInput = z.infer<typeof moveCategoryInput>;

/**
 * Renumbering of a sibling group after a drag & drop.
 *
 * `move` changes the parent of one category; `reorder` keeps every category
 * where it is and only rewrites `sortOrder` inside one level. Siblings absent
 * from `ids` are pushed after the listed ones, in their previous order.
 */
export const reorderCategoriesInput = z.object({
	/** `null` = the root level. */
	parentId: z.string().min(1).nullable().default(null),
	ids: z.array(z.string().min(1)).min(1),
});
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesInput>;

export const deleteCategoryInput = z.object({
	id: z.string().min(1),
	/** Fallback category for the documents; `null`/absent = none. */
	reassignTo: z.string().min(1).nullish(),
});
export type DeleteCategoryInput = z.infer<typeof deleteCategoryInput>;
