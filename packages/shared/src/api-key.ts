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
 * - `sensitive`: access to the text of documents marked Sensitive;
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
	lastUsedAt: z.date().nullable(),
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
