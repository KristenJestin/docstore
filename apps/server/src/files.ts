import { resolveDocumentId } from "@docstore/api/services/document-resolution.service";
import {
	contentDispositionFilename,
	type FileForDownload,
	getFileForDownload,
	getPrimaryFileForDownload,
	getThumbnailForDownload,
} from "@docstore/api/services/file.service";
import { getPartyLogoForDownload } from "@docstore/api/services/party-logo.service";
import { assertSensitiveAccess } from "@docstore/api/services/sensitive-access.service";
import type { Db } from "@docstore/db";
import type { IngestionBinding } from "@docstore/ingestion";
import { storageForFile } from "@docstore/ingestion";
import { callerHasScope } from "@docstore/shared/api-key";
import { StorageNotFoundError } from "@docstore/storage";
import type { OpenAPI } from "@orpc/openapi";
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

/**
 * Authentication and `read` scope (SPEC §6): `null` when the request may read,
 * otherwise the response to send. A browser session keeps every right; an API
 * key needs `read`.
 */
async function refuseUnlessReader(
	c: Context,
	auth: AuthInstance,
): Promise<Response | null> {
	const principal = apiKeyPrincipal(c);
	if (principal) {
		if (callerHasScope(principal, "read")) return null;
		return c.json(
			{ error: "FORBIDDEN", message: 'The "read" scope is required.' },
			403,
		);
	}
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (session?.user) return null;
	return c.json({ error: "UNAUTHORIZED" }, 401);
}

/**
 * Streams a stored file after the `sensitive` check of issue #1, which runs
 * before the storage is touched: no byte of a refused file leaves.
 * `?disposition=inline` views it instead of downloading it.
 */
async function serveFile(
	c: Context,
	ingestion: IngestionBinding,
	file: FileForDownload,
): Promise<Response> {
	assertSensitiveAccess(apiKeyPrincipal(c), file.documentSensitive);
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
}

/**
 * OpenAPI description of `GET /d/{docId}`, a Hono route outside the oRPC
 * router: merged into the generated reference by `src/app.ts`. The path-level
 * `servers` entry sets it apart from the `/api-reference` prefix of the rest.
 */
export const stableDocumentUrlSpec: OpenAPI.PathsObject = {
	"/d/{docId}": {
		servers: [{ url: "/" }],
		get: {
			operationId: "stableDocumentFile",
			tags: ["Document"],
			summary: "Primary file of a document, at its stable URL",
			description:
				"Serves the primary file of the document (its `original` file, the oldest one if there are several) without resolving a `fil_` id first. The id of a document merged as a version answers `302` to the stable URL of the kept document; a document in the trash is still served; a permanently deleted one answers `410`. Same authentication and scopes as `/files/{fileId}/download`: `read`, plus `sensitive` for a sensitive document.",
			parameters: [
				{
					name: "docId",
					in: "path",
					required: true,
					schema: { type: "string" },
				},
				{
					name: "disposition",
					in: "query",
					required: false,
					description: "`inline` to view the file instead of downloading it.",
					schema: { type: "string", enum: ["attachment", "inline"] },
				},
			],
			responses: {
				"200": {
					description: "The file, streamed.",
					content: {
						"*/*": { schema: { type: "string", format: "binary" } },
					},
				},
				"302": {
					description:
						"The document was merged: `Location` is the stable URL of the kept document.",
				},
				"401": { description: "No session and no API key." },
				"403": {
					description:
						"The API key lacks `read`, or `sensitive` for a sensitive document.",
				},
				"404": { description: "Unknown document, or a document without file." },
				"410": { description: "The document was permanently deleted." },
			},
		},
	},
};

export function registerFileRoutes(
	app: Hono,
	{ db, ingestion, auth }: FileRoutesOptions,
): void {
	app.get("/files/:fileId/download", async (c) => {
		const refused = await refuseUnlessReader(c, auth);
		if (refused) return refused;
		if (!ingestion) return c.json({ error: "STORAGE_UNAVAILABLE" }, 503);

		try {
			const file = await getFileForDownload(db, c.req.param("fileId"));
			return await serveFile(c, ingestion, file);
		} catch (error) {
			return errorResponse(c, error);
		}
	});

	// Stable URL of a document (issue #2): what a citation of `doc_…` keeps.
	// Authentication comes first, so an anonymous caller learns nothing of a
	// merge either.
	app.get("/d/:docId", async (c) => {
		const refused = await refuseUnlessReader(c, auth);
		if (refused) return refused;
		if (!ingestion) return c.json({ error: "STORAGE_UNAVAILABLE" }, 503);

		try {
			const docId = c.req.param("docId");
			const resolved = await resolveDocumentId(db, docId);
			if (resolved.id !== docId) {
				const search = new URL(c.req.raw.url).search;
				return c.redirect(`/d/${resolved.id}${search}`, 302);
			}
			const file = await getPrimaryFileForDownload(db, resolved.id);
			return await serveFile(c, ingestion, file);
		} catch (error) {
			return errorResponse(c, error);
		}
	});

	app.get("/files/:fileId/thumbnail", async (c) => {
		const refused = await refuseUnlessReader(c, auth);
		if (refused) return refused;
		if (!ingestion) return c.json({ error: "STORAGE_UNAVAILABLE" }, 503);

		try {
			const file = await getThumbnailForDownload(db, c.req.param("fileId"));
			// Checked before the storage is touched: no byte of a refused file leaves.
			assertSensitiveAccess(apiKeyPrincipal(c), file.documentSensitive);
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
		const refused = await refuseUnlessReader(c, auth);
		if (refused) return refused;
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
