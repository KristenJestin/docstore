import { createContext } from "@docstore/api/context";
import { appRouter } from "@docstore/api/routers/index";
import type { Db } from "@docstore/db";
import type { IngestionBinding } from "@docstore/ingestion";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { apiKeyAuth, apiKeyPrincipal } from "./api-key-auth";
import type { AuthInstance } from "./auth-instance";
import { registerExportRoutes } from "./export";
import { registerFileRoutes } from "./files";
import { buildHealthReport } from "./health";
import { registerMcpRoutes } from "./mcp";
import { registerShareLinkRoutes } from "./share-link";
import { registerUploadLinkRoutes } from "./upload-link";

export interface CreateAppOptions {
	db: Db;
	auth: AuthInstance;
	/** Absent = degraded server: upload, MCP `upload_document` and thumbnails are down. */
	ingestion?: IngestionBinding;
	corsOrigin: string;
	/**
	 * `APP_SECRET`, used to sign the share-link access tokens. Injected so the
	 * app builder stays free of environment reads (tests pass their own).
	 */
	appSecret?: string;
	/** Request log; turned off in tests. */
	logRequests?: boolean;
}

export const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

export const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

/**
 * Builds the complete HTTP application, with no side effect: no queue, no
 * worker, no seed. `src/index.ts` handles the lifecycle, tests call
 * `createApp` directly.
 */
export function createApp(options: CreateAppOptions): Hono {
	const { db, auth, ingestion, corsOrigin } = options;
	const app = new Hono();

	if (options.logRequests !== false) {
		app.use(logger());
	}
	app.use(
		"/*",
		cors({
			origin: corsOrigin,
			allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "Accept"],
			// The web app reads the export filename and count off the response
			// (ZIP download, `src/export.ts`): browsers hide non-safelisted
			// response headers from `fetch` unless they are explicitly exposed.
			exposeHeaders: ["Content-Disposition", "X-Export-Count"],
			credentials: true,
		}),
	);

	// Resolves the API key once for every route (SPEC §6).
	app.use("/*", apiKeyAuth({ db }));

	app.get("/health", async (c) => c.json(await buildHealthReport(ingestion)));

	app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

	// Download and thumbnails: direct HTTP routes (see `src/files.ts`).
	registerFileRoutes(app, { db, ingestion, auth });

	// ZIP export (see `src/export.ts`): streamed, session or API key.
	registerExportRoutes(app, { db, ingestion, auth });

	// Native MCP server (see `src/mcp.ts`), reserved for API keys.
	registerMcpRoutes(app, { db, ingestion });

	// Public upload by link (see `src/upload-link.ts`): no authentication.
	// Mounted under `/api/u/...`: `/u/:token` is the SPA page calling it.
	registerUploadLinkRoutes(app, { db, ingestion });

	// Public share links (see `src/share-link.ts`): no authentication either,
	// and under `/api/s/...` for the same reason.
	registerShareLinkRoutes(app, {
		db,
		ingestion,
		appSecret: options.appSecret ?? process.env.APP_SECRET ?? "",
	});

	app.use("/*", async (c, next) => {
		const context = await createContext({
			context: c,
			db,
			ingestion,
			apiKey: apiKeyPrincipal(c),
		});

		const rpcResult = await rpcHandler.handle(c.req.raw, {
			prefix: "/rpc",
			context,
		});

		if (rpcResult.matched) {
			return c.newResponse(rpcResult.response.body, rpcResult.response);
		}

		const apiResult = await apiHandler.handle(c.req.raw, {
			prefix: "/api-reference",
			context,
		});

		if (apiResult.matched) {
			return c.newResponse(apiResult.response.body, apiResult.response);
		}

		await next();
	});

	app.get("/", (c) => c.text("OK"));

	return app;
}
