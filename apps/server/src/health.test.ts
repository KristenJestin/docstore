import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auth } from "@docstore/auth";
import { createTestDb, type TestDb } from "@docstore/db/test-utils";
import type { IngestionBinding } from "@docstore/ingestion";
import { createIngestionContext } from "@docstore/ingestion";
import { testToolOptions } from "@docstore/ingestion/test-utils";
import { deriveStorageMasterKey } from "@docstore/storage";
import type { Hono } from "hono";
import { createApp } from "./app";
import { checkStorageWritable, type HealthReport } from "./health";

/**
 * `GET /health`: beyond the queue, the three facts a deployment checks —
 * writable storage, reachable OCR binaries, encryption at rest armed.
 */

const APP_SECRET = "health-test-secret-health-test-secret";

let db: TestDb;
let rootDir: string;
let ingestion: IngestionBinding;

beforeAll(async () => {
	db = await createTestDb();
	rootDir = await mkdtemp(join(tmpdir(), "docstore-health-test-"));
	ingestion = {
		ctx: createIngestionContext({
			db,
			storagePath: join(rootDir, "storage"),
			tmpDir: join(rootDir, "tmp"),
			tools: testToolOptions,
			encryption: { masterKey: deriveStorageMasterKey(APP_SECRET) },
		}),
	};
});

afterAll(async () => {
	await rm(rootDir, { recursive: true, force: true });
	await db.$client.end();
});

function build(binding: IngestionBinding | undefined): Hono {
	return createApp({
		db,
		auth,
		ingestion: binding,
		corsOrigin: "http://localhost:3001",
		appSecret: APP_SECRET,
		logRequests: false,
	});
}

async function report(binding: IngestionBinding | undefined) {
	const response = await build(binding).request("/health");
	expect(response.status).toBe(200);
	return (await response.json()) as HealthReport;
}

describe("GET /health", () => {
	test("reports the storage, the OCR binaries and encryption", async () => {
		const body = await report(ingestion);

		expect(body.status).toBe("ok");
		expect(body.storage.path).toBe(join(rootDir, "storage"));
		// The root does not exist yet: the probe creates it, which is exactly what
		// intake would do on the first upload.
		expect(body.storage.writable).toBe(true);
		expect(body.ocr).toEqual({ tesseract: true, poppler: true });
		expect(body.encryption).toBe(true);
		expect(body.queue).toMatchObject({ started: false, worker: 0 });
	});

	test("a degraded server (no ingestion) answers without lying", async () => {
		const body = await report(undefined);

		expect(body.status).toBe("ok");
		expect(body.storage).toEqual({ path: null, writable: false });
		expect(body.ocr).toEqual({ tesseract: false, poppler: false });
		expect(body.encryption).toBe(false);
	});

	test("encryption is false without a master key", async () => {
		const body = await report({
			ctx: createIngestionContext({
				db,
				storagePath: join(rootDir, "plain"),
				tmpDir: join(rootDir, "tmp"),
				tools: testToolOptions,
			}),
		});
		expect(body.encryption).toBe(false);
		expect(body.storage.writable).toBe(true);
	});

	test("an unusable storage root is reported as not writable", async () => {
		// A file where a directory is expected: `mkdir` fails, so does the probe.
		const file = join(rootDir, "not-a-directory");
		await Bun.write(file, "x");
		expect(await checkStorageWritable(join(file, "storage"))).toBe(false);
	});
});
