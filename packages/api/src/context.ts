import { auth } from "@docstore/auth";
import { type Db, db as defaultDb } from "@docstore/db";
import type { IngestionBinding } from "@docstore/ingestion";
import type { ApiKeyPrincipal } from "@docstore/shared/api-key";
import type { Context as HonoContext } from "hono";
import { authenticateApiKey, loadApiKeyUser } from "./services/api-key.service";

export type CreateContextOptions = {
	context: HonoContext;
	/** Allows injecting a test database instead of the global connection. */
	db?: Db;
	/** Ingestion pipeline (storage + queue), injected by the server. */
	ingestion?: IngestionBinding;
	/**
	 * API key already resolved by the Hono `apiKeyAuth` middleware. When absent,
	 * it is resolved here from the request headers.
	 */
	apiKey?: ApiKeyPrincipal | null;
};

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

export type CreateContextResult = {
	auth: null;
	session: Session;
	db: Db;
	ingestion?: IngestionBinding;
	/** Set when the caller authenticates with an API key (SPEC §6). */
	apiKey?: { id: string; scopes: ApiKeyPrincipal["scopes"] };
};

/**
 * Minimal session built for an API key: protected procedures only read
 * `session.user`, but the Better Auth type requires the wrapper.
 */
async function sessionForApiKey(
	db: Db,
	principal: ApiKeyPrincipal,
): Promise<Session> {
	const user = await loadApiKeyUser(db, principal.userId);
	if (!user) return null;
	const now = new Date();
	return {
		session: {
			id: `apikey:${principal.id}`,
			token: principal.id,
			userId: user.id,
			expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
			createdAt: now,
			updatedAt: now,
			ipAddress: null,
			userAgent: null,
		},
		user,
	} as NonNullable<Session>;
}

/**
 * `ingestion` is optional: tests build a context without it.
 *
 * Two authentication methods coexist: the Better Auth cookie (browser) and the
 * API key (`Authorization: Bearer dsk_…` or `X-API-Key`). The key wins when it
 * is present.
 */
export async function createContext({
	context,
	db = defaultDb,
	ingestion,
	apiKey,
}: CreateContextOptions): Promise<CreateContextResult> {
	const headers = context.req.raw.headers;
	const principal =
		apiKey === undefined ? await authenticateApiKey(db, headers) : apiKey;

	if (principal) {
		const session = await sessionForApiKey(db, principal);
		return {
			auth: null,
			session,
			db,
			ingestion,
			apiKey: { id: principal.id, scopes: principal.scopes },
		};
	}

	const session = await auth.api.getSession({ headers });
	return {
		auth: null,
		session,
		db,
		ingestion,
	};
}

export type Context = CreateContextResult;
export type { Session };
