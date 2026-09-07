import {
	exportDocuments,
	exportStorage,
} from "@docstore/api/services/export.service";
import { contentDispositionFilename } from "@docstore/api/services/file.service";
import type { Db } from "@docstore/db";
import type { IngestionBinding } from "@docstore/ingestion";
import { hasScope } from "@docstore/shared/api-key";
import { exportDocumentsInput } from "@docstore/shared/export";
import type { Hono } from "hono";
import { apiKeyPrincipal } from "./api-key-auth";
import type { AuthInstance } from "./auth-instance";

/**
 * Tree export (SPEC §8 iteration 7): `POST /api/export` answers with the ZIP.
 *
 * A plain HTTP route rather than an oRPC procedure: the archive is streamed
 * (`Content-Disposition: attachment`), which the browser handles natively and
 * an RPC envelope would only get in the way of. `export.preview` gives the
 * front end the same selection ahead of time.
 */

export interface ExportRoutesOptions {
	db: Db;
	ingestion: IngestionBinding | undefined;
	auth: AuthInstance;
}

export function registerExportRoutes(
	app: Hono,
	{ db, ingestion, auth }: ExportRoutesOptions,
): void {
	app.post("/api/export", async (c) => {
		const principal = apiKeyPrincipal(c);
		if (!principal) {
			const session = await auth.api.getSession({ headers: c.req.raw.headers });
			if (!session?.user) return c.json({ error: "UNAUTHORIZED" }, 401);
		} else if (!hasScope(principal.scopes, "read")) {
			return c.json(
				{ error: "FORBIDDEN", message: 'The "read" scope is required.' },
				403,
			);
		}

		let raw: unknown;
		try {
			raw = await c.req.json();
		} catch {
			// An empty body means "export everything the default filters allow".
			raw = {};
		}

		const parsed = exportDocumentsInput.safeParse(raw ?? {});
		if (!parsed.success) {
			return c.json(
				{ error: "BAD_REQUEST", message: parsed.error.message },
				400,
			);
		}
		const input = parsed.data;

		// Sensitive documents leave the store only for a caller that may read them.
		if (
			input.includeSensitive &&
			principal &&
			!hasScope(principal.scopes, "sensitive")
		) {
			return c.json(
				{
					error: "FORBIDDEN",
					message: 'The "sensitive" scope is required for includeSensitive.',
				},
				403,
			);
		}

		if (!ingestion) return c.json({ error: "STORAGE_UNAVAILABLE" }, 503);

		const result = await exportDocuments(
			{
				db,
				storage: exportStorage(
					ingestion.ctx.storage,
					ingestion.ctx.secureStorage,
				),
			},
			input,
		);

		return new Response(result.stream, {
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; ${contentDispositionFilename(result.filename)}`,
				"Cache-Control": "no-store",
				"X-Export-Count": String(result.count),
			},
		});
	});
}
