import {
	createUploadLinkInput,
	updateUploadLinkInput,
	uploadLinkSchema,
	uploadLinkWithUrlSchema,
} from "@docstore/shared/upload-link";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure } from "../index";
import {
	createUploadLink,
	deleteUploadLink,
	disableUploadLink,
	listUploadLinks,
	updateUploadLink,
} from "../services/upload-link.service";

const TAGS = ["Upload link"];

const idInput = z.object({ id: z.string().min(1) });

/**
 * Public upload links (SPEC §2 "Miscellaneous").
 *
 * Creating a link opens an unauthenticated door onto the database: reserved for
 * `admin` callers, like API keys.
 */
export const uploadLinkRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/upload-links",
			tags: TAGS,
			summary: "List public upload links, each with its public URL",
		})
		.input(z.object({}))
		.output(z.array(uploadLinkSchema))
		.handler(({ context }) => listUploadLinks(context.db)),

	create: adminProcedure
		.route({
			method: "POST",
			path: "/upload-links",
			tags: TAGS,
			summary: "Create an upload link — returns the public URL",
			successStatus: 201,
		})
		.input(createUploadLinkInput)
		.output(uploadLinkWithUrlSchema)
		.handler(({ input, context }) => {
			const createdById = context.session?.user.id;
			if (!createdById) throw new ORPCError("UNAUTHORIZED");
			return createUploadLink(context.db, createdById, input);
		}),

	update: adminProcedure
		.route({
			method: "PATCH",
			path: "/upload-links/{id}",
			tags: TAGS,
			summary: "Update a link (message, expiry, quota, default values)",
		})
		.input(updateUploadLinkInput)
		.output(uploadLinkSchema)
		.handler(({ input, context }) => updateUploadLink(context.db, input)),

	disable: adminProcedure
		.route({
			method: "POST",
			path: "/upload-links/{id}/disable",
			tags: TAGS,
			summary: "Disable a link without deleting it",
		})
		.input(idInput)
		.output(uploadLinkSchema)
		.handler(({ input, context }) => disableUploadLink(context.db, input.id)),

	delete: adminProcedure
		.route({
			method: "DELETE",
			path: "/upload-links/{id}",
			tags: TAGS,
			summary: "Permanently delete a link",
		})
		.input(idInput)
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) => deleteUploadLink(context.db, input.id)),
};
