import {
	createCustomFieldInput,
	customFieldWithUsageSchema,
	reorderCustomFieldsInput,
	updateCustomFieldInput,
} from "@docstore/shared/custom-field";
import { z } from "zod";
import { protectedProcedure, writeProcedure } from "../index";
import {
	createCustomField,
	deleteCustomField,
	listCustomFields,
	reorderCustomFields,
	updateCustomField,
} from "../services/custom-field.service";

const TAGS = ["Custom field"];

export const customFieldRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/custom-fields",
			tags: TAGS,
			summary: "List custom field definitions with their usage count",
		})
		.input(z.object({}))
		.output(z.array(customFieldWithUsageSchema))
		.handler(({ context }) => listCustomFields(context.db)),

	create: writeProcedure
		.route({
			method: "POST",
			path: "/custom-fields",
			tags: TAGS,
			summary: "Create a custom field",
			successStatus: 201,
		})
		.input(createCustomFieldInput)
		.output(customFieldWithUsageSchema)
		.handler(({ input, context }) => createCustomField(context.db, input)),

	update: writeProcedure
		.route({
			method: "PATCH",
			path: "/custom-fields/{id}",
			tags: TAGS,
			summary: "Update a field (the type is frozen once a value exists)",
			description:
				"Changing `type` is refused with `CONFLICT` as soon as `valueCount > 0`.",
		})
		.input(updateCustomFieldInput)
		.output(customFieldWithUsageSchema)
		.handler(({ input, context }) => updateCustomField(context.db, input)),

	delete: writeProcedure
		.route({
			method: "DELETE",
			path: "/custom-fields/{id}",
			tags: TAGS,
			summary: "Delete a field and all its values",
		})
		.input(z.object({ id: z.string().min(1) }))
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) => deleteCustomField(context.db, input.id)),

	reorder: writeProcedure
		.route({
			method: "POST",
			path: "/custom-fields/reorder",
			tags: TAGS,
			summary: "Reorder custom fields",
		})
		.input(reorderCustomFieldsInput)
		.output(z.array(customFieldWithUsageSchema))
		.handler(({ input, context }) => reorderCustomFields(context.db, input)),
};
