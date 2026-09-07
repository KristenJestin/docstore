import { randomBytes } from "node:crypto";
import type { Db } from "@docstore/db";
import type { UploadLinkRow } from "@docstore/db/schema/intake";
import { uploadLink } from "@docstore/db/schema/intake";
import type {
	CreateUploadLinkInput,
	PublicUploadLink,
	UpdateUploadLinkInput,
	UploadLink,
	UploadLinkWithUrl,
} from "@docstore/shared/upload-link";
import { UPLOAD_LINK_TOKEN_LENGTH } from "@docstore/shared/upload-link";
import { ORPCError } from "@orpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { assertFutureExpiry } from "./expiry";
import { assertIntakeDefaults } from "./intake-defaults.service";

/**
 * Public upload links (SPEC §2 "Misc").
 *
 * The token is the only protection: it is drawn at random over 32 characters
 * (≈ 190 bits of entropy with this alphabet) and never derived from guessable
 * data.
 */

/** Alphabet without ambiguous characters, safe in a URL and when dictated. */
const TOKEN_ALPHABET =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";

/** Random token over the unambiguous alphabet, shared with the share links. */
export function randomToken(length: number): string {
	const bytes = randomBytes(length);
	let token = "";
	for (const byte of bytes) {
		token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
	}
	return token;
}

export function generateUploadToken(
	length: number = UPLOAD_LINK_TOKEN_LENGTH,
): string {
	return randomToken(length);
}

/**
 * Origin of the public URLs: `PUBLIC_URL`, otherwise `BETTER_AUTH_URL`.
 *
 * This is the **web** origin, the one a third party types in a browser — not
 * the API. The pages it serves (`/u/<token>`, `/s/<token>`) then call the API
 * under `/api/...` on the same origin.
 *
 * Read lazily rather than through `@docstore/env`: this service must stay
 * callable in tests, where only part of the environment exists.
 */
export function publicBaseUrl(): string {
	const base = process.env.PUBLIC_URL || process.env.BETTER_AUTH_URL || "";
	return base.replace(/\/+$/, "");
}

/** Web page where the third party uploads (not `POST /api/u/<token>`). */
export function uploadLinkUrl(token: string): string {
	return `${publicBaseUrl()}/u/${token}`;
}

function toUploadLink(row: UploadLinkRow): UploadLink {
	return {
		url: uploadLinkUrl(row.token),
		id: row.id,
		token: row.token,
		name: row.name,
		message: row.message,
		expiresAt: row.expiresAt,
		maxUses: row.maxUses,
		uses: row.uses,
		defaults: row.defaults,
		enabled: row.enabled,
		createdById: row.createdById,
		createdAt: row.createdAt,
	};
}

export async function listUploadLinks(db: Db): Promise<UploadLink[]> {
	const rows = await db
		.select()
		.from(uploadLink)
		.orderBy(desc(uploadLink.createdAt), desc(uploadLink.id));
	return rows.map(toUploadLink);
}

async function requireRow(db: Db, id: string): Promise<UploadLinkRow> {
	const rows = await db
		.select()
		.from(uploadLink)
		.where(eq(uploadLink.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Upload link "${id}" not found.`,
		});
	}
	return row;
}

export async function createUploadLink(
	db: Db,
	createdById: string,
	input: CreateUploadLinkInput,
): Promise<UploadLinkWithUrl> {
	assertFutureExpiry(input.expiresAt);
	await assertIntakeDefaults(db, input.defaults);
	const rows = await db
		.insert(uploadLink)
		.values({
			token: generateUploadToken(),
			name: input.name,
			message: input.message ?? null,
			expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
			maxUses: input.maxUses ?? null,
			defaults: input.defaults,
			enabled: input.enabled,
			createdById,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The upload link could not be created.",
		});
	}
	const link = toUploadLink(row);
	return { link, url: link.url };
}

export async function updateUploadLink(
	db: Db,
	input: UpdateUploadLinkInput,
): Promise<UploadLink> {
	const existing = await requireRow(db, input.id);
	assertFutureExpiry(input.expiresAt);
	if (input.defaults) await assertIntakeDefaults(db, input.defaults);
	const rows = await db
		.update(uploadLink)
		.set({
			name: input.name ?? existing.name,
			message:
				input.message === undefined
					? existing.message
					: (input.message ?? null),
			expiresAt:
				input.expiresAt === undefined
					? existing.expiresAt
					: input.expiresAt
						? new Date(input.expiresAt)
						: null,
			maxUses:
				input.maxUses === undefined
					? existing.maxUses
					: (input.maxUses ?? null),
			defaults: input.defaults ?? existing.defaults,
			enabled: input.enabled ?? existing.enabled,
		})
		.where(eq(uploadLink.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Upload link "${input.id}" not found.`,
		});
	}
	return toUploadLink(row);
}

export async function disableUploadLink(
	db: Db,
	id: string,
): Promise<UploadLink> {
	await requireRow(db, id);
	const rows = await db
		.update(uploadLink)
		.set({ enabled: false })
		.where(eq(uploadLink.id, id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Upload link "${id}" not found.`,
		});
	}
	return toUploadLink(row);
}

export async function deleteUploadLink(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	await requireRow(db, id);
	await db.delete(uploadLink).where(eq(uploadLink.id, id));
	return { id, deleted: true };
}

/* ------------------------------------------------------------------ */
/* Public side (`/api/u/:token`)                                        */
/* ------------------------------------------------------------------ */

export async function findUploadLinkByToken(
	db: Db,
	token: string,
): Promise<UploadLinkRow | null> {
	const rows = await db
		.select()
		.from(uploadLink)
		.where(eq(uploadLink.token, token))
		.limit(1);
	return rows[0] ?? null;
}

/** Used up, expired or disabled: the link no longer accepts uploads. */
export function isUploadLinkUsable(
	row: UploadLinkRow,
	now: Date = new Date(),
): boolean {
	if (!row.enabled) return false;
	if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
	if (row.maxUses !== null && row.uses >= row.maxUses) return false;
	return true;
}

export function toPublicUploadLink(
	row: UploadLinkRow,
	now: Date = new Date(),
): PublicUploadLink {
	return {
		name: row.name,
		message: row.message,
		expired: !isUploadLinkUsable(row, now),
		remainingUses:
			row.maxUses === null ? null : Math.max(0, row.maxUses - row.uses),
	};
}

/** Increments the use counter (one upload = one use). */
export async function consumeUploadLink(db: Db, id: string): Promise<void> {
	await db
		.update(uploadLink)
		.set({ uses: sql`${uploadLink.uses} + 1` })
		.where(eq(uploadLink.id, id));
}
