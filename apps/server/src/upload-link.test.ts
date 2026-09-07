import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { fileURLToPath } from "node:url";
import {
	createUploadLink,
	disableUploadLink,
} from "@docstore/api/services/upload-link.service";
import { auth } from "@docstore/auth";
import { createId } from "@docstore/db/id";
import { user } from "@docstore/db/schema/auth";
import { document } from "@docstore/db/schema/document";
import { uploadLink } from "@docstore/db/schema/intake";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { IngestionBinding } from "@docstore/ingestion";
import { createIngestionContext } from "@docstore/ingestion";
import type {
	CreateUploadLinkInput,
	PublicUploadLink,
	PublicUploadResult,
} from "@docstore/shared/upload-link";
import { UPLOAD_LINK_RATE_LIMIT } from "@docstore/shared/upload-link";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { createApp } from "./app";
import { resetRateLimit } from "./upload-link";

/**
 * Public upload by link: the `app.request()` harness exercises the Hono routes
 * without opening a port (the development server can run alongside).
 */

const PDF_PATH = fileURLToPath(
	new URL(
		"../../../packages/ocr/test/fixtures/text-layer.pdf",
		import.meta.url,
	),
);

let db: TestDb;
let app: Hono;
let userId: string;
let pdf: Uint8Array;
let storageRoot: string;

beforeAll(async () => {
	db = await createTestDb();
	pdf = new Uint8Array(await Bun.file(PDF_PATH).arrayBuffer());
	storageRoot = `${process.env.TEMP ?? "/tmp"}/docstore-upload-link-test`;
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	resetRateLimit();

	userId = createId("usr_");
	await db.insert(user).values({
		id: userId,
		name: "Camille Moreau",
		email: `${userId}@example.test`,
	});

	// Ingestion context without a queue: intake writes to the database and to
	// disk, no job is published.
	const ingestion: IngestionBinding = {
		ctx: createIngestionContext({
			db,
			storagePath: storageRoot,
			// Binaries are resolved when the context starts, even though the
			// public upload does not use them (no queue, hence no OCR).
			tools: {
				tesseractPath: process.env.TESSERACT_PATH || undefined,
				tessdataPrefix: process.env.TESSDATA_PREFIX || undefined,
				popplerPath: process.env.POPPLER_PATH || undefined,
			},
		}),
	};

	app = createApp({
		db,
		auth,
		ingestion,
		corsOrigin: "http://127.0.0.1:3001",
		logRequests: false,
	});
});

async function createLink(
	overrides: Partial<CreateUploadLinkInput> = {},
): Promise<{ id: string; token: string }> {
	const created = await createUploadLink(db, userId, {
		name: "Accountant upload",
		message: "Please upload the balance sheets here.",
		expiresAt: null,
		maxUses: null,
		defaults: {},
		enabled: true,
		...overrides,
	});
	return { id: created.link.id, token: created.link.token };
}

/**
 * A link the clock caught up with.
 *
 * `createUploadLink` refuses an expiry already behind us — a link born expired
 * is never what the caller meant — so the only honest way to obtain one is to
 * mint it valid and move its column back.
 */
async function createExpiredLink(): Promise<{ id: string; token: string }> {
	const link = await createLink({
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
	});
	await db
		.update(uploadLink)
		.set({ expiresAt: new Date(Date.now() - 60_000) })
		.where(eq(uploadLink.id, link.id));
	return link;
}

/** The database is cleared before each test: only one link lives there at a time. */
async function currentLink() {
	const rows = await db.select().from(uploadLink);
	const row = rows[0];
	if (!row) throw new Error("Link not found.");
	return row;
}

/** Multipart request with a distinct IP per test (per-IP counter). */
async function postFiles(
	token: string,
	files: { name: string; bytes: Uint8Array; type?: string }[],
	ip = "203.0.113.10",
): Promise<Response> {
	const form = new FormData();
	for (const file of files) {
		form.append(
			"files",
			new File([file.bytes], file.name, {
				type: file.type ?? "application/pdf",
			}),
		);
	}
	return await app.request(`/api/u/${token}`, {
		method: "POST",
		body: form,
		headers: { "x-forwarded-for": ip },
	});
}

describe("GET /api/u/:token", () => {
	test("returns the name, the message and the remaining quota", async () => {
		const { token } = await createLink({ maxUses: 3 });

		const response = await app.request(`/api/u/${token}`, {
			headers: { "x-forwarded-for": "203.0.113.1" },
		});
		expect(response.status).toBe(200);

		const body = (await response.json()) as PublicUploadLink;
		expect(body).toEqual({
			name: "Accountant upload",
			message: "Please upload the balance sheets here.",
			expired: false,
			remainingUses: 3,
		});
	});

	test("responds 404 on an unknown token", async () => {
		const response = await app.request("/api/u/nonexistent-token", {
			headers: { "x-forwarded-for": "203.0.113.2" },
		});
		expect(response.status).toBe(404);
	});

	test("reports an expired link without refusing to read it", async () => {
		const { token } = await createExpiredLink();

		const response = await app.request(`/api/u/${token}`, {
			headers: { "x-forwarded-for": "203.0.113.3" },
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as PublicUploadLink;
		expect(body.expired).toBe(true);
	});
});

describe("POST /api/u/:token", () => {
	test("uploads a file, assigns it to the creator and increments the counter", async () => {
		const { token } = await createLink();

		const response = await postFiles(token, [
			{ name: "bilan-2026.pdf", bytes: pdf },
		]);
		expect(response.status).toBe(201);

		const body = (await response.json()) as PublicUploadResult;
		expect(body.created).toEqual([{ filename: "bilan-2026.pdf" }]);
		expect(body.errors).toEqual([]);

		const [doc] = await db.select().from(document);
		expect(doc?.source).toBe("link");
		expect(doc?.createdById).toBe(userId);
		expect(doc?.title).toBe("bilan-2026");

		const link = await currentLink();
		expect(link.uses).toBe(1);
		expect(doc?.sourceRef).toBe(link.id);
	});

	test("rejects an unsupported type without blocking the rest of the batch", async () => {
		const { token } = await createLink();

		const response = await postFiles(token, [
			{ name: "bilan.pdf", bytes: pdf },
			{
				name: "notes.txt",
				bytes: new TextEncoder().encode("hello"),
				type: "text/plain",
			},
		]);
		expect(response.status).toBe(201);

		const body = (await response.json()) as PublicUploadResult;
		expect(body.created).toEqual([{ filename: "bilan.pdf" }]);
		expect(body.errors).toHaveLength(1);
		expect(body.errors[0]?.filename).toBe("notes.txt");
	});

	test("rejects a file whose content is not a supported format", async () => {
		const { token } = await createLink();

		// The name and the declared type say PDF; the bytes say otherwise.
		const response = await postFiles(token, [
			{ name: "bilan.pdf", bytes: pdf },
			{
				name: "fake.pdf",
				bytes: new TextEncoder().encode("this is not a PDF"),
			},
		]);
		expect(response.status).toBe(201);

		const body = (await response.json()) as PublicUploadResult;
		expect(body.created).toEqual([{ filename: "bilan.pdf" }]);
		expect(body.errors).toHaveLength(1);
		expect(body.errors[0]?.filename).toBe("fake.pdf");
		expect(body.errors[0]?.message).toContain("Accepted formats");

		// Only the real PDF became a document.
		expect(await db.select().from(document)).toHaveLength(1);
	});

	test("responds 410 when the link has expired", async () => {
		const { token } = await createExpiredLink();

		const response = await postFiles(token, [{ name: "x.pdf", bytes: pdf }]);
		expect(response.status).toBe(410);
		expect(await db.select().from(document)).toHaveLength(0);
	});

	test("responds 410 when the quota is exhausted", async () => {
		const { token } = await createLink({ maxUses: 1 });

		expect(
			(await postFiles(token, [{ name: "a.pdf", bytes: pdf }])).status,
		).toBe(201);
		const second = await postFiles(token, [{ name: "b.pdf", bytes: pdf }]);
		expect(second.status).toBe(410);
	});

	test("responds 410 when the link is disabled", async () => {
		const { id, token } = await createLink();
		await disableUploadLink(db, id);

		const response = await postFiles(token, [{ name: "a.pdf", bytes: pdf }]);
		expect(response.status).toBe(410);
	});

	test("responds 429 beyond the per-IP rate limit", async () => {
		const { token } = await createLink();
		const ip = "203.0.113.77";

		for (let index = 0; index < UPLOAD_LINK_RATE_LIMIT; index++) {
			const response = await app.request(`/api/u/${token}`, {
				headers: { "x-forwarded-for": ip },
			});
			expect(response.status).toBe(200);
		}

		const blocked = await app.request(`/api/u/${token}`, {
			headers: { "x-forwarded-for": ip },
		});
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get("Retry-After")).toBeTruthy();

		// Another IP is not penalized.
		const other = await app.request(`/api/u/${token}`, {
			headers: { "x-forwarded-for": "203.0.113.78" },
		});
		expect(other.status).toBe(200);
	});
});
