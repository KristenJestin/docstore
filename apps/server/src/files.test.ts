import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { auth } from "@docstore/auth";
import { createTestDb, type TestDb } from "@docstore/db/test-utils";
import type { Hono } from "hono";
import { createApp } from "./app";

/**
 * `GET /parties/:id/logo`: Caddy's `@api` matcher never covered this path in
 * production (`docker/Caddyfile`), so the front-end's catch-all served 404
 * HTML instead of the logo. The route moved under `/api/parties/:id/logo`;
 * the old path stays a redirect for one release.
 */

const APP_SECRET = "files-test-secret-files-test-secret";

let db: TestDb;
let app: Hono;

beforeAll(async () => {
	db = await createTestDb();
	app = createApp({
		db,
		auth,
		ingestion: undefined,
		corsOrigin: "http://localhost:3001",
		appSecret: APP_SECRET,
		logRequests: false,
	});
});

afterAll(async () => {
	await db.$client.end();
});

describe("GET /parties/:id/logo", () => {
	test("redirects permanently to /api/parties/:id/logo", async () => {
		const response = await app.request("/parties/prt_abc/logo", {
			redirect: "manual",
		});
		expect(response.status).toBe(308);
		expect(response.headers.get("Location")).toBe("/api/parties/prt_abc/logo");
	});

	test("preserves the query string (cache-buster version)", async () => {
		const response = await app.request("/parties/prt_abc/logo?v=42", {
			redirect: "manual",
		});
		expect(response.status).toBe(308);
		expect(response.headers.get("Location")).toBe(
			"/api/parties/prt_abc/logo?v=42",
		);
	});
});

describe("GET /api/parties/:id/logo", () => {
	test("requires authentication", async () => {
		const response = await app.request("/api/parties/prt_abc/logo");
		expect(response.status).toBe(401);
	});
});
