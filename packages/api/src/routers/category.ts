import {
	categoryNodeSchema,
	categorySchema,
	createCategoryInput,
	deleteCategoryInput,
	moveCategoryInput,
	reorderCategoriesInput,
	updateCategoryInput,
} from "@docstore/shared/category";
import { z } from "zod";
import { protectedProcedure, writeProcedure } from "../index";
import {
	createCategory,
	deleteCategory,
	listCategories,
	moveCategory,
	reorderCategories,
	updateCategory,
} from "../services/category.service";

const TAGS = ["Category"];

export const categoryRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/categories",
			tags: TAGS,
			summary: "Full category tree with document counts",
		})
		.input(z.object({}))
		.output(z.array(categoryNodeSchema))
		.handler(({ context }) => listCategories(context.db)),

	create: writeProcedure
		.route({
			method: "POST",
			path: "/categories",
			tags: TAGS,
			summary: "Create a category (slug generated from the name)",
			successStatus: 201,
		})
		.input(createCategoryInput)
		.output(categorySchema)
		.handler(({ input, context }) => createCategory(context.db, input)),

	update: writeProcedure
		.route({
			method: "PATCH",
			path: "/categories/{id}",
			tags: TAGS,
			summary: "Rename a category or change its icon/color",
		})
		.input(updateCategoryInput)
		.output(categorySchema)
		.handler(({ input, context }) => updateCategory(context.db, input)),

	move: writeProcedure
		.route({
			method: "POST",
			path: "/categories/{id}/move",
			tags: TAGS,
			summary: "Move a category (cycles and a 4th level are rejected)",
		})
		.input(moveCategoryInput)
		.output(categorySchema)
		.handler(({ input, context }) => moveCategory(context.db, input)),

	reorder: writeProcedure
		.route({
			method: "POST",
			path: "/categories/reorder",
			tags: TAGS,
			summary: "Renumber a sibling group (drag & drop inside one level)",
			description:
				"`parentId: null` targets the root level. Every id must already be a child of `parentId`: changing the parent is `move`. Siblings left out keep their order, after the listed ones. Returns the whole tree.",
		})
		.input(reorderCategoriesInput)
		.output(z.array(categoryNodeSchema))
		.handler(({ input, context }) => reorderCategories(context.db, input)),

	delete: writeProcedure
		.route({
			method: "DELETE",
			path: "/categories/{id}",
			tags: TAGS,
			summary: "Delete a category (documents reassigned, children moved up)",
		})
		.input(deleteCategoryInput)
		.output(
			z.object({
				id: z.string(),
				deleted: z.literal(true),
				reassignedDocuments: z.int().min(0),
			}),
		)
		.handler(({ input, context }) => deleteCategory(context.db, input)),
};
