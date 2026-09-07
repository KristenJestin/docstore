import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { document, documentFile } from "@docstore/db/schema/document";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { IngestionBinding } from "@docstore/ingestion";
import { render } from "@docstore/ingestion";
import {
	createTestIngestion,
	FIXTURES,
	readFixture,
	type TestIngestion,
} from "@docstore/ingestion/test-utils";
import { sha256 } from "@docstore/storage";
import { createRouterClient, type RouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import {
	createTestContext,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";
import { appRouter } from "./index";

const TIMEOUT = 120_000;

let db: TestDb;
let ingestion: TestIngestion;
let binding: IngestionBinding;
let owner: TestUser;
let client: RouterClient<typeof appRouter>;
let pdf: Uint8Array;

/**
 * In-memory oRPC client enriched with the ingestion context (the shared
 * `createTestClient` does not inject one).
 */
function createFileClient(
	user: TestUser | null,
): RouterClient<typeof appRouter> {
	return createRouterClient(appRouter, {
		context: { ...createTestContext(db, user), ingestion: binding },
	});
}

/** `bun:test` hangs on `.rejects` with `pg` promises: unwrap manually. */
async function expectFailure(promise: Promise<unknown>): Promise<Error> {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error).not.toBeNull();
	return error as Error;
}

function pdfFile(name = "EDF invoice.pdf"): File {
	return new File([pdf], name, { type: "application/pdf" });
}

beforeAll(async () => {
	db = await createTestDb();
	ingestion = await createTestIngestion(db);
	binding = { ctx: ingestion.ctx };
	pdf = await readFixture(FIXTURES.textLayerPdf);
});

afterAll(async () => {
	await ingestion.cleanup();
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
	client = createFileClient(owner);
});

describe("file.upload", () => {
	test("creates one document per uploaded file", async () => {
		const result = await client.file.upload({ files: [pdfFile()] });

		expect(result.duplicates).toEqual([]);
		expect(result.created).toHaveLength(1);
		const entry = result.created[0];
		if (!entry) throw new Error("no document created");
		expect(entry.filename).toBe("EDF invoice.pdf");
		expect(entry.documentId).toStartWith("doc_");
		expect(entry.fileId).toStartWith("fil_");

		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, entry.documentId));
		expect(doc?.status).toBe("processing");
		expect(doc?.title).toBe("EDF invoice");
		expect(doc?.createdById).toBe(owner.id);
	});

	test("applies the provided title for a single upload", async () => {
		const result = await client.file.upload({
			files: [pdfFile()],
			title: "March 2024 invoice",
		});
		const entry = result.created[0];
		if (!entry) throw new Error("no document created");
		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, entry.documentId));
		expect(doc?.title).toBe("March 2024 invoice");
	});

	test("reports duplicates without creating anything", async () => {
		const first = await client.file.upload({ files: [pdfFile()] });
		const second = await client.file.upload({
			files: [pdfFile("copy.pdf")],
		});

		expect(second.created).toEqual([]);
		expect(second.duplicates).toEqual([
			{
				filename: "copy.pdf",
				duplicateOf: first.created[0]?.documentId ?? "",
				trashed: false,
			},
		]);
		expect(await db.select().from(document)).toHaveLength(1);
	});

	test("reports a duplicate held by a trashed document as `trashed`", async () => {
		const first = await client.file.upload({ files: [pdfFile()] });
		const documentId = first.created[0]?.documentId ?? "";
		await client.document.trash({ id: documentId });

		const second = await client.file.upload({
			files: [pdfFile("copy.pdf")],
		});

		// The unique sha256 index ignores `deleted_at`, so the insert fails: the
		// upload must still report a duplicate instead of a bare CONFLICT.
		expect(second.created).toEqual([]);
		expect(second.duplicates).toEqual([
			{ filename: "copy.pdf", duplicateOf: documentId, trashed: true },
		]);
		expect(await db.select().from(document)).toHaveLength(1);
	});

	test("rejects an unsupported type", async () => {
		const error = await expectFailure(
			client.file.upload({
				files: [new File(["text"], "notes.txt", { type: "text/plain" })],
			}),
		);
		expect(String(error)).toContain("Unsupported file type");
		expect(await db.select().from(document)).toHaveLength(0);
	});

	test("rejects a file whose content is not a supported format", async () => {
		// The name and the declared type say PDF; the magic bytes say otherwise.
		await expectOrpcError(
			client.file.upload({
				files: [
					new File(["this is not a PDF"], "invoice.pdf", {
						type: "application/pdf",
					}),
				],
			}),
			"BAD_REQUEST",
		);
		expect(await db.select().from(document)).toHaveLength(0);
	});

	test("rejects an anonymous session", async () => {
		const anonymous = createFileClient(null);
		await expectOrpcError(
			anonymous.file.upload({ files: [pdfFile()] }),
			"UNAUTHORIZED",
		);
	});

	test("a browser upload carries the `upload` source", async () => {
		const result = await client.file.upload({ files: [pdfFile()] });
		const entry = result.created[0];
		if (!entry) throw new Error("no document created");
		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, entry.documentId));
		expect(doc?.source).toBe("upload");
	});

	test("an API key upload carries the `api` source", async () => {
		// SPEC §5: the API/CLI is an intake channel in its own right.
		const viaApiKey = createRouterClient(appRouter, {
			context: {
				...createTestContext(db, owner, {
					id: "key_1",
					scopes: ["read", "write"],
				}),
				ingestion: binding,
			},
		});

		const result = await viaApiKey.file.upload({ files: [pdfFile()] });
		const entry = result.created[0];
		if (!entry) throw new Error("no document created");
		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, entry.documentId));
		expect(doc?.source).toBe("api");
	});
});

describe("file.download", () => {
	test("returns the original bytes", async () => {
		const uploaded = await client.file.upload({ files: [pdfFile()] });
		const entry = uploaded.created[0];
		if (!entry) throw new Error("no document created");

		const file = await client.file.download({ fileId: entry.fileId });
		expect(file.type).toBe("application/pdf");
		expect(file.name).toBe("EDF invoice.pdf");

		const bytes = new Uint8Array(await file.arrayBuffer());
		expect(bytes.byteLength).toBe(pdf.byteLength);
		expect(await sha256(bytes)).toBe(await sha256(pdf));
	});

	test("404 on an unknown file", async () => {
		const error = await expectFailure(
			client.file.download({ fileId: "fil_unknown" }),
		);
		expect(String(error)).toContain("File not found");
	});
});

describe("file.thumbnail", () => {
	test(
		"404 until the thumbnail is generated, then returns it",
		async () => {
			const uploaded = await client.file.upload({ files: [pdfFile()] });
			const entry = uploaded.created[0];
			if (!entry) throw new Error("no document created");

			const error = await expectFailure(
				client.file.thumbnail({ fileId: entry.fileId }),
			);
			expect(String(error)).toContain("Thumbnail not available");

			// `render` step of the pipeline (normally run by the worker).
			await render(ingestion.ctx, {
				documentId: entry.documentId,
				fileId: entry.fileId,
			});

			const [file] = await db
				.select()
				.from(documentFile)
				.where(eq(documentFile.id, entry.fileId));
			expect(file?.thumbnailKey).toBe(
				`thumbnails/${entry.documentId}/${entry.fileId}.png`,
			);

			const thumbnail = await client.file.thumbnail({ fileId: entry.fileId });
			expect(thumbnail.type).toBe("image/png");
			const bytes = new Uint8Array(await thumbnail.arrayBuffer());
			expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
		},
		TIMEOUT,
	);
});
