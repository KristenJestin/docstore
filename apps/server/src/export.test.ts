import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiKey } from "@docstore/api/services/api-key.service";
import { auth } from "@docstore/auth";
import { createId } from "@docstore/db/id";
import { user } from "@docstore/db/schema/auth";
import { document } from "@docstore/db/schema/document";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { IngestionBinding } from "@docstore/ingestion";
import {
	createIngestionContext,
	intakeFile,
	isCreated,
	setSensitive,
} from "@docstore/ingestion";
import { deriveStorageMasterKey } from "@docstore/storage";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import type { Hono } from "hono";
import { createApp } from "./app";

/**
 * `POST /api/export` (SPEC §8 iteration 7): the archive is built from the real
 * storage, encrypted files included.
 */

const PDF_PATH = fileURLToPath(
	new URL(
		"../../../packages/ocr/test/fixtures/text-layer.pdf",
		import.meta.url,
	),
);

const APP_SECRET = "export-test-secret-export-test-secret";

let db: TestDb;
let app: Hono;
let userId: string;
let pdf: Uint8Array;
let storageRoot: string;
let ingestion: IngestionBinding;
let readSecret: string;
let sensitiveSecret: string;

beforeAll(async () => {
	db = await createTestDb();
	pdf = new Uint8Array(await Bun.file(PDF_PATH).arrayBuffer());
	storageRoot = join(
		process.env.TEMP ?? "/tmp",
		`docstore-export-test-${createId("")}`,
	);
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);

	userId = createId("usr_");
	await db.insert(user).values({
		id: userId,
		name: "Camille Moreau",
		email: `${userId}@example.test`,
	});
	readSecret = (
		await createApiKey(db, userId, { name: "Reader", scopes: ["read"] })
	).secret;
	sensitiveSecret = (
		await createApiKey(db, userId, {
			name: "Reader+",
			scopes: ["read", "write", "sensitive"],
		})
	).secret;

	ingestion = {
		ctx: createIngestionContext({
			db,
			storagePath: storageRoot,
			tools: {
				tesseractPath: process.env.TESSERACT_PATH || undefined,
				tessdataPrefix: process.env.TESSDATA_PREFIX || undefined,
				popplerPath: process.env.POPPLER_PATH || undefined,
			},
			encryption: { masterKey: deriveStorageMasterKey(APP_SECRET) },
		}),
	};

	app = createApp({
		db,
		auth,
		ingestion,
		corsOrigin: "http://127.0.0.1:3001",
		appSecret: APP_SECRET,
		logRequests: false,
	});
});

/** Distinct bytes per document: identical content would be a duplicate. */
function uniquePdf(marker: string): Uint8Array {
	const suffix = new TextEncoder().encode(`\n% ${marker}\n`);
	const bytes = new Uint8Array(pdf.byteLength + suffix.byteLength);
	bytes.set(pdf, 0);
	bytes.set(suffix, pdf.byteLength);
	return bytes;
}

async function seedDocument(
	title: string,
	options: { documentDate?: string; sensitive?: boolean } = {},
): Promise<{ documentId: string; bytes: Uint8Array }> {
	const bytes = uniquePdf(`${title}-${createId("")}`);
	const result = await intakeFile(ingestion.ctx, {
		data: bytes,
		filename: `${title}.pdf`,
		mime: "application/pdf",
		createdById: userId,
		title,
	});
	if (!isCreated(result)) throw new Error("expected a created document");
	if (options.documentDate) {
		await db
			.update(document)
			.set({ documentDate: options.documentDate, datePrecision: "day" })
			.where(eq(document.id, result.documentId));
	}
	if (options.sensitive) {
		await setSensitive(ingestion.ctx, result.documentId, true);
	}
	return { documentId: result.documentId, bytes };
}

async function post(body: unknown, secret: string): Promise<Response> {
	return await app.request("/api/export", {
		method: "POST",
		body: JSON.stringify(body),
		headers: {
			"content-type": "application/json",
			Authorization: `Bearer ${secret}`,
		},
	});
}

async function entries(
	response: Response,
): Promise<Record<string, Uint8Array>> {
	return unzipSync(new Uint8Array(await response.arrayBuffer()));
}

describe("POST /api/export", () => {
	test("without authentication, 401", async () => {
		const response = await app.request("/api/export", {
			method: "POST",
			body: "{}",
			headers: { "content-type": "application/json" },
		});
		expect(response.status).toBe(401);
	});

	test("exposes the Content-Disposition and X-Export-Count headers via CORS", async () => {
		await seedDocument("Water bill");

		const response = await app.request("/api/export", {
			method: "POST",
			body: JSON.stringify({ layout: "flat" }),
			headers: {
				"content-type": "application/json",
				Authorization: `Bearer ${readSecret}`,
				// Only a cross-origin request (the web app, on another port) makes
				// the browser apply `Access-Control-Expose-Headers`.
				Origin: "http://127.0.0.1:3001",
			},
		});
		expect(response.status).toBe(200);
		const exposed = response.headers.get("access-control-expose-headers");
		expect(exposed).toContain("Content-Disposition");
		expect(exposed).toContain("X-Export-Count");
	});

	test("streams a ZIP named after the template", async () => {
		const first = await seedDocument("Water bill", {
			documentDate: "2025-04-02",
		});
		await seedDocument("Loose note");

		const response = await post({ layout: "by-year" }, readSecret);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/zip");
		expect(response.headers.get("content-disposition")).toContain(
			"docstore-export-",
		);
		expect(response.headers.get("x-export-count")).toBe("2");

		const files = await entries(response);
		expect(Object.keys(files).sort()).toEqual(
			[
				"2025/2025-04-02 - Water bill.pdf",
				"undated/Loose note.pdf",
				"manifest.csv",
				"metadata.json",
			].sort(),
		);
		expect(files["2025/2025-04-02 - Water bill.pdf"]).toEqual(first.bytes);
	});

	test("sensitive documents are excluded by default and decrypted when asked for", async () => {
		const secret = await seedDocument("Blood test", { sensitive: true });
		await seedDocument("Receipt");

		const guarded = await post({}, sensitiveSecret);
		expect(Object.keys(await entries(guarded)).sort()).toEqual(
			["Receipt.pdf", "manifest.csv", "metadata.json"].sort(),
		);

		const opened = await post({ includeSensitive: true }, sensitiveSecret);
		const files = await entries(opened);
		expect(Object.keys(files)).toContain("Blood test.pdf");
		// Decrypted on the way into the archive.
		expect(files["Blood test.pdf"]).toEqual(secret.bytes);
	});

	test("includeSensitive requires the sensitive scope", async () => {
		await seedDocument("Anything");
		const response = await post({ includeSensitive: true }, readSecret);
		expect(response.status).toBe(403);
	});

	test("rejects an invalid body", async () => {
		const response = await post({ layout: "by-moon" }, readSecret);
		expect(response.status).toBe(400);
	});
});
