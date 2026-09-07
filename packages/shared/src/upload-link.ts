import { z } from "zod";
import { futureDatetimeSchema } from "./common";
import { intakeDefaultsSchema } from "./intake";

/**
 * Public upload links (SPEC §2 "Misc"): an unauthenticated URL where a
 * third party drops files, with an expiry and a quota.
 *
 * `/u/<token>` is the **web** page handed to the third party; it talks to the
 * API through `GET|POST /api/u/<token>`.
 */

/** Length of the public token (`/u/<token>`). */
export const UPLOAD_LINK_TOKEN_LENGTH = 32;

/** Maximum size of a file uploaded through a public link. */
export const UPLOAD_LINK_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Number of files accepted per upload. */
export const UPLOAD_LINK_MAX_FILES = 10;

/** Window and quota of the in-memory rate limiter (per IP). */
export const UPLOAD_LINK_RATE_WINDOW_MS = 60_000;
export const UPLOAD_LINK_RATE_LIMIT = 10;

export const uploadLinkSchema = z.object({
	id: z.string(),
	token: z.string(),
	name: z.string(),
	message: z.string().nullable(),
	expiresAt: z.date().nullable(),
	maxUses: z.int().min(1).nullable(),
	uses: z.int().min(0),
	defaults: intakeDefaultsSchema,
	enabled: z.boolean(),
	createdById: z.string(),
	createdAt: z.date(),
	/** Public web page URL, rebuilt on every read (like `shareLink.url`). */
	url: z.string(),
});
export type UploadLink = z.infer<typeof uploadLinkSchema>;

/** `create` repeats the URL at the top level: it is what the caller copies. */
export const uploadLinkWithUrlSchema = z.object({
	link: uploadLinkSchema,
	url: z.string(),
});
export type UploadLinkWithUrl = z.infer<typeof uploadLinkWithUrlSchema>;

export const createUploadLinkInput = z.object({
	name: z.string().trim().min(1).max(150),
	/** Text shown to the uploader on the public page. */
	message: z.string().trim().max(2000).nullish(),
	/** ISO 8601, in the future. */
	expiresAt: futureDatetimeSchema.nullish(),
	maxUses: z.int().min(1).max(10_000).nullish(),
	defaults: intakeDefaultsSchema.default({}),
	enabled: z.boolean().default(true),
});
export type CreateUploadLinkInput = z.infer<typeof createUploadLinkInput>;

export const updateUploadLinkInput = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(150).optional(),
	message: z.string().trim().max(2000).nullish(),
	expiresAt: futureDatetimeSchema.nullish(),
	maxUses: z.int().min(1).max(10_000).nullish(),
	defaults: intakeDefaultsSchema.optional(),
	enabled: z.boolean().optional(),
});
export type UpdateUploadLinkInput = z.infer<typeof updateUploadLinkInput>;

/** What the public page receives from `GET /api/u/:token`. */
export const publicUploadLinkSchema = z.object({
	name: z.string(),
	message: z.string().nullable(),
	expired: z.boolean(),
	/** `null` when the link is unlimited. */
	remainingUses: z.int().min(0).nullable(),
});
export type PublicUploadLink = z.infer<typeof publicUploadLinkSchema>;

/** Response of `POST /api/u/:token`. */
export const publicUploadResultSchema = z.object({
	created: z.array(z.object({ filename: z.string() })),
	duplicates: z.array(z.object({ filename: z.string() })),
	errors: z.array(z.object({ filename: z.string(), message: z.string() })),
});
export type PublicUploadResult = z.infer<typeof publicUploadResultSchema>;
