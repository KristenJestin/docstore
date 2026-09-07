import type { ApiKeyScope } from "@docstore/shared/api-key";
import { hasScope } from "@docstore/shared/api-key";
import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}
	return next({
		context: {
			session: context.session,
		},
	});
});

export const protectedProcedure = publicProcedure.use(requireAuth);

/**
 * Scope check (SPEC §6).
 *
 * A browser session has every right; an API key must carry the requested scope
 * (`admin` implies them all).
 */
export function requireScope(scope: ApiKeyScope) {
	return o.middleware(async ({ context, next }) => {
		if (context.apiKey && !hasScope(context.apiKey.scopes, scope)) {
			throw new ORPCError("FORBIDDEN", {
				message: `This API key does not have the "${scope}" scope.`,
			});
		}
		return next();
	});
}

/** Mutation procedure: rejected for API keys without the `write` scope. */
export const writeProcedure = protectedProcedure.use(requireScope("write"));

/** Administration (API keys, settings): `admin` scope required. */
export const adminProcedure = protectedProcedure.use(requireScope("admin"));
