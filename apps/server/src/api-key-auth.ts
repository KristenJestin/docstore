import {
	authenticateApiKey,
	extractApiKeySecret,
} from "@docstore/api/services/api-key.service";
import type { Db } from "@docstore/db";
import type { ApiKeyPrincipal } from "@docstore/shared/api-key";
import type { Context, MiddlewareHandler } from "hono";

/**
 * API key authentication (SPEC §6).
 *
 * The middleware rejects nothing: it resolves the key when the request carries
 * one (`Authorization: Bearer dsk_…` or `X-API-Key`) and stores it in the Hono
 * context. Routes that require it call `requireApiKeyPrincipal`.
 */

/** Hono variables set by `apiKeyAuth`. */
export type ApiKeyVariables = {
	apiKeyPrincipal: ApiKeyPrincipal | null;
};

export function apiKeyAuth(options: { db: Db }): MiddlewareHandler {
	return async (c, next) => {
		const principal = await authenticateApiKey(options.db, c.req.raw.headers);
		c.set("apiKeyPrincipal", principal);
		await next();
	};
}

/** Key resolved by the middleware, or `null` when the request carries none. */
export function apiKeyPrincipal(c: Context): ApiKeyPrincipal | null {
	return (c.get("apiKeyPrincipal") as ApiKeyPrincipal | undefined) ?? null;
}

/** True when the request presents an API key secret (valid or not). */
export function carriesApiKey(c: Context): boolean {
	return extractApiKeySecret(c.req.raw.headers) !== null;
}
