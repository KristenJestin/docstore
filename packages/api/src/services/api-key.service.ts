import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@docstore/db";
import { apiKey as apiKeyTable } from "@docstore/db/schema/api-key";
import { user as userTable } from "@docstore/db/schema/auth";
import type {
	ApiKey,
	ApiKeyPrincipal,
	CreateApiKeyInput,
	CreateApiKeyResult,
} from "@docstore/shared/api-key";
import {
	API_KEY_DISPLAY_PREFIX_LENGTH,
	API_KEY_PREFIX,
	API_KEY_SECRET_LENGTH,
} from "@docstore/shared/api-key";
import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { assertFutureExpiry } from "./expiry";

/**
 * API keys (SPEC §6).
 *
 * The secret is never stored: the table only keeps its sha256 and the first
 * eight characters, which are only used to recognise the key.
 */

/** Alphabet without ambiguous characters, safe in an HTTP header. */
const SECRET_ALPHABET =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";

/** Generates `dsk_` + 40 random characters. */
export function generateApiKeySecret(): string {
	const bytes = randomBytes(API_KEY_SECRET_LENGTH);
	let secret = "";
	for (const byte of bytes) {
		// The modulo bias is negligible here (59 values out of 256).
		secret += SECRET_ALPHABET[byte % SECRET_ALPHABET.length];
	}
	return `${API_KEY_PREFIX}${secret}`;
}

/** Hexadecimal sha256 of the full secret. */
export function hashApiKey(secret: string): string {
	return createHash("sha256").update(secret, "utf8").digest("hex");
}

type ApiKeyRow = typeof apiKeyTable.$inferSelect;

function toApiKey(row: ApiKeyRow): ApiKey {
	return {
		id: row.id,
		name: row.name,
		prefix: row.prefix,
		scopes: row.scopes,
		userId: row.userId,
		lastUsedAt: row.lastUsedAt,
		expiresAt: row.expiresAt,
		revokedAt: row.revokedAt,
		createdAt: row.createdAt,
	};
}

export async function listApiKeys(db: Db, userId: string): Promise<ApiKey[]> {
	const rows = await db
		.select()
		.from(apiKeyTable)
		.where(eq(apiKeyTable.userId, userId))
		.orderBy(desc(apiKeyTable.createdAt));
	return rows.map(toApiKey);
}

/** The plaintext secret is only returned here: it is unreadable afterwards. */
export async function createApiKey(
	db: Db,
	userId: string,
	input: CreateApiKeyInput,
): Promise<CreateApiKeyResult> {
	assertFutureExpiry(input.expiresAt);
	const secret = generateApiKeySecret();
	const rows = await db
		.insert(apiKeyTable)
		.values({
			name: input.name,
			hashedKey: hashApiKey(secret),
			prefix: secret.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH),
			scopes: input.scopes,
			userId,
			expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The API key could not be created.",
		});
	}
	return { key: toApiKey(row), secret };
}

async function requireApiKeyRow(
	db: Db,
	id: string,
	userId: string,
): Promise<ApiKeyRow> {
	const rows = await db
		.select()
		.from(apiKeyTable)
		.where(and(eq(apiKeyTable.id, id), eq(apiKeyTable.userId, userId)))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `API key "${id}" not found.`,
		});
	}
	return row;
}

/** Revocation: the key stays visible but no longer authenticates. */
export async function revokeApiKey(
	db: Db,
	id: string,
	userId: string,
): Promise<ApiKey> {
	const existing = await requireApiKeyRow(db, id, userId);
	if (existing.revokedAt) {
		return toApiKey(existing);
	}
	const rows = await db
		.update(apiKeyTable)
		.set({ revokedAt: new Date() })
		.where(eq(apiKeyTable.id, id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `API key "${id}" not found.`,
		});
	}
	return toApiKey(row);
}

export async function deleteApiKey(
	db: Db,
	id: string,
	userId: string,
): Promise<{ id: string; deleted: true }> {
	await requireApiKeyRow(db, id, userId);
	await db.delete(apiKeyTable).where(eq(apiKeyTable.id, id));
	return { id, deleted: true };
}

/** `last_used_at` is only rewritten beyond this freshness (one minute). */
export const LAST_USED_THROTTLE_MS = 60_000;

/** Extracts the secret from an `Authorization: Bearer …` or an `X-API-Key`. */
export function extractApiKeySecret(headers: Headers): string | null {
	const header = headers.get("authorization");
	if (header) {
		const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
		const bearer = match?.[1];
		if (bearer?.startsWith(API_KEY_PREFIX)) {
			return bearer;
		}
	}
	const direct = headers.get("x-api-key")?.trim();
	if (direct?.startsWith(API_KEY_PREFIX)) {
		return direct;
	}
	return null;
}

/**
 * Resolves a plaintext secret: `null` if the key is unknown, revoked or
 * expired. `last_used_at` is refreshed at most once per minute.
 */
export async function resolveApiKey(
	db: Db,
	secret: string,
	now: Date = new Date(),
): Promise<ApiKeyPrincipal | null> {
	const rows = await db
		.select()
		.from(apiKeyTable)
		.where(eq(apiKeyTable.hashedKey, hashApiKey(secret)))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	if (row.revokedAt) return null;
	if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;

	const stale =
		!row.lastUsedAt ||
		now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS;
	if (stale) {
		await db
			.update(apiKeyTable)
			.set({ lastUsedAt: now })
			.where(eq(apiKeyTable.id, row.id));
	}

	return { id: row.id, userId: row.userId, scopes: row.scopes };
}

/** Resolves the key carried by an HTTP request, if it carries one. */
export async function authenticateApiKey(
	db: Db,
	headers: Headers,
): Promise<ApiKeyPrincipal | null> {
	const secret = extractApiKeySecret(headers);
	if (!secret) return null;
	return resolveApiKey(db, secret);
}

export interface ApiKeyUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/** User owning the key: used to build a minimal session. */
export async function loadApiKeyUser(
	db: Db,
	userId: string,
): Promise<ApiKeyUser | null> {
	const rows = await db
		.select()
		.from(userTable)
		.where(eq(userTable.id, userId))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		emailVerified: row.emailVerified,
		image: row.image,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
