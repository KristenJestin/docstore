import {
	createTagInput,
	listTagsInput,
	mergeTagsInput,
	tagSchema,
	tagWithCountSchema,
	updateTagInput,
} from "@docstore/shared/tag";
import { z } from "zod";
import { protectedProcedure, writeProcedure } from "../index";
import {
	createTag,
	deleteTag,
	listTags,
	mergeTags,
	updateTag,
} from "../services/tag.service";

const TAGS = ["Tag"];

export const tagRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/tags",
			tags: TAGS,
			summary: "List tags with their document count",
		})
		.input(listTagsInput)
		.output(z.array(tagWithCountSchema))
		.handler(({ input, context }) => listTags(context.db, input)),

	create: writeProcedure
		.route({
			method: "POST",
			path: "/tags",
			tags: TAGS,
			summary: "Create a tag (unique name, case-insensitive)",
			successStatus: 201,
		})
		.input(createTagInput)
		.output(tagSchema)
		.handler(({ input, context }) => createTag(context.db, input)),

	update: writeProcedure
		.route({
			method: "PATCH",
			path: "/tags/{id}",
			tags: TAGS,
			summary: "Rename a tag or change its color",
		})
		.input(updateTagInput)
		.output(tagSchema)
		.handler(({ input, context }) => updateTag(context.db, input)),

	delete: writeProcedure
		.route({
			method: "DELETE",
			path: "/tags/{id}",
			tags: TAGS,
			summary: "Delete a tag and its assignments",
		})
		.input(z.object({ id: z.string().min(1) }))
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) => deleteTag(context.db, input.id)),

	merge: writeProcedure
		.route({
			method: "POST",
			path: "/tags/merge",
			tags: TAGS,
			summary: "Merge a tag into another one",
		})
		.input(mergeTagsInput)
		.output(
			z.object({
				target: tagSchema,
				movedDocuments: z.int().min(0),
			}),
		)
		.handler(({ input, context }) => mergeTags(context.db, input)),
};
