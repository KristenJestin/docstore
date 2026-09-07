import {
	createSavedSearchInput,
	reorderSavedSearchesInput,
	savedSearchSchema,
	updateSavedSearchInput,
} from "@docstore/shared/saved-search";
import { z } from "zod";
import { protectedProcedure, writeProcedure } from "../index";
import {
	createSavedSearch,
	deleteSavedSearch,
	listSavedSearches,
	reorderSavedSearches,
	updateSavedSearch,
} from "../services/saved-search.service";

const TAGS = ["Saved search"];

export const savedSearchRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/saved-searches",
			tags: TAGS,
			summary: "List saved searches, in display order",
		})
		.input(z.object({}))
		.output(z.array(savedSearchSchema))
		.handler(({ context }) => listSavedSearches(context.db)),

	create: writeProcedure
		.route({
			method: "POST",
			path: "/saved-searches",
			tags: TAGS,
			summary: "Save the current filters under a name",
			successStatus: 201,
		})
		.input(createSavedSearchInput)
		.output(savedSearchSchema)
		.handler(({ input, context }) => createSavedSearch(context.db, input)),

	update: writeProcedure
		.route({
			method: "PATCH",
			path: "/saved-searches/{id}",
			tags: TAGS,
			summary: "Rename a saved search or replace its filters",
		})
		.input(updateSavedSearchInput)
		.output(savedSearchSchema)
		.handler(({ input, context }) => updateSavedSearch(context.db, input)),

	delete: writeProcedure
		.route({
			method: "DELETE",
			path: "/saved-searches/{id}",
			tags: TAGS,
			summary: "Delete a saved search",
		})
		.input(z.object({ id: z.string().min(1) }))
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) => deleteSavedSearch(context.db, input.id)),

	reorder: writeProcedure
		.route({
			method: "POST",
			path: "/saved-searches/reorder",
			tags: TAGS,
			summary: "Reorder saved searches",
		})
		.input(reorderSavedSearchesInput)
		.output(z.array(savedSearchSchema))
		.handler(({ input, context }) => reorderSavedSearches(context.db, input)),
};
