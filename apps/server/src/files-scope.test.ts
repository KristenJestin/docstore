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
import { documentFile } from "@docstore/db/schema/document";
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
import type { Hono } from "hono";
import { createApp } from "./app";

/**
 * API key scopes on `/files` (issue #1, SPEC §6): an API key needs `read` to
 * download anything, and `sensitive` for the bytes or the thumbnail of a
 * sensitive document. Refusals are 403 and no byte of the file is sent.
 */

const PDF_PATH = fileURLToPath(
	new URL(
		"../../../packages/ocr/test/fixtures/text-layer.pdf",
		import.meta.url,
	),
);

const APP_SECRET = "files-scope-secret-files-scope-secret";
const THUMBNAIL_TEXT = "fake png thumbnail bytes";

let db: TestDb;
let app: Hono;
let userId: string;
let pdf: Uint8Array;
let storageRoot: string;
let ingestion: IngestionBinding;
let readSecret: string;
let writeSecret: string;
let sensitiveSecret: string;

beforeAll(async () => {
	db = await createTestDb();
	pdf = new Uint8Array(await Bun.file(PDF_PATH).arrayBuffer());
	storageRoot = join(
		process.env.TEMP ?? "/tmp",
		`docstore-files-scope-test-${createId("")}`,
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
	writeSecret = (
		await createApiKey(db, userId, { name: "Writer", scopes: ["write"] })
	).secret;
	sensitiveSecret = (
		await createApiKey(db, userId, {
			name: "Reader+",
			scopes: ["read", "sensitive"],
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

/**
 * Real intake, plus a thumbnail stored in the clear; `setSensitive` then
 * re-keys the file and the thumbnail exactly as in production.
 */
async function seedDocument(options: {
	sensitive: boolean;
}): Promise<{ fileId: string; bytes: Uint8Array<ArrayBuffer> }> {
	const suffix = new TextEncoder().encode(`\n% ${createId("")}\n`);
	const bytes = new Uint8Array(pdf.byteLength + suffix.byteLength);
	bytes.set(pdf, 0);
	bytes.set(suffix, pdf.byteLength);
	const result = await intakeFile(ingestion.ctx, {
		data: bytes,
		filename: "payslip.pdf",
		mime: "application/pdf",
		createdById: userId,
		title: "Payslip",
	});
	if (!isCreated(result)) throw new Error("expected a created document");

	const thumbnailKey = `thumbs/${result.fileId}.png`;
	await ingestion.ctx.storage.put(
		thumbnailKey,
		new TextEncoder().encode(THUMBNAIL_TEXT),
	);
	await db
		.update(documentFile)
		.set({ thumbnailKey })
		.where(eq(documentFile.id, result.fileId));

	if (options.sensitive) {
		await setSensitive(ingestion.ctx, result.documentId, true);
	}
	return { fileId: result.fileId, bytes };
}

async function get(path: string, secret?: string): Promise<Response> {
	return await app.request(path, {
		headers: secret ? { Authorization: `Bearer ${secret}` } : {},
	});
}

describe("Docstore SHALL reject every read route for an API key without the read scope", () => {
	test("WHEN a key with only write downloads a file THEN the response is 403", async () => {
		const { fileId } = await seedDocument({ sensitive: false });
		const download = await get(`/files/${fileId}/download`, writeSecret);
		expect(download.status).toBe(403);
		const thumbnail = await get(`/files/${fileId}/thumbnail`, writeSecret);
		expect(thumbnail.status).toBe(403);
	});

	test("without any authentication, 401", async () => {
		const { fileId } = await seedDocument({ sensitive: false });
		expect((await get(`/files/${fileId}/download`)).status).toBe(401);
	});
});

describe("Docstore SHALL refuse the bytes of a sensitive document's files to an API key without the sensitive scope", () => {
	test("WHEN a key with read only downloads a file of a sensitive document THEN the response is 403 and no byte of the file is sent", async () => {
		const { fileId, bytes } = await seedDocument({ sensitive: true });
		const response = await get(`/files/${fileId}/download`, readSecret);
		expect(response.status).toBe(403);
		expect(response.headers.get("content-type")).toContain("application/json");
		const body = new Uint8Array(await response.arrayBuffer());
		expect(body.byteLength).toBeLessThan(bytes.byteLength);
		const json = JSON.parse(new TextDecoder().decode(body));
		expect(json.error).toBe("FORBIDDEN");
	});

	test("WHEN the same key downloads a file of a non-sensitive document THEN the file is served as today", async () => {
		const { fileId, bytes } = await seedDocument({ sensitive: false });
		const response = await get(`/files/${fileId}/download`, readSecret);
		expect(response.status).toBe(200);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	});

	test("WHEN a key with read + sensitive downloads a file of a sensitive document THEN the decrypted file is served", async () => {
		const { fileId, bytes } = await seedDocument({ sensitive: true });
		const response = await get(`/files/${fileId}/download`, sensitiveSecret);
		expect(response.status).toBe(200);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	});
});

describe("Docstore SHALL refuse the thumbnail of a sensitive document to an API key without sensitive", () => {
	test("WHEN a key with read only fetches the thumbnail of a sensitive document THEN the response is 403 and no byte of the thumbnail is sent", async () => {
		const { fileId } = await seedDocument({ sensitive: true });
		const response = await get(`/files/${fileId}/thumbnail`, readSecret);
		expect(response.status).toBe(403);
		const json = (await response.json()) as { error: string };
		expect(json.error).toBe("FORBIDDEN");
	});

	test("WHEN the same key fetches the thumbnail of a non-sensitive document THEN it is served as today", async () => {
		const { fileId } = await seedDocument({ sensitive: false });
		const response = await get(`/files/${fileId}/thumbnail`, readSecret);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(THUMBNAIL_TEXT);
	});

	test("WHEN a key with read + sensitive fetches the thumbnail of a sensitive document THEN the decrypted thumbnail is served", async () => {
		const { fileId } = await seedDocument({ sensitive: true });
		const response = await get(`/files/${fileId}/thumbnail`, sensitiveSecret);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(THUMBNAIL_TEXT);
	});
});
