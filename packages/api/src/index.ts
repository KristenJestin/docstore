import { type Actor, runAsActor } from "@docstore/ingestion";
import type { ApiKeyScope } from "@docstore/shared/api-key";
import { hasScope } from "@docstore/shared/api-key";
import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

/**
 * Who calls, for the activity log (issue #15): the API key when the request
 * carries one, else the session user.
 */
export function actorOf(context: Context): Actor | null {
	const user = context.session?.user;
	if (!user) return null;
	if (context.apiKey) {
		return {
			type: "api_key",
			apiKeyId: context.apiKey.id,
			userId: user.id,
			name: context.apiKey.name ?? null,
		};
	}
	return { type: "user", userId: user.id, name: user.name };
}

/**
 * Authentication, and the actor of every service call the procedure makes:
 * the handler runs inside `runAsActor`, so the services write their activity
 * entries on behalf of the caller without taking it as a parameter.
 */
const requireAuth = o.middleware(async ({ context, next }) => {
	const actor = actorOf(context);
	if (!context.session?.user || !actor) {
		throw new ORPCError("UNAUTHORIZED");
	}
	const session = context.session;
	return runAsActor(actor, () => next({ context: { session } }));
});

/**
 * Authenticated caller, no scope checked. Only the bases below build on it:
 * pick `protectedProcedure`, `writeProcedure` or `adminProcedure`.
 */
const authenticatedProcedure = publicProcedure.use(requireAuth);

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

/**
 * Read procedure, the default: rejected for API keys without the `read` scope.
 * Reading the content of a sensitive document also takes `sensitive`, which the
 * procedure checks itself (`mayReadSensitive`).
 */
export const protectedProcedure = authenticatedProcedure.use(
	requireScope("read"),
);

/** Mutation procedure: rejected for API keys without the `write` scope. */
export const writeProcedure = authenticatedProcedure.use(requireScope("write"));

/** Administration (API keys, settings): `admin` scope required. */
export const adminProcedure = authenticatedProcedure.use(requireScope("admin"));
