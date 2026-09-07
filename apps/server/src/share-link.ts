import {
	contentDispositionFilename,
	getFileForDownload,
	getThumbnailForDownload,
} from "@docstore/api/services/file.service";
import {
	consumeShareView,
	findShareLinkByToken,
	issueShareAccessToken,
	shareFileTarget,
	shareLinkState,
	toPublicShare,
	verifyShareAccessToken,
	verifySharePassword,
} from "@docstore/api/services/share-link.service";
import type { Db } from "@docstore/db";
import type { ShareLinkRow } from "@docstore/db/schema/share";
import type { IngestionBinding } from "@docstore/ingestion";
import { storageForFile } from "@docstore/ingestion";
import {
	SHARE_LINK_RATE_LIMIT,
	SHARE_LINK_RATE_WINDOW_MS,
	SHARE_VIEW_WINDOW_MS,
} from "@docstore/shared/share-link";
import type { Context, Hono } from "hono";
import { clientIp } from "./upload-link";

/**
 * Public share links (SPEC §2 "Misc", §8 iteration 7).
 *
 * Together with `/api/u/*`, these are the only unauthenticated routes of the
 * application. They sit under `/api/s/...` because `/s/:token` itself is the
 * SPA page that consumes them. Semantics:
 *
 * - `404` — unknown token (a deleted link looks exactly like a token that never
 *   existed: scanners learn nothing);
 * - `410` — revoked, expired or view quota reached;
 * - `401` — a password is required and the `access` token is missing or stale;
 * - `403` — downloads disabled on the link (`allowDownload: false`);
 * - `429` — more than 30 requests per minute from the same IP.
 */

export interface ShareLinkRoutesOptions {
	db: Db;
	ingestion: IngestionBinding | undefined;
	/** `APP_SECRET`, injected: this module never reads the environment. */
	appSecret: string;
}

/* ------------------------------------------------------------------ */
/* Rate limiting (per IP) and view counting (per token + IP)            */
/* ------------------------------------------------------------------ */

const hits = new Map<string, { count: number; resetAt: number }>();
const seenViews = new Map<string, number>();

function sweep(now: number): void {
	if (hits.size >= 1000) {
		for (const [key, entry] of hits) {
			if (entry.resetAt <= now) hits.delete(key);
		}
	}
	if (seenViews.size >= 1000) {
		for (const [key, expiry] of seenViews) {
			if (expiry <= now) seenViews.delete(key);
		}
	}
}

export function shareRateLimit(
	key: string,
	now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
	sweep(now);
	const entry = hits.get(key);
	if (!entry || entry.resetAt <= now) {
		hits.set(key, { count: 1, resetAt: now + SHARE_LINK_RATE_WINDOW_MS });
		return { allowed: true, retryAfterSeconds: 0 };
	}
	entry.count += 1;
	if (entry.count > SHARE_LINK_RATE_LIMIT) {
		return {
			allowed: false,
			retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
		};
	}
	return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * True the first time this token is accessed from this IP within the window:
 * a visitor browsing a dossier of twenty documents counts as one view, not
 * twenty.
 */
export function shouldCountView(
	token: string,
	ip: string,
	now: number = Date.now(),
): boolean {
	const key = `${token}|${ip}`;
	const seen = seenViews.get(key);
	if (seen && seen > now) return false;
	seenViews.set(key, now + SHARE_VIEW_WINDOW_MS);
	return true;
}

/** Clears both in-memory tables (tests). */
export function resetShareState(): void {
	hits.clear();
	seenViews.clear();
}

/* ------------------------------------------------------------------ */
/* Routes                                                               */
/* ------------------------------------------------------------------ */

type Guarded =
	| { ok: true; link: ShareLinkRow }
	| { ok: false; response: Response };

/** Rate limit, token lookup and state check, shared by every route. */
async function guard(c: Context, db: Db): Promise<Guarded> {
	const limit = shareRateLimit(clientIp(c));
	if (!limit.allowed) {
		return {
			ok: false,
			response: c.json({ error: "TOO_MANY_REQUESTS" }, 429, {
				"Retry-After": String(limit.retryAfterSeconds),
			}),
		};
	}
	const link = await findShareLinkByToken(db, c.req.param("token") ?? "");
	if (!link) {
		return { ok: false, response: c.json({ error: "NOT_FOUND" }, 404) };
	}
	return { ok: true, link };
}

function goneResponse(c: Context): Response {
	return c.json(
		{ error: "GONE", message: "This share link is no longer valid." },
		410,
	);
}

export function registerShareLinkRoutes(
	app: Hono,
	{ db, ingestion, appSecret }: ShareLinkRoutesOptions,
): void {
	// Metadata. Always answers for a known token, even revoked or expired: the
	// page needs to tell the visitor why there is nothing to see.
	app.get("/api/s/:token", async (c) => {
		const guarded = await guard(c, db);
		if (!guarded.ok) return guarded.response;
		const { link } = guarded;

		const unlocked = verifyShareAccessToken(
			c.req.query("access"),
			link.id,
			appSecret,
		);
		const payload = await toPublicShare(db, link, { unlocked });

		if (payload.items.length > 0 && shouldCountView(link.token, clientIp(c))) {
			await consumeShareView(db, link.id);
		}
		return c.json(payload);
	});

	app.post("/api/s/:token/unlock", async (c) => {
		const guarded = await guard(c, db);
		if (!guarded.ok) return guarded.response;
		const { link } = guarded;

		if (!shareLinkState(link).usable) return goneResponse(c);

		let password = "";
		try {
			const body = (await c.req.json()) as { password?: unknown };
			password = typeof body.password === "string" ? body.password : "";
		} catch {
			return c.json({ error: "BAD_REQUEST", message: "Unreadable body." }, 400);
		}

		if (!(await verifySharePassword(link, password))) {
			return c.json({ error: "UNAUTHORIZED", message: "Wrong password." }, 401);
		}
		return c.json(issueShareAccessToken(link.id, appSecret));
	});

	/** Serves a file (or its thumbnail) behind a link. */
	async function serveFile(c: Context, thumbnail: boolean): Promise<Response> {
		const guarded = await guard(c, db);
		if (!guarded.ok) return guarded.response;
		const { link } = guarded;

		if (!shareLinkState(link).usable) return goneResponse(c);
		if (link.passwordHash) {
			const unlocked = verifyShareAccessToken(
				c.req.query("access"),
				link.id,
				appSecret,
			);
			if (!unlocked) {
				return c.json(
					{ error: "UNAUTHORIZED", message: "Password required." },
					401,
				);
			}
		}
		// The thumbnail is part of the preview: only the full file obeys
		// `allowDownload`.
		if (!thumbnail && !link.allowDownload) {
			return c.json(
				{ error: "FORBIDDEN", message: "Downloads are disabled on this link." },
				403,
			);
		}
		if (!ingestion) return c.json({ error: "STORAGE_UNAVAILABLE" }, 503);

		const fileId = c.req.param("fileId") ?? "";
		if (!(await shareFileTarget(db, link, fileId))) {
			return c.json({ error: "NOT_FOUND" }, 404);
		}

		// Reuses the authenticated loaders: they already resolve the storage key,
		// the mime type and the encryption flag.
		try {
			if (thumbnail) {
				const file = await getThumbnailForDownload(db, fileId);
				const blob = await storageForFile(ingestion.ctx, file.encrypted).get(
					file.thumbnailKey,
				);
				if (shouldCountView(link.token, clientIp(c))) {
					await consumeShareView(db, link.id);
				}
				return new Response(blob.stream(), {
					headers: {
						"Content-Type": "image/png",
						"Content-Length": String(blob.size),
						"Cache-Control": "private, max-age=3600",
					},
				});
			}

			const file = await getFileForDownload(db, fileId);
			const blob = await storageForFile(ingestion.ctx, file.encrypted).get(
				file.storageKey,
			);
			if (shouldCountView(link.token, clientIp(c))) {
				await consumeShareView(db, link.id);
			}
			const inline = c.req.query("disposition") === "inline";
			return new Response(blob.stream(), {
				headers: {
					"Content-Type": file.mime,
					"Content-Length": String(blob.size),
					"Content-Disposition": `${inline ? "inline" : "attachment"}; ${contentDispositionFilename(file.filename)}`,
					"Cache-Control": "private, max-age=3600",
				},
			});
		} catch {
			return c.json({ error: "NOT_FOUND" }, 404);
		}
	}

	app.get("/api/s/:token/files/:fileId/download", (c) => serveFile(c, false));
	app.get("/api/s/:token/files/:fileId/thumbnail", (c) => serveFile(c, true));
}
