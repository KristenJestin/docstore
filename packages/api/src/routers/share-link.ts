import {
	createShareLinkInput,
	listShareLinksInput,
	shareLinkSchema,
	shareLinkWithUrlSchema,
} from "@docstore/shared/share-link";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure, writeProcedure } from "../index";
import {
	createShareLink,
	deleteShareLink,
	listShareLinks,
	revokeShareLink,
} from "../services/share-link.service";

const TAGS = ["Share link"];

const idInput = z.object({ id: z.string().min(1) });

/**
 * Share links (SPEC §2 "Misc").
 *
 * Creating a link opens a public window onto a document or a dossier: it is a
 * `write` operation, and the service refuses anything marked `sensitive`.
 */
export const shareLinkRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/share-links",
			tags: TAGS,
			summary: "List share links (filtered by document or dossier)",
		})
		.input(listShareLinksInput)
		.output(z.array(shareLinkSchema))
		.handler(({ input, context }) => listShareLinks(context.db, input)),

	create: writeProcedure
		.route({
			method: "POST",
			path: "/share-links",
			tags: TAGS,
			summary: "Create a share link — returns the public URL",
			description:
				"Exactly one of `documentId` or `dossierId`. A sensitive document (or a dossier holding one) is refused with `BAD_REQUEST`.",
			successStatus: 201,
		})
		.input(createShareLinkInput)
		.output(shareLinkWithUrlSchema)
		.handler(({ input, context }) => {
			const createdById = context.session?.user.id;
			if (!createdById) throw new ORPCError("UNAUTHORIZED");
			return createShareLink(context.db, createdById, input);
		}),

	revoke: writeProcedure
		.route({
			method: "POST",
			path: "/share-links/{id}/revoke",
			tags: TAGS,
			summary: "Revoke a link: the public URL answers 410",
		})
		.input(idInput)
		.output(shareLinkSchema)
		.handler(({ input, context }) => revokeShareLink(context.db, input.id)),

	delete: writeProcedure
		.route({
			method: "DELETE",
			path: "/share-links/{id}",
			tags: TAGS,
			summary: "Permanently delete a link",
		})
		.input(idInput)
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) => deleteShareLink(context.db, input.id)),
};
