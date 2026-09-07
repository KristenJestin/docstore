import { z } from "zod";
import { futureDatetimeSchema } from "./common";
import { datePrecisionSchema } from "./document";

/**
 * Share links (SPEC §2 "Misc"): a public, unauthenticated URL onto a document
 * or a dossier, protected by the token alone — plus, optionally, a password, an
 * expiry and a view quota.
 *
 * `/s/<token>` is the **web** page handed to the visitor; it reads the API
 * under `/api/s/<token>` on the same origin.
 */

/** Length of the public token (`/s/<token>`). */
export const SHARE_LINK_TOKEN_LENGTH = 32;

/** Lifetime of the access token handed out by `POST /api/s/:token/unlock`. */
export const SHARE_ACCESS_TTL_MS = 60 * 60 * 1000;

/** Window and quota of the in-memory rate limiter (per IP). */
export const SHARE_LINK_RATE_WINDOW_MS = 60_000;
export const SHARE_LINK_RATE_LIMIT = 30;

/** A view is counted once per token + IP within this window. */
export const SHARE_VIEW_WINDOW_MS = 60 * 60 * 1000;

export const SHARE_LINK_KINDS = ["document", "dossier"] as const;
export const shareLinkKindSchema = z.enum(SHARE_LINK_KINDS);
export type ShareLinkKind = z.infer<typeof shareLinkKindSchema>;

/**
 * Why a link was revoked: by hand, or automatically because its target became
 * sensitive (SPEC §2 — a sensitive document never leaves through a public URL).
 */
export const SHARE_LINK_REVOKED_REASONS = ["manual", "sensitive"] as const;
export const shareLinkRevokedReasonSchema = z.enum(SHARE_LINK_REVOKED_REASONS);
export type ShareLinkRevokedReason = z.infer<
	typeof shareLinkRevokedReasonSchema
>;

export const shareLinkSchema = z.object({
	id: z.string(),
	token: z.string(),
	kind: shareLinkKindSchema,
	documentId: z.string().nullable(),
	dossierId: z.string().nullable(),
	/** Title of the shared document or dossier, for the management screen. */
	targetTitle: z.string(),
	expiresAt: z.date().nullable(),
	/** The hash itself is never exposed. */
	hasPassword: z.boolean(),
	maxViews: z.int().min(1).nullable(),
	views: z.int().min(0),
	allowDownload: z.boolean(),
	createdById: z.string(),
	createdAt: z.date(),
	revokedAt: z.date().nullable(),
	/** `null` while the link is live. */
	revokedReason: shareLinkRevokedReasonSchema.nullable(),
	/** Public URL, rebuilt on every read. */
	url: z.string(),
});
export type ShareLink = z.infer<typeof shareLinkSchema>;

/** `create` returns the link and, once more, the URL to hand out. */
export const shareLinkWithUrlSchema = z.object({
	link: shareLinkSchema,
	url: z.string(),
});
export type ShareLinkWithUrl = z.infer<typeof shareLinkWithUrlSchema>;

export const listShareLinksInput = z.object({
	documentId: z.string().min(1).optional(),
	dossierId: z.string().min(1).optional(),
	/** `false` (default) hides revoked and expired links. */
	includeInactive: z.boolean().default(false),
});
export type ListShareLinksInput = z.infer<typeof listShareLinksInput>;

export const createShareLinkInput = z
	.object({
		documentId: z.string().min(1).optional(),
		dossierId: z.string().min(1).optional(),
		/** ISO 8601, in the future; absent = never expires. */
		expiresAt: futureDatetimeSchema.nullish(),
		/** Plaintext, hashed on the server with `Bun.password`. */
		password: z.string().min(4).max(200).nullish(),
		maxViews: z.int().min(1).max(100_000).nullish(),
		allowDownload: z.boolean().default(true),
	})
	.refine(
		(input) => Boolean(input.documentId) !== Boolean(input.dossierId),
		"Provide exactly one of `documentId` or `dossierId`.",
	);
export type CreateShareLinkInput = z.infer<typeof createShareLinkInput>;

/* ------------------------------------------------------------------ */
/* Public side (`/api/s/:token`)                                          */
/* ------------------------------------------------------------------ */

/** One shared document, as seen from the public page. */
export const shareItemSchema = z.object({
	id: z.string(),
	title: z.string(),
	documentDate: z.string().nullable(),
	datePrecision: datePrecisionSchema.nullable(),
	pageCount: z.int().nullable(),
	mime: z.string().nullable(),
	/** File to call `/api/s/:token/files/:fileId/...` with; null when none. */
	fileId: z.string().nullable(),
});
export type ShareItem = z.infer<typeof shareItemSchema>;

/** Response of `GET /api/s/:token`. */
export const publicShareSchema = z.object({
	kind: shareLinkKindSchema,
	title: z.string(),
	requiresPassword: z.boolean(),
	expired: z.boolean(),
	revoked: z.boolean(),
	allowDownload: z.boolean(),
	/** Omitted (empty) while a password is required and not yet verified. */
	items: z.array(shareItemSchema),
});
export type PublicShare = z.infer<typeof publicShareSchema>;

/** Response of `POST /api/s/:token/unlock`. */
export const shareUnlockResultSchema = z.object({
	accessToken: z.string(),
	expiresIn: z.int().min(1),
});
export type ShareUnlockResult = z.infer<typeof shareUnlockResultSchema>;
