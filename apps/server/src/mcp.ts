import type { Db } from "@docstore/db";
import type { IngestionBinding } from "@docstore/ingestion";
import { createMcpServer } from "@docstore/mcp";
import { StreamableHTTPTransport } from "@hono/mcp";
import type { Hono } from "hono";
import { apiKeyPrincipal } from "./api-key-auth";

export interface McpRoutesOptions {
	db: Db;
	ingestion: IngestionBinding | undefined;
}

/**
 * MCP endpoint (SPEC §6): Streamable HTTP transport on `/mcp`.
 *
 * Access is reserved for API keys — no session cookie: an MCP agent is not a
 * browser, and the key scopes bound what it can do. The mode is sessionless
 * (`sessionIdGenerator: undefined`): a fresh server and transport per request,
 * so that no scope leaks from one caller to another.
 */
export function registerMcpRoutes(
	app: Hono,
	{ db, ingestion }: McpRoutesOptions,
): void {
	app.on(["POST", "GET", "DELETE"], "/mcp", async (c) => {
		const principal = apiKeyPrincipal(c);
		if (!principal) {
			return c.json(
				{
					error: "UNAUTHORIZED",
					message:
						'API key required: "Authorization: Bearer dsk_…" or "X-API-Key" header.',
				},
				401,
			);
		}

		const server = createMcpServer({
			db,
			ingestion,
			principal: { userId: principal.userId, scopes: principal.scopes },
		});
		const transport = new StreamableHTTPTransport({
			sessionIdGenerator: undefined,
		});
		await server.connect(transport);

		const response = await transport.handleRequest(c);
		if (!response) {
			await server.close();
			return c.body(null, 204);
		}

		// An SSE response stays open: the transport closes on its own.
		const isStream = response.headers
			.get("content-type")
			?.includes("text/event-stream");
		if (!isStream) {
			await server.close();
		}
		return response;
	});
}
