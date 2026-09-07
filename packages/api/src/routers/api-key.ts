import {
	apiKeySchema,
	createApiKeyInput,
	createApiKeyResultSchema,
} from "@docstore/shared/api-key";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { adminProcedure, protectedProcedure } from "../index";
import {
	createApiKey,
	deleteApiKey,
	listApiKeys,
	revokeApiKey,
} from "../services/api-key.service";

const TAGS = ["API key"];

const idInput = z.object({ id: z.string().min(1) });

/** Key owner: the session user (or the bearer key's user). */
function ownerId(context: Context): string {
	const id = context.session?.user.id;
	if (!id) {
		throw new ORPCError("UNAUTHORIZED");
	}
	return id;
}

export const apiKeyRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/api-keys",
			tags: TAGS,
			summary: "List your API keys (the secret is never read back)",
		})
		.input(z.object({}))
		.output(z.array(apiKeySchema))
		.handler(({ context }) => listApiKeys(context.db, ownerId(context))),

	create: adminProcedure
		.route({
			method: "POST",
			path: "/api-keys",
			tags: TAGS,
			summary: "Create an API key (the secret is returned only once)",
			successStatus: 201,
		})
		.input(createApiKeyInput)
		.output(createApiKeyResultSchema)
		.handler(({ input, context }) =>
			createApiKey(context.db, ownerId(context), input),
		),

	revoke: adminProcedure
		.route({
			method: "POST",
			path: "/api-keys/{id}/revoke",
			tags: TAGS,
			summary: "Revoke an API key (it no longer authenticates)",
		})
		.input(idInput)
		.output(apiKeySchema)
		.handler(({ input, context }) =>
			revokeApiKey(context.db, input.id, ownerId(context)),
		),

	delete: adminProcedure
		.route({
			method: "DELETE",
			path: "/api-keys/{id}",
			tags: TAGS,
			summary: "Permanently delete an API key",
		})
		.input(idInput)
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) =>
			deleteApiKey(context.db, input.id, ownerId(context)),
		),
};
