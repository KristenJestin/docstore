import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createApiKey } from "@docstore/api/services/api-key.service";
import { auth } from "@docstore/auth";
import { createId } from "@docstore/db/id";
import { user } from "@docstore/db/schema/auth";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { Hono } from "hono";
import { createApp } from "./app";

let db: TestDb;
let app: Hono;
let secret: string;

const INITIALIZE = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "test", version: "0.0.0" },
	},
});

const ACCEPT = "application/json, text/event-stream";

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	const userId = createId("usr_");
	await db.insert(user).values({
		id: userId,
		name: "Camille Moreau",
		email: `${userId}@example.test`,
	});
	const created = await createApiKey(db, userId, {
		name: "MCP Agent",
		scopes: ["read", "write"],
	});
	secret = created.secret;

	app = createApp({
		db,
		auth,
		corsOrigin: "http://127.0.0.1:3001",
		logRequests: false,
	});
});

/** JSON-RPC body, whether the response is raw JSON or an SSE stream. */
async function readJsonRpc(response: Response): Promise<string> {
	return response.text();
}

test("POST /mcp without an API key responds 401", async () => {
	const response = await app.request("/mcp", {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: ACCEPT },
		body: INITIALIZE,
	});

	expect(response.status).toBe(401);
	const body = (await response.json()) as { error: string };
	expect(body.error).toBe("UNAUTHORIZED");
});

test("POST /mcp with an unknown key responds 401", async () => {
	const response = await app.request("/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: ACCEPT,
			Authorization: "Bearer dsk_unknown",
		},
		body: INITIALIZE,
	});

	expect(response.status).toBe(401);
});

test("POST /mcp with a valid key answers the `initialize` handshake", async () => {
	const response = await app.request("/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: ACCEPT,
			Authorization: `Bearer ${secret}`,
		},
		body: INITIALIZE,
	});

	expect(response.status).toBe(200);
	const body = await readJsonRpc(response);
	expect(body).toContain("docstore");
	expect(body).toContain("serverInfo");
});

test("the X-API-Key header is accepted", async () => {
	const response = await app.request("/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: ACCEPT,
			"X-API-Key": secret,
		},
		body: INITIALIZE,
	});

	expect(response.status).toBe(200);
});

test("GET /health stays public", async () => {
	const response = await app.request("/health");
	expect(response.status).toBe(200);
	const body = (await response.json()) as { status: string };
	expect(body.status).toBe("ok");
});
