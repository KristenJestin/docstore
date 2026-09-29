import { z } from "zod";
import { futureDatetimeSchema } from "./common";

/**
 * API keys (SPEC §6): authentication for MCP agents and scripts, without a
 * session cookie. The secret is only visible at creation time.
 */

/**
 * Scopes granted to a key:
 * - `read`: read documents and taxonomy;
 * - `write`: every mutation;
 * - `sensitive`: access to the content of documents marked Sensitive (files,
 *   OCR text, custom field values, notes);
 * - `admin`: settings and administration (reserved, v1).
 */
export const API_KEY_SCOPES = ["read", "write", "sensitive", "admin"] as const;

export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

/** Recognizable prefix of the plaintext secret. */
export const API_KEY_PREFIX = "dsk_";

/** Length of the random part of the secret (after `dsk_`). */
export const API_KEY_SECRET_LENGTH = 40;

/** Number of characters kept in plaintext for display. */
export const API_KEY_DISPLAY_PREFIX_LENGTH = 8;

export const apiKeySchema = z.object({
	id: z.string(),
	name: z.string(),
	/** First eight characters of the secret, to recognize the key. */
	prefix: z.string(),
	scopes: z.array(apiKeyScopeSchema),
	userId: z.string(),
	/** Last authenticated request, refreshed at most once a minute. */
	lastUsedAt: z.date().nullable(),
	/** Client address of that request. */
	lastUsedIp: z.string().nullable(),
	expiresAt: z.date().nullable(),
	revokedAt: z.date().nullable(),
	createdAt: z.date(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const createApiKeyInput = z.object({
	name: z.string().trim().min(1).max(120),
	scopes: z.array(apiKeyScopeSchema).min(1),
	/** Optional expiry, in the future; absent = key that never expires. */
	expiresAt: futureDatetimeSchema.nullish(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeyInput>;

/** The plaintext secret is only returned here, never read again. */
export const createApiKeyResultSchema = z.object({
	key: apiKeySchema,
	secret: z.string(),
});
export type CreateApiKeyResult = z.infer<typeof createApiKeyResultSchema>;

/** Caller authenticated by key: what the oRPC/MCP context carries. */
export const apiKeyPrincipalSchema = z.object({
	id: z.string(),
	/** Name of the key: the activity log and the webhooks show it. */
	name: z.string().optional(),
	userId: z.string(),
	scopes: z.array(apiKeyScopeSchema),
});
export type ApiKeyPrincipal = z.infer<typeof apiKeyPrincipalSchema>;

/** `admin` implies every other scope. */
export function hasScope(
	scopes: readonly ApiKeyScope[],
	required: ApiKeyScope,
): boolean {
	return scopes.includes("admin") || scopes.includes(required);
}

/**
 * Caller of a read, as the scope checks see it: the scopes of an API key, or
 * `null` / `undefined` for a browser session, which keeps every right.
 */
export type ScopedCaller =
	| { scopes: readonly ApiKeyScope[] }
	| null
	| undefined;

/** Scope check shared by every surface: a session passes, a key needs it. */
export function callerHasScope(
	caller: ScopedCaller,
	required: ApiKeyScope,
): boolean {
	return !caller || hasScope(caller.scopes, required);
}

/**
 * The one decision on sensitive content (file bytes, thumbnail, OCR text, OCR
 * layout), used by MCP, oRPC and the `/files` routes so they cannot drift.
 */
export function mayReadSensitive(caller: ScopedCaller): boolean {
	return callerHasScope(caller, "sensitive");
}

/** Text returned instead of the OCR text of a sensitive document. */
export const SENSITIVE_PLACEHOLDER =
	"[sensitive document: `sensitive` scope required]";

/**
 * What a caller without the `sensitive` scope may see of a sensitive document
 * (issue #22): its metadata (title, dates, period, category, tags, Parties,
 * document type), never what it says. The OCR text becomes
 * {@link SENSITIVE_PLACEHOLDER}, the custom field values an empty list and the
 * notes `null`; `masked` says which happened. `fieldValues` and `notes` are
 * only touched when the shape carries them (`document.trash` returns neither
 * values nor relations).
 *
 * The one helper every surface applies where a document leaves the service
 * layer (oRPC, MCP tools, MCP resource), so they cannot drift.
 */
export function maskSensitiveDocument<
	T extends {
		sensitive: boolean;
		content: string | null;
		notes?: string | null;
		fieldValues?: readonly unknown[];
	},
>(document: T, caller: ScopedCaller): T & { masked: boolean } {
	if (!document.sensitive || mayReadSensitive(caller)) {
		return { ...document, masked: false };
	}
	return {
		...document,
		content: document.content === null ? null : SENSITIVE_PLACEHOLDER,
		...("notes" in document ? { notes: null } : {}),
		...("fieldValues" in document ? { fieldValues: [] } : {}),
		masked: true,
	};
}
