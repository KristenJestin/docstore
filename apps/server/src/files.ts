import {
	contentDispositionFilename,
	getFileForDownload,
	getThumbnailForDownload,
} from "@docstore/api/services/file.service";
import { getPartyLogoForDownload } from "@docstore/api/services/party-logo.service";
import type { Db } from "@docstore/db";
import type { IngestionBinding } from "@docstore/ingestion";
import { storageForFile } from "@docstore/ingestion";
import { StorageNotFoundError } from "@docstore/storage";
import { ORPCError } from "@orpc/server";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { apiKeyPrincipal } from "./api-key-auth";
import type { AuthInstance } from "./auth-instance";

export interface FileRoutesOptions {
	db: Db;
	ingestion: IngestionBinding | undefined;
	auth: AuthInstance;
}

/**
 * HTTP routes for reading files.
 *
 * Rationale: oRPC can return `Blob`s, but a plain `GET` is far more convenient
 * on the front end (`<img src>`, opening a PDF in a tab, native download) and
 * avoids loading the file into memory — the body is a stream coming from the
 * `StorageDriver`. Both authentications are accepted: Better Auth session
 * (browser) and API key (SPEC §6). The same resources stay reachable over oRPC
 * through `file.download` / `file.thumbnail` for a typed client.
 */
/** Translates business errors into HTTP responses. */
function errorResponse(c: Context, error: unknown): Response {
	if (error instanceof StorageNotFoundError) {
		return c.json({ error: "NOT_FOUND" }, 404);
	}
	if (error instanceof ORPCError) {
		return c.json(
			{ error: error.code, message: error.message },
			error.status as ContentfulStatusCode,
		);
	}
	throw error;
}

/** True when the request is authenticated (API key or session cookie). */
async function isAuthenticated(
	c: Context,
	auth: AuthInstance,
): Promise<boolean> {
	if (apiKeyPrincipal(c)) return true;
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	return Boolean(session?.user);
}

export function registerFileRoutes(
	app: Hono,
	{ db, ingestion, auth }: FileRoutesOptions,
): void {
	app.get("/files/:fileId/download", async (c) => {
		if (!(await isAuthenticated(c, auth))) {
			return c.json({ error: "UNAUTHORIZED" }, 401);
		}
		if (!ingestion) return c.json({ error: "STORAGE_UNAVAILABLE" }, 503);

		try {
			const file = await getFileForDownload(db, c.req.param("fileId"));
			// A sensitive document is read back through the encrypted driver.
			const blob = await storageForFile(ingestion.ctx, file.encrypted).get(
				file.storageKey,
			);
			const inline = c.req.query("disposition") === "inline";
			return new Response(blob.stream(), {
				headers: {
					"Content-Type": file.mime,
					"Content-Length": String(blob.size),
					"Content-Disposition": `${inline ? "inline" : "attachment"}; ${contentDispositionFilename(file.filename)}`,
					"Cache-Control": "private, max-age=3600",
				},
			});
		} catch (error) {
			return errorResponse(c, error);
		}
	});

	app.get("/files/:fileId/thumbnail", async (c) => {
		if (!(await isAuthenticated(c, auth))) {
			return c.json({ error: "UNAUTHORIZED" }, 401);
		}
		if (!ingestion) return c.json({ error: "STORAGE_UNAVAILABLE" }, 503);

		try {
			const file = await getThumbnailForDownload(db, c.req.param("fileId"));
			const blob = await storageForFile(ingestion.ctx, file.encrypted).get(
				file.thumbnailKey,
			);
			return new Response(blob.stream(), {
				headers: {
					"Content-Type": "image/png",
					"Content-Length": String(blob.size),
					"Cache-Control": "private, max-age=3600",
				},
			});
		} catch (error) {
			return errorResponse(c, error);
		}
	});

	app.get("/api/parties/:id/logo", async (c) => {
		if (!(await isAuthenticated(c, auth))) {
			return c.json({ error: "UNAUTHORIZED" }, 401);
		}
		if (!ingestion) return c.json({ error: "STORAGE_UNAVAILABLE" }, 503);

		try {
			const logo = await getPartyLogoForDownload(db, c.req.param("id"));
			const blob = await ingestion.ctx.storage.get(logo.logoKey);
			return new Response(blob.stream(), {
				headers: {
					"Content-Type": logo.mime,
					"Content-Length": String(blob.size),
					"Cache-Control": "private, max-age=3600",
				},
			});
		} catch (error) {
			return errorResponse(c, error);
		}
	});

	// Old path, unreachable behind Caddy's `@api` matcher (`/parties/*` never
	// matched: the front-end's catch-all served 404 HTML instead). Kept as a
	// redirect for one release for any client with the previous URL cached.
	app.get("/parties/:id/logo", (c) => {
		const search = new URL(c.req.raw.url).search;
		return c.redirect(`/api/parties/${c.req.param("id")}/logo${search}`, 308);
	});
}
