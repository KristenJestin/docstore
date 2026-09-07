import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { document, documentFile } from "@docstore/db/schema/document";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import { sha256 } from "@docstore/storage";
import { eq } from "drizzle-orm";
import type { IngestionContext } from "./context";
import { DuplicateOriginalError, UnsupportedMediaError } from "./errors";
import { intakeFile, isDuplicate } from "./intake";
import {
	createTestIngestion,
	expectRejection,
	FIXTURES,
	insertTestUser,
	readFixture,
	type TestIngestion,
} from "./test-utils";

let db: TestDb;
let ingestion: TestIngestion;
let ctx: IngestionContext;
let userId: string;
let pdf: Uint8Array;

beforeAll(async () => {
	db = await createTestDb();
	ingestion = await createTestIngestion(db);
	ctx = ingestion.ctx;
	pdf = await readFixture(FIXTURES.textLayerPdf);
});

afterAll(async () => {
	await ingestion.cleanup();
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	userId = await insertTestUser(db);
});

describe("intakeFile", () => {
	test("creates a document in processing and writes the file", async () => {
		const result = await intakeFile(ctx, {
			data: pdf,
			filename: "EDF Invoice.pdf",
			mime: "application/pdf",
			createdById: userId,
		});
		expect(isDuplicate(result)).toBe(false);
		if (isDuplicate(result)) throw new Error("unexpected duplicate");

		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, result.documentId));
		expect(doc?.status).toBe("processing");
		expect(doc?.title).toBe("EDF Invoice");
		expect(doc?.createdById).toBe(userId);
		expect(doc?.content).toBeNull();

		const [file] = await db
			.select()
			.from(documentFile)
			.where(eq(documentFile.id, result.fileId));
		expect(file?.kind).toBe("original");
		expect(file?.mime).toBe("application/pdf");
		expect(file?.filename).toBe("EDF Invoice.pdf");
		expect(file?.size).toBe(pdf.byteLength);
		expect(file?.sha256).toBe(await sha256(pdf));
		expect(file?.storageKey).toBe(
			`documents/${result.documentId}/${result.fileId}.pdf`,
		);
		expect(file?.thumbnailKey).toBeNull();

		if (!file) throw new Error("file not inserted");
		expect(await ctx.storage.exists(file.storageKey)).toBe(true);
		const stored = await ctx.storage.get(file.storageKey);
		expect(await sha256(stored)).toBe(file.sha256);
	});

	test("the explicit title takes precedence over the file name", async () => {
		const result = await intakeFile(ctx, {
			data: pdf,
			filename: "scan0001.pdf",
			mime: "application/pdf",
			createdById: userId,
			title: "December payslip",
		});
		if (isDuplicate(result)) throw new Error("unexpected duplicate");
		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, result.documentId));
		expect(doc?.title).toBe("December payslip");
	});

	test("detects the duplicate on the second upload", async () => {
		const first = await intakeFile(ctx, {
			data: pdf,
			filename: "invoice.pdf",
			mime: "application/pdf",
			createdById: userId,
		});
		if (isDuplicate(first)) throw new Error("unexpected duplicate");

		const second = await intakeFile(ctx, {
			data: new Blob([pdf]),
			filename: "invoice-copy.pdf",
			mime: "application/pdf",
			createdById: userId,
		});
		expect(second.duplicateOf).toBe(first.documentId);

		const rows = await db.select().from(document);
		expect(rows).toHaveLength(1);
	});

	test("a document in the trash is not reported as a duplicate but stays blocked by the unique index", async () => {
		const first = await intakeFile(ctx, {
			data: pdf,
			filename: "invoice.pdf",
			mime: "application/pdf",
			createdById: userId,
		});
		if (isDuplicate(first)) throw new Error("unexpected duplicate");
		await db
			.update(document)
			.set({ deletedAt: new Date() })
			.where(eq(document.id, first.documentId));

		// `document_file_sha256_original_uidx` does not filter `deleted_at`: the
		// insert fails and the error is translated into a business error.
		await expectRejection(
			intakeFile(ctx, {
				data: pdf,
				filename: "invoice.pdf",
				mime: "application/pdf",
				createdById: userId,
			}),
			DuplicateOriginalError,
		);

		// No orphan document nor object is left behind.
		expect(await db.select().from(document)).toHaveLength(1);
		const files = await db.select().from(documentFile);
		expect(files).toHaveLength(1);
	});

	test("rejects a disallowed type without creating anything", async () => {
		await expectRejection(
			intakeFile(ctx, {
				data: new TextEncoder().encode("hello"),
				filename: "notes.txt",
				mime: "text/plain",
				createdById: userId,
			}),
			UnsupportedMediaError,
		);

		expect(await db.select().from(document)).toHaveLength(0);
	});
});

describe("intakeFile — content sniffing", () => {
	test("refuses content that is not one of the accepted formats", async () => {
		await expectRejection(
			intakeFile(ctx, {
				// A `.pdf` name and the right MIME type, but the bytes say otherwise.
				data: new TextEncoder().encode("this is not a PDF"),
				filename: "invoice.pdf",
				mime: "application/pdf",
				createdById: userId,
			}),
			UnsupportedMediaError,
		);

		expect(await db.select().from(document)).toHaveLength(0);
		expect(await db.select().from(documentFile)).toHaveLength(0);
	});

	test("refuses an empty file", async () => {
		await expectRejection(
			intakeFile(ctx, {
				data: new Uint8Array(),
				filename: "empty.pdf",
				mime: "application/pdf",
				createdById: userId,
			}),
			UnsupportedMediaError,
		);
	});

	test("the content wins over a wrong declared type", async () => {
		const png = await readFixture(FIXTURES.scannedPng);
		const result = await intakeFile(ctx, {
			data: png,
			// Announced as a PDF; the magic bytes say PNG.
			filename: "scan.pdf",
			mime: "application/pdf",
			createdById: userId,
		});
		if (isDuplicate(result)) throw new Error("unexpected duplicate");

		const [file] = await db
			.select()
			.from(documentFile)
			.where(eq(documentFile.id, result.fileId));
		expect(file?.mime).toBe("image/png");
		expect(file?.storageKey).toEndWith(".png");
	});

	test("a real PDF still goes through", async () => {
		const result = await intakeFile(ctx, {
			data: pdf,
			filename: "invoice.pdf",
			mime: "application/pdf",
			createdById: userId,
		});
		expect(isDuplicate(result)).toBe(false);
	});
});
