import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "@docstore/db";
import { document, documentFile } from "@docstore/db/schema/document";
import { documentDossier, dossier } from "@docstore/db/schema/dossier";
import type { ShareLinkRow } from "@docstore/db/schema/share";
import { shareLink } from "@docstore/db/schema/share";
import type {
	CreateShareLinkInput,
	ListShareLinksInput,
	PublicShare,
	ShareItem,
	ShareLink,
	ShareLinkKind,
	ShareLinkWithUrl,
} from "@docstore/shared/share-link";
import {
	SHARE_ACCESS_TTL_MS,
	SHARE_LINK_TOKEN_LENGTH,
} from "@docstore/shared/share-link";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRASHED_DOCUMENT_MESSAGE } from "./document.service";
import { assertFutureExpiry } from "./expiry";
import { publicBaseUrl, randomToken } from "./upload-link.service";

/**
 * Share links (SPEC §2 "Misc").
 *
 * Like the upload links, the 32-character token is the only key of the public
 * URL; everything else (password, expiry, quota, revocation) narrows what that
 * key opens. Documents flagged `sensitive` are never shareable — their content
 * only leaves the store through an authenticated route.
 */

/** Web page shown to the visitor; it reads the API under `/api/s/<token>`. */
export function shareLinkUrl(token: string): string {
	return `${publicBaseUrl()}/s/${token}`;
}

export function generateShareToken(
	length: number = SHARE_LINK_TOKEN_LENGTH,
): string {
	return randomToken(length);
}

function kindOf(row: ShareLinkRow): ShareLinkKind {
	return row.documentId ? "document" : "dossier";
}

function toShareLink(row: ShareLinkRow, targetTitle: string): ShareLink {
	return {
		id: row.id,
		token: row.token,
		kind: kindOf(row),
		documentId: row.documentId,
		dossierId: row.dossierId,
		targetTitle,
		expiresAt: row.expiresAt,
		hasPassword: row.passwordHash !== null,
		maxViews: row.maxViews,
		views: row.views,
		allowDownload: row.allowDownload,
		createdById: row.createdById,
		createdAt: row.createdAt,
		revokedAt: row.revokedAt,
		revokedReason: row.revokedReason,
		url: shareLinkUrl(row.token),
	};
}

/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

export interface ShareLinkState {
	revoked: boolean;
	expired: boolean;
	/** View quota reached. */
	exhausted: boolean;
	/** Nothing blocks it: the link still serves its content. */
	usable: boolean;
}

export function shareLinkState(
	row: ShareLinkRow,
	now: Date = new Date(),
): ShareLinkState {
	const revoked = row.revokedAt !== null;
	const expired =
		row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();
	const exhausted = row.maxViews !== null && row.views >= row.maxViews;
	return {
		revoked,
		expired,
		exhausted,
		usable: !revoked && !expired && !exhausted,
	};
}

/* ------------------------------------------------------------------ */
/* Targets                                                              */
/* ------------------------------------------------------------------ */

/** Title of the shared object; `NOT_FOUND` if it no longer exists. */
async function loadTargetTitle(db: Db, row: ShareLinkRow): Promise<string> {
	if (row.documentId) {
		const [found] = await db
			.select({ title: document.title })
			.from(document)
			.where(eq(document.id, row.documentId))
			.limit(1);
		return found?.title ?? "";
	}
	const [found] = await db
		.select({ name: dossier.name })
		.from(dossier)
		.where(eq(dossier.id, row.dossierId ?? ""))
		.limit(1);
	return found?.name ?? "";
}

/** Titles of every share target in one round trip (list screen). */
async function loadTargetTitles(
	db: Db,
	rows: ShareLinkRow[],
): Promise<Map<string, string>> {
	const titles = new Map<string, string>();
	const documentIds = rows
		.map((row) => row.documentId)
		.filter((value): value is string => value !== null);
	const dossierIds = rows
		.map((row) => row.dossierId)
		.filter((value): value is string => value !== null);

	if (documentIds.length > 0) {
		const found = await db
			.select({ id: document.id, title: document.title })
			.from(document)
			.where(inArray(document.id, documentIds));
		for (const item of found) titles.set(item.id, item.title);
	}
	if (dossierIds.length > 0) {
		const found = await db
			.select({ id: dossier.id, name: dossier.name })
			.from(dossier)
			.where(inArray(dossier.id, dossierIds));
		for (const item of found) titles.set(item.id, item.name);
	}
	return titles;
}

/**
 * Documents actually reachable through a link.
 *
 * Trashed and sensitive documents are filtered out here as well as at creation
 * time: a dossier can gain a sensitive document after the link was minted, and
 * the public route must never serve it.
 */
export async function shareItems(
	db: Db,
	row: ShareLinkRow,
): Promise<ShareItem[]> {
	const scope = row.documentId
		? eq(document.id, row.documentId)
		: sql`exists (
				select 1 from ${documentDossier}
				where ${documentDossier.documentId} = ${document.id}
					and ${documentDossier.dossierId} = ${row.dossierId ?? ""}
			)`;

	const documents = await db
		.select({
			id: document.id,
			title: document.title,
			documentDate: document.documentDate,
			datePrecision: document.datePrecision,
		})
		.from(document)
		.where(
			and(scope, isNull(document.deletedAt), eq(document.sensitive, false)),
		)
		.orderBy(desc(document.documentDate), asc(document.id));

	if (documents.length === 0) return [];

	const files = await db
		.select({
			id: documentFile.id,
			documentId: documentFile.documentId,
			kind: documentFile.kind,
			mime: documentFile.mime,
			pageCount: documentFile.pageCount,
			createdAt: documentFile.createdAt,
		})
		.from(documentFile)
		.where(
			inArray(
				documentFile.documentId,
				documents.map((item) => item.id),
			),
		)
		.orderBy(asc(documentFile.createdAt), asc(documentFile.id));

	// One file per document: the original, otherwise the oldest one.
	const primary = new Map<string, (typeof files)[number]>();
	for (const file of files) {
		const current = primary.get(file.documentId);
		if (!current || (file.kind === "original" && current.kind !== "original")) {
			primary.set(file.documentId, file);
		}
	}

	return documents.map((item) => {
		const file = primary.get(item.id);
		return {
			id: item.id,
			title: item.title,
			documentDate: item.documentDate,
			datePrecision: item.datePrecision,
			pageCount: file?.pageCount ?? null,
			mime: file?.mime ?? null,
			fileId: file?.id ?? null,
		};
	});
}

/** Public payload of `GET /api/s/:token`; `items` stays empty until unlocked. */
export async function toPublicShare(
	db: Db,
	row: ShareLinkRow,
	options: { unlocked: boolean; now?: Date },
): Promise<PublicShare> {
	const state = shareLinkState(row, options.now);
	const requiresPassword = row.passwordHash !== null;
	const reveal = state.usable && (!requiresPassword || options.unlocked);
	return {
		kind: kindOf(row),
		title: await loadTargetTitle(db, row),
		requiresPassword,
		expired: state.expired || state.exhausted,
		revoked: state.revoked,
		allowDownload: row.allowDownload,
		items: reveal ? await shareItems(db, row) : [],
	};
}

/* ------------------------------------------------------------------ */
/* Management (oRPC)                                                    */
/* ------------------------------------------------------------------ */

export async function listShareLinks(
	db: Db,
	input: ListShareLinksInput,
): Promise<ShareLink[]> {
	const conditions = [];
	if (input.documentId) {
		conditions.push(eq(shareLink.documentId, input.documentId));
	}
	if (input.dossierId) {
		conditions.push(eq(shareLink.dossierId, input.dossierId));
	}
	if (!input.includeInactive) {
		conditions.push(isNull(shareLink.revokedAt));
	}

	const rows = await db
		.select()
		.from(shareLink)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(shareLink.createdAt), desc(shareLink.id));

	const titles = await loadTargetTitles(db, rows);
	return rows.map((row) =>
		toShareLink(row, titles.get(row.documentId ?? row.dossierId ?? "") ?? ""),
	);
}

/** A sensitive document never leaves through a public link. */
async function assertShareable(
	db: Db,
	input: CreateShareLinkInput,
): Promise<void> {
	if (input.documentId) {
		const [found] = await db
			.select({ sensitive: document.sensitive, deletedAt: document.deletedAt })
			.from(document)
			.where(eq(document.id, input.documentId))
			.limit(1);
		if (!found) {
			throw new ORPCError("NOT_FOUND", {
				message: `Document "${input.documentId}" not found.`,
			});
		}
		if (found.sensitive) {
			throw new ORPCError("BAD_REQUEST", {
				message: "A sensitive document cannot be shared.",
			});
		}
		if (found.deletedAt) {
			// Same `CONFLICT` as every other write refused on a trashed document:
			// the caller reads one message, not two (SPEC §2).
			throw new ORPCError("CONFLICT", {
				message: TRASHED_DOCUMENT_MESSAGE,
			});
		}
		return;
	}

	const dossierId = input.dossierId ?? "";
	const [found] = await db
		.select({ id: dossier.id })
		.from(dossier)
		.where(eq(dossier.id, dossierId))
		.limit(1);
	if (!found) {
		throw new ORPCError("NOT_FOUND", {
			message: `Dossier "${dossierId}" not found.`,
		});
	}

	const [sensitive] = await db
		.select({ id: document.id })
		.from(document)
		.innerJoin(documentDossier, eq(documentDossier.documentId, document.id))
		.where(
			and(
				eq(documentDossier.dossierId, dossierId),
				eq(document.sensitive, true),
				isNull(document.deletedAt),
			),
		)
		.limit(1);
	if (sensitive) {
		throw new ORPCError("BAD_REQUEST", {
			message: "This dossier holds a sensitive document: it cannot be shared.",
		});
	}
}

export async function createShareLink(
	db: Db,
	createdById: string,
	input: CreateShareLinkInput,
): Promise<ShareLinkWithUrl> {
	assertFutureExpiry(input.expiresAt);
	await assertShareable(db, input);

	const rows = await db
		.insert(shareLink)
		.values({
			token: generateShareToken(),
			documentId: input.documentId ?? null,
			dossierId: input.dossierId ?? null,
			expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
			passwordHash: input.password
				? await Bun.password.hash(input.password)
				: null,
			maxViews: input.maxViews ?? null,
			allowDownload: input.allowDownload,
			createdById,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The share link could not be created.",
		});
	}
	const link = toShareLink(row, await loadTargetTitle(db, row));
	return { link, url: link.url };
}

async function requireRow(db: Db, id: string): Promise<ShareLinkRow> {
	const rows = await db
		.select()
		.from(shareLink)
		.where(eq(shareLink.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Share link "${id}" not found.`,
		});
	}
	return row;
}

export async function revokeShareLink(db: Db, id: string): Promise<ShareLink> {
	const existing = await requireRow(db, id);
	const rows = await db
		.update(shareLink)
		.set({
			revokedAt: existing.revokedAt ?? new Date(),
			// An already revoked link keeps the reason it was revoked for.
			revokedReason: existing.revokedReason ?? "manual",
		})
		.where(eq(shareLink.id, id))
		.returning();
	const row = rows[0] ?? existing;
	return toShareLink(row, await loadTargetTitle(db, row));
}

export async function deleteShareLink(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	await requireRow(db, id);
	await db.delete(shareLink).where(eq(shareLink.id, id));
	return { id, deleted: true };
}

/* ------------------------------------------------------------------ */
/* Public side (`/api/s/:token`)                                        */
/* ------------------------------------------------------------------ */

export async function findShareLinkByToken(
	db: Db,
	token: string,
): Promise<ShareLinkRow | null> {
	const rows = await db
		.select()
		.from(shareLink)
		.where(eq(shareLink.token, token))
		.limit(1);
	return rows[0] ?? null;
}

export async function verifySharePassword(
	row: ShareLinkRow,
	password: string,
): Promise<boolean> {
	if (!row.passwordHash) return true;
	try {
		return await Bun.password.verify(password, row.passwordHash);
	} catch {
		return false;
	}
}

/** Increments the view counter (once per token + IP per hour, see the route). */
export async function consumeShareView(db: Db, id: string): Promise<void> {
	await db
		.update(shareLink)
		.set({ views: sql`${shareLink.views} + 1` })
		.where(eq(shareLink.id, id));
}

/**
 * The file must belong to a document the link actually opens; `false` for
 * anything else (other document, sensitive, trashed).
 */
export async function shareFileTarget(
	db: Db,
	row: ShareLinkRow,
	fileId: string,
): Promise<{ documentId: string } | null> {
	const items = await shareItems(db, row);
	if (items.length === 0) return null;
	const [file] = await db
		.select({ documentId: documentFile.documentId })
		.from(documentFile)
		.where(eq(documentFile.id, fileId))
		.limit(1);
	if (!file) return null;
	return items.some((item) => item.id === file.documentId) ? file : null;
}

/* ------------------------------------------------------------------ */
/* Access tokens (`POST /api/s/:token/unlock`)                          */
/* ------------------------------------------------------------------ */

/**
 * Short-lived proof that the password was verified.
 *
 * `<linkId>.<expiryMs>.<HMAC-SHA256>` signed with `APP_SECRET`: nothing is
 * stored server-side, and the token is worthless for any other link. The SPA
 * keeps it in memory and passes it as `?access=…`.
 */
export function issueShareAccessToken(
	linkId: string,
	secret: string,
	now: Date = new Date(),
	ttlMs: number = SHARE_ACCESS_TTL_MS,
): { accessToken: string; expiresIn: number } {
	const expiresAt = now.getTime() + ttlMs;
	const payload = `${linkId}.${expiresAt}`;
	const signature = createHmac("sha256", secret)
		.update(payload)
		.digest("base64url");
	return {
		accessToken: `${payload}.${signature}`,
		expiresIn: Math.floor(ttlMs / 1000),
	};
}

export function verifyShareAccessToken(
	accessToken: string | undefined | null,
	linkId: string,
	secret: string,
	now: Date = new Date(),
): boolean {
	if (!accessToken) return false;
	const parts = accessToken.split(".");
	if (parts.length !== 3) return false;
	const [id, expiry, signature] = parts as [string, string, string];
	if (id !== linkId) return false;
	const expiresAt = Number(expiry);
	if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return false;

	const expected = createHmac("sha256", secret)
		.update(`${id}.${expiry}`)
		.digest("base64url");
	const a = Buffer.from(signature);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}
