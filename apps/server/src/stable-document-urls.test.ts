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
import {
	deleteDocumentPermanently,
	mergeAsVersion,
	trashDocument,
} from "@docstore/api/services/document.service";
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
 * Stable document URLs (issue #2): `GET /d/<docId>` serves the primary file of
 * a document without resolving a `fil_` id first, redirects a merged id to the
 * kept document, and answers `410` once the document is permanently deleted.
 * The scopes of issue #1 apply exactly as on `/files`.
 */

const PDF_PATH = fileURLToPath(
	new URL(
		"../../../packages/ocr/test/fixtures/text-layer.pdf",
		import.meta.url,
	),
);

const APP_SECRET = "stable-urls-secret-stable-urls-secret";

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
		`docstore-stable-urls-test-${createId("")}`,
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

/** Real intake of a unique PDF: every call yields a new sha256. */
async function seedDocument(
	options: { sensitive?: boolean; filename?: string } = {},
): Promise<{
	documentId: string;
	fileId: string;
	bytes: Uint8Array<ArrayBuffer>;
}> {
	const suffix = new TextEncoder().encode(`\n% ${createId("")}\n`);
	const bytes = new Uint8Array(pdf.byteLength + suffix.byteLength);
	bytes.set(pdf, 0);
	bytes.set(suffix, pdf.byteLength);
	const result = await intakeFile(ingestion.ctx, {
		data: bytes,
		filename: options.filename ?? "lease.pdf",
		mime: "application/pdf",
		createdById: userId,
		title: "Lease",
	});
	if (!isCreated(result)) throw new Error("expected a created document");
	if (options.sensitive) {
		await setSensitive(ingestion.ctx, result.documentId, true);
	}
	return { documentId: result.documentId, fileId: result.fileId, bytes };
}

async function get(path: string, secret?: string): Promise<Response> {
	return await app.request(path, {
		headers: secret ? { Authorization: `Bearer ${secret}` } : {},
		redirect: "manual",
	});
}

describe("Docstore SHALL serve the primary file of a document at a stable URL", () => {
	test("WHEN a key with read gets /d/<docId> THEN the PDF is downloaded as an attachment", async () => {
		const { documentId, bytes } = await seedDocument();
		const response = await get(`/d/${documentId}`, readSecret);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/pdf");
		expect(response.headers.get("content-disposition")).toStartWith(
			"attachment;",
		);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	});

	test("WHEN ?disposition=inline is asked THEN the same file is served inline", async () => {
		const { documentId, bytes } = await seedDocument();
		const response = await get(
			`/d/${documentId}?disposition=inline`,
			readSecret,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-disposition")).toStartWith("inline;");
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	});

	test("WHEN the document holds attachments too THEN /d/ serves its original file", async () => {
		const kept = await seedDocument({ filename: "kept.pdf" });
		const duplicate = await seedDocument({ filename: "copy.pdf" });
		await mergeAsVersion(db, {
			documentId: duplicate.documentId,
			intoDocumentId: kept.documentId,
		});
		// The moved file is the older one: the original must still win.
		await db
			.update(documentFile)
			.set({ createdAt: new Date("2000-01-01T00:00:00Z") })
			.where(eq(documentFile.id, duplicate.fileId));

		const response = await get(`/d/${kept.documentId}`, readSecret);
		expect(response.status).toBe(200);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(kept.bytes);
	});

	test("WHEN an id never existed THEN /d/ answers 404", async () => {
		const response = await get("/d/doc_neverexisted", readSecret);
		expect(response.status).toBe(404);
	});
});

describe("Docstore SHALL redirect the stable URL of a merged document to the kept document", () => {
	test("WHEN B was merged into A THEN /d/<B> answers 302 to /d/<A>, keeping the disposition", async () => {
		const kept = await seedDocument();
		const duplicate = await seedDocument();
		await mergeAsVersion(db, {
			documentId: duplicate.documentId,
			intoDocumentId: kept.documentId,
		});

		const response = await get(
			`/d/${duplicate.documentId}?disposition=inline`,
			readSecret,
		);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			`/d/${kept.documentId}?disposition=inline`,
		);

		const followed = await get(
			response.headers.get("location") ?? "",
			readSecret,
		);
		expect(followed.status).toBe(200);
		expect(new Uint8Array(await followed.arrayBuffer())).toEqual(kept.bytes);
	});

	test("WHEN the merged document was permanently deleted since THEN /d/<B> still redirects", async () => {
		const kept = await seedDocument();
		const duplicate = await seedDocument();
		await mergeAsVersion(db, {
			documentId: duplicate.documentId,
			intoDocumentId: kept.documentId,
		});
		await deleteDocumentPermanently(db, duplicate.documentId);

		const response = await get(`/d/${duplicate.documentId}`, readSecret);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(`/d/${kept.documentId}`);
	});
});

describe("Docstore SHALL keep serving a trashed document and answer 410 once it is gone", () => {
	test("WHEN the document is in the trash without a merge THEN /d/ still serves its file", async () => {
		const { documentId, bytes } = await seedDocument();
		await trashDocument(db, documentId);

		const response = await get(`/d/${documentId}`, readSecret);
		expect(response.status).toBe(200);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	});

	test("WHEN the document was permanently deleted THEN /d/ answers 410 GONE", async () => {
		const { documentId } = await seedDocument();
		await deleteDocumentPermanently(db, documentId);

		const response = await get(`/d/${documentId}`, readSecret);
		expect(response.status).toBe(410);
		const json = (await response.json()) as { error: string };
		expect(json.error).toBe("GONE");
	});
});

describe("Docstore SHALL apply the API key scopes of /files to /d/", () => {
	test("WHEN a key with only write gets /d/<docId> THEN the response is 403", async () => {
		const { documentId } = await seedDocument();
		expect((await get(`/d/${documentId}`, writeSecret)).status).toBe(403);
	});

	test("WHEN nobody is authenticated THEN the response is 401", async () => {
		const { documentId } = await seedDocument();
		expect((await get(`/d/${documentId}`)).status).toBe(401);
	});

	test("WHEN the request is unauthenticated THEN a merged id does not reveal its target", async () => {
		const kept = await seedDocument();
		const duplicate = await seedDocument();
		await mergeAsVersion(db, {
			documentId: duplicate.documentId,
			intoDocumentId: kept.documentId,
		});
		const response = await get(`/d/${duplicate.documentId}`);
		expect(response.status).toBe(401);
		expect(response.headers.get("location")).toBeNull();
	});

	test("WHEN a key with read only gets a sensitive document THEN the response is 403 and no byte of the file is sent", async () => {
		const { documentId, bytes } = await seedDocument({ sensitive: true });
		const response = await get(`/d/${documentId}`, readSecret);
		expect(response.status).toBe(403);
		const body = new Uint8Array(await response.arrayBuffer());
		expect(body.byteLength).toBeLessThan(bytes.byteLength);
		const json = JSON.parse(new TextDecoder().decode(body));
		expect(json.error).toBe("FORBIDDEN");
	});

	test("WHEN a key with read + sensitive gets a sensitive document THEN the decrypted file is served", async () => {
		const { documentId, bytes } = await seedDocument({ sensitive: true });
		const response = await get(`/d/${documentId}`, sensitiveSecret);
		expect(response.status).toBe(200);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	});
});

describe("Docstore SHALL describe the stable URL and the new fields in the OpenAPI reference", () => {
	test("WHEN the spec is fetched THEN it lists GET /d/{docId} and document.get returns webUrl, fileUrl and redirectedFrom", async () => {
		const response = await get("/api-reference/spec.json", readSecret);
		expect(response.status).toBe(200);
		const spec = (await response.json()) as {
			paths: Record<string, Record<string, unknown>>;
		};
		const stable = spec.paths["/d/{docId}"];
		expect(stable?.get).toBeDefined();

		const text = JSON.stringify(spec.paths["/documents/{id}"]?.get);
		expect(text).toContain("webUrl");
		expect(text).toContain("fileUrl");
		expect(text).toContain("redirectedFrom");
	});
});
