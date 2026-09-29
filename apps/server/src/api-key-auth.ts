import {
	authenticateApiKey,
	extractApiKeySecret,
} from "@docstore/api/services/api-key.service";
import type { Db } from "@docstore/db";
import type { ApiKeyPrincipal } from "@docstore/shared/api-key";
import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";

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

/**
 * Address of the TCP peer, the fallback when no proxy header names the client
 * (`bun run dev`, a server exposed directly). `null` outside a Bun server
 * (`app.request` in the tests).
 */
function peerAddress(c: Context): string | null {
	try {
		const address = getConnInfo(c).remote.address;
		// An IPv4 client on a dual-stack socket reads `::ffff:203.0.113.7`.
		return address ? address.replace(/^::ffff:/, "") : null;
	} catch {
		return null;
	}
}

export function apiKeyAuth(options: { db: Db }): MiddlewareHandler {
	return async (c, next) => {
		const principal = await authenticateApiKey(
			options.db,
			c.req.raw.headers,
			peerAddress(c),
		);
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
