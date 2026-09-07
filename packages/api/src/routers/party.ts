import { paginatedSchema } from "@docstore/shared/pagination";
import {
	createPartyInput,
	createPartyRelationInput,
	findPartyByIdentifierInput,
	listPartiesInput,
	mergePartiesInput,
	mergePartiesResultSchema,
	partyDetailSchema,
	partyDuplicateSchema,
	partyRelationSchema,
	partySchema,
	updatePartyInput,
} from "@docstore/shared/party";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { protectedProcedure, writeProcedure } from "../index";
import {
	addPartyRelation,
	archiveParty,
	createParty,
	deleteParty,
	findPartiesByIdentifier,
	getParty,
	listParties,
	listPartyDuplicates,
	mergeParties,
	removePartyRelation,
	unarchiveParty,
	updateParty,
} from "../services/party.service";
import {
	fetchPartyLogo,
	MAX_LOGO_BYTES,
	removePartyLogo,
	uploadPartyLogo,
} from "../services/party-logo.service";

const TAGS = ["Party"];

/** Storage comes from the ingestion pipeline, absent on a degraded server. */
function requireStorage(context: Context) {
	const storage = context.ingestion?.ctx.storage;
	if (!storage) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "File storage is not available on this server.",
		});
	}
	return storage;
}

const idInput = z.object({ id: z.string().min(1) });
const deletedOutput = z.object({ id: z.string(), deleted: z.literal(true) });

export const partyRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/parties",
			tags: TAGS,
			summary: "List Parties (search, filters, pagination)",
		})
		.input(listPartiesInput)
		.output(paginatedSchema(partySchema))
		.handler(({ input, context }) => listParties(context.db, input)),

	findByIdentifier: protectedProcedure
		.route({
			method: "GET",
			path: "/parties/by-identifier",
			tags: TAGS,
			summary: "Find Parties by exact identifier",
		})
		.input(findPartyByIdentifierInput)
		.output(z.array(partySchema))
		.handler(({ input, context }) =>
			findPartiesByIdentifier(context.db, input.kind, input.value),
		),

	duplicates: protectedProcedure
		.route({
			method: "GET",
			path: "/parties/duplicates",
			tags: TAGS,
			summary: "Pairs of Parties that look like the same one",
		})
		.input(z.object({}))
		.output(z.array(partyDuplicateSchema))
		.handler(({ context }) => listPartyDuplicates(context.db)),

	get: protectedProcedure
		.route({
			method: "GET",
			path: "/parties/{id}",
			tags: TAGS,
			summary: "Party detail (relations + document count)",
		})
		.input(idInput)
		.output(partyDetailSchema)
		.handler(({ input, context }) => getParty(context.db, input.id)),

	create: writeProcedure
		.route({
			method: "POST",
			path: "/parties",
			tags: TAGS,
			summary: "Create a Party",
			successStatus: 201,
		})
		.input(createPartyInput)
		.output(partySchema)
		.handler(({ input, context }) => createParty(context.db, input)),

	update: writeProcedure
		.route({
			method: "PATCH",
			path: "/parties/{id}",
			tags: TAGS,
			summary: "Update a Party",
		})
		.input(updatePartyInput.extend(idInput.shape))
		.output(partySchema)
		.handler(({ input, context }) => {
			const { id, ...patch } = input;
			return updateParty(context.db, id, patch);
		}),

	mergeInto: writeProcedure
		.route({
			method: "POST",
			path: "/parties/merge",
			tags: TAGS,
			summary:
				"Merge a Party into another: documents, relations, identifiers and aliases move, the source is archived",
		})
		.input(mergePartiesInput)
		.output(mergePartiesResultSchema)
		.handler(({ input, context }) => mergeParties(context.db, input)),

	archive: writeProcedure
		.route({
			method: "POST",
			path: "/parties/{id}/archive",
			tags: TAGS,
			summary: "Archive a Party",
		})
		.input(idInput)
		.output(partySchema)
		.handler(({ input, context }) => archiveParty(context.db, input.id)),

	unarchive: writeProcedure
		.route({
			method: "POST",
			path: "/parties/{id}/unarchive",
			tags: TAGS,
			summary: "Unarchive a Party",
		})
		.input(idInput)
		.output(partySchema)
		.handler(({ input, context }) => unarchiveParty(context.db, input.id)),

	delete: writeProcedure
		.route({
			method: "DELETE",
			path: "/parties/{id}",
			tags: TAGS,
			summary: "Delete a Party (rejected if documents are linked to it)",
		})
		.input(idInput)
		.output(deletedOutput)
		.handler(({ input, context }) => deleteParty(context.db, input.id)),

	uploadLogo: writeProcedure
		.route({
			method: "POST",
			path: "/parties/{id}/logo",
			tags: TAGS,
			summary: "Upload a logo (png/jpg/webp/svg, 1 MB max, 256 px)",
		})
		.input(
			z.object({
				id: z.string().min(1),
				file: z.file().max(MAX_LOGO_BYTES),
			}),
		)
		.output(partySchema)
		.handler(async ({ input, context }) => {
			const storage = requireStorage(context);
			return uploadPartyLogo(context.db, storage, {
				id: input.id,
				filename: input.file.name,
				mime: input.file.type,
				bytes: new Uint8Array(await input.file.arrayBuffer()),
			});
		}),

	fetchLogo: writeProcedure
		.route({
			method: "POST",
			path: "/parties/{id}/logo/fetch",
			tags: TAGS,
			summary: "Fetch the logo from the Party domain",
		})
		.input(z.object({ id: z.string().min(1) }))
		.output(partySchema)
		.handler(({ input, context }) =>
			fetchPartyLogo(context.db, requireStorage(context), input.id),
		),

	removeLogo: writeProcedure
		.route({
			method: "DELETE",
			path: "/parties/{id}/logo",
			tags: TAGS,
			summary: "Delete the logo of a Party",
		})
		.input(idInput)
		.output(partySchema)
		.handler(({ input, context }) =>
			removePartyLogo(context.db, requireStorage(context), input.id),
		),

	addRelation: writeProcedure
		.route({
			method: "POST",
			path: "/party-relations",
			tags: TAGS,
			summary: "Create a relation between two Parties",
			successStatus: 201,
		})
		.input(createPartyRelationInput)
		.output(partyRelationSchema)
		.handler(({ input, context }) => addPartyRelation(context.db, input)),

	removeRelation: writeProcedure
		.route({
			method: "DELETE",
			path: "/party-relations/{id}",
			tags: TAGS,
			summary: "Delete a relation between two Parties",
		})
		.input(idInput)
		.output(deletedOutput)
		.handler(({ input, context }) => removePartyRelation(context.db, input.id)),
};
