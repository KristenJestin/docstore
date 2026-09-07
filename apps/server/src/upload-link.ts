import {
	consumeUploadLink,
	findUploadLinkByToken,
	isUploadLinkUsable,
	toPublicUploadLink,
} from "@docstore/api/services/upload-link.service";
import type { Db } from "@docstore/db";
import type { IngestionBinding } from "@docstore/ingestion";
import {
	DuplicateOriginalError,
	intakeFile,
	isDuplicate,
	resolveAllowedMime,
	UnsupportedMediaError,
} from "@docstore/ingestion";
import type { PublicUploadResult } from "@docstore/shared/upload-link";
import {
	UPLOAD_LINK_MAX_FILE_BYTES,
	UPLOAD_LINK_MAX_FILES,
	UPLOAD_LINK_RATE_LIMIT,
	UPLOAD_LINK_RATE_WINDOW_MS,
} from "@docstore/shared/upload-link";
import type { Context, Hono } from "hono";

/**
 * Public upload by link (SPEC §2 "Misc").
 *
 * These two routes are the only ones in the application open without
 * authentication: the 32-character token is their only key. Hence the
 * safeguards — usage quota, expiry, size and file count caps, and per-IP rate
 * limiting.
 *
 * They live under `/api/u/:token`: `/u/:token` itself is the SPA page that
 * calls them, and the two must not collide on the shared origin.
 */

export interface UploadLinkRoutesOptions {
	db: Db;
	ingestion: IngestionBinding | undefined;
}

/**
 * In-memory per-IP request counter.
 *
 * Deliberately simple: a single process serves these routes, and the goal is
 * to fend off token scanning, not to do fine-grained traffic control.
 */
const hits = new Map<string, { count: number; resetAt: number }>();

/** Lazy purge: the table does not grow indefinitely. */
function sweep(now: number): void {
	if (hits.size < 1000) return;
	for (const [key, entry] of hits) {
		if (entry.resetAt <= now) hits.delete(key);
	}
}

export function rateLimit(
	key: string,
	now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
	sweep(now);
	const entry = hits.get(key);
	if (!entry || entry.resetAt <= now) {
		hits.set(key, { count: 1, resetAt: now + UPLOAD_LINK_RATE_WINDOW_MS });
		return { allowed: true, retryAfterSeconds: 0 };
	}
	entry.count += 1;
	if (entry.count > UPLOAD_LINK_RATE_LIMIT) {
		return {
			allowed: false,
			retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
		};
	}
	return { allowed: true, retryAfterSeconds: 0 };
}

/** Clears the counter (tests). */
export function resetRateLimit(): void {
	hits.clear();
}

/** Caller address, accounting for the Caddy reverse proxy. */
export function clientIp(c: Context): string {
	const forwarded = c.req.header("x-forwarded-for");
	const first = forwarded?.split(",")[0]?.trim();
	return first || c.req.header("x-real-ip") || "unknown";
}

export function registerUploadLinkRoutes(
	app: Hono,
	{ db, ingestion }: UploadLinkRoutesOptions,
): void {
	app.get("/api/u/:token", async (c) => {
		const limit = rateLimit(clientIp(c));
		if (!limit.allowed) {
			return c.json({ error: "TOO_MANY_REQUESTS" }, 429, {
				"Retry-After": String(limit.retryAfterSeconds),
			});
		}

		const link = await findUploadLinkByToken(db, c.req.param("token"));
		// An unknown link and a deleted link look alike: same response, so that
		// token scanners learn nothing.
		if (!link) return c.json({ error: "NOT_FOUND" }, 404);
		return c.json(toPublicUploadLink(link));
	});

	app.post("/api/u/:token", async (c) => {
		const limit = rateLimit(clientIp(c));
		if (!limit.allowed) {
			return c.json({ error: "TOO_MANY_REQUESTS" }, 429, {
				"Retry-After": String(limit.retryAfterSeconds),
			});
		}

		const link = await findUploadLinkByToken(db, c.req.param("token"));
		if (!link) return c.json({ error: "NOT_FOUND" }, 404);
		if (!isUploadLinkUsable(link)) {
			return c.json(
				{ error: "GONE", message: "This upload link is no longer valid." },
				410,
			);
		}
		if (!ingestion) return c.json({ error: "SERVICE_UNAVAILABLE" }, 503);

		let body: Record<string, unknown>;
		try {
			body = await c.req.parseBody({ all: true });
		} catch {
			return c.json({ error: "BAD_REQUEST", message: "Unreadable form." }, 400);
		}

		const raw = body.files ?? body.file;
		const files = (Array.isArray(raw) ? raw : [raw]).filter(
			(item): item is File => item instanceof File,
		);

		if (files.length === 0) {
			return c.json(
				{ error: "BAD_REQUEST", message: "No file received." },
				400,
			);
		}
		if (files.length > UPLOAD_LINK_MAX_FILES) {
			return c.json(
				{
					error: "BAD_REQUEST",
					message: `${UPLOAD_LINK_MAX_FILES} files at most per upload.`,
				},
				400,
			);
		}

		const result: PublicUploadResult = {
			created: [],
			duplicates: [],
			errors: [],
		};

		for (const file of files) {
			if (file.size > UPLOAD_LINK_MAX_FILE_BYTES) {
				result.errors.push({
					filename: file.name,
					message: "File too large (20 MB at most).",
				});
				continue;
			}
			try {
				resolveAllowedMime(file.type, file.name);
			} catch (error) {
				result.errors.push({
					filename: file.name,
					message:
						error instanceof UnsupportedMediaError
							? error.message
							: String(error),
				});
				continue;
			}

			try {
				const outcome = await intakeFile(ingestion.ctx, {
					data: file,
					filename: file.name,
					mime: file.type,
					// The document belongs to the link creator, not to the uploader:
					// the uploader has no account.
					createdById: link.createdById,
					source: "link",
					sourceRef: link.id,
					defaults: link.defaults,
				});
				if (isDuplicate(outcome)) {
					result.duplicates.push({ filename: file.name });
				} else {
					result.created.push({ filename: file.name });
				}
			} catch (error) {
				// `intakeFile` also sniffs the content: a `.pdf` holding something
				// else lands here, and the uploader deserves to know why.
				const known =
					error instanceof DuplicateOriginalError ||
					error instanceof UnsupportedMediaError;
				result.errors.push({
					filename: file.name,
					message:
						error instanceof DuplicateOriginalError
							? "This content has already been uploaded."
							: error instanceof UnsupportedMediaError
								? error.message
								: "The upload failed.",
				});
				if (!known) {
					console.error("[upload-link] upload failed", error);
				}
			}
		}

		// One use = one upload, whatever the number of files.
		await consumeUploadLink(db, link.id);

		return c.json(result, 201);
	});
}
