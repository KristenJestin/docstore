import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { document, documentFile } from "@docstore/db/schema/document";
import { documentRelation } from "@docstore/db/schema/relation";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import { sha256 } from "@docstore/storage";
import { eq } from "drizzle-orm";
import { zipSync } from "fflate";
import type { IngestionContext } from "./context";
import {
	ArchiveError,
	DuplicateOriginalError,
	UnsupportedMediaError,
} from "./errors";
import { intakeFile, isArchive, isCreated, isDuplicate } from "./intake";
import { writeSetting } from "./settings";
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
		if (!isCreated(result)) throw new Error("expected a created document");

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
		if (!isCreated(result)) throw new Error("expected a created document");
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
		if (!isCreated(first)) throw new Error("expected a created document");

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
		if (!isCreated(first)) throw new Error("expected a created document");
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
		if (!isCreated(result)) throw new Error("expected a created document");

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

describe("intakeFile — ZIP archives", () => {
	/** 2 PDFs, a text file, archiver debris and a nested archive. */
	async function batchZip(): Promise<Uint8Array> {
		const invoice = await readFixture(FIXTURES.invoiceSiretPdf);
		return zipSync({
			"2026/text-layer.pdf": pdf,
			"2026/invoice-siret.pdf": invoice,
			"notes.txt": new TextEncoder().encode("nothing to see"),
			"__MACOSX/._text-layer.pdf": new TextEncoder().encode("fork"),
			"nested.zip": zipSync({
				"payslip.pdf": await readFixture(FIXTURES.payslipPeriodPdf),
			}),
		});
	}

	function expectArchive(result: Awaited<ReturnType<typeof intakeFile>>) {
		if (!isArchive(result)) throw new Error("expected an archive result");
		return result.archive;
	}

	test("extract: one document per usable entry, junk left out", async () => {
		const archive = expectArchive(
			await intakeFile(ctx, {
				data: await batchZip(),
				filename: "batch.zip",
				mime: "application/zip",
				createdById: userId,
				archives: "extract",
			}),
		);

		expect(archive.mode).toBe("extract");
		expect(archive.archiveDocumentId).toBeNull();
		expect(archive.extracted.map((entry) => entry.entry).sort()).toEqual([
			"2026/invoice-siret.pdf",
			"2026/text-layer.pdf",
			"nested.zip!payslip.pdf",
		]);
		expect(archive.skipped.map((entry) => entry.entry).sort()).toEqual([
			"__MACOSX/._text-layer.pdf",
			"notes.txt",
		]);

		const rows = await db.select().from(document);
		expect(rows).toHaveLength(3);
		// Every document says which archive and which entry it came from.
		const one = rows.find((row) => row.title === "text-layer");
		expect(one?.sourceRef).toBe("batch.zip!2026/text-layer.pdf");
		expect(one?.intakeMeta?.archive).toEqual({
			name: "batch.zip",
			entry: "2026/text-layer.pdf",
		});
		expect(one?.status).toBe("processing");
	});

	test("keep: the archive itself becomes a searchable document", async () => {
		const archive = expectArchive(
			await intakeFile(ctx, {
				data: await batchZip(),
				filename: "batch.zip",
				mime: "application/zip",
				createdById: userId,
				archives: "keep",
			}),
		);

		expect(archive.mode).toBe("keep");
		expect(archive.extracted).toHaveLength(0);
		expect(archive.archiveDocumentId).toBeString();

		const rows = await db.select().from(document);
		expect(rows).toHaveLength(1);
		const [doc] = rows;
		expect(doc?.title).toBe("batch");
		// No OCR to wait for: the archive is usable straight away.
		expect(doc?.status).toBe("active");
		// The entry list is what makes the archive findable by file name.
		expect(doc?.content).toContain("2026/invoice-siret.pdf");
		expect(doc?.content).not.toContain("__MACOSX");

		const [file] = await db
			.select()
			.from(documentFile)
			.where(eq(documentFile.documentId, doc?.id ?? ""));
		expect(file?.mime).toBe("application/zip");
		expect(file?.storageKey).toEndWith(".zip");
		expect(file?.thumbnailKey).toBeNull();
	});

	test("both: the archive is linked to everything it held", async () => {
		const archive = expectArchive(
			await intakeFile(ctx, {
				data: await batchZip(),
				filename: "batch.zip",
				mime: "application/zip",
				createdById: userId,
				archives: "both",
			}),
		);

		expect(archive.extracted).toHaveLength(3);
		expect(archive.archiveDocumentId).toBeString();
		expect(await db.select().from(document)).toHaveLength(4);

		const relations = await db
			.select()
			.from(documentRelation)
			.where(
				eq(documentRelation.fromDocumentId, archive.archiveDocumentId ?? ""),
			);
		expect(relations).toHaveLength(3);
		expect(relations.every((row) => row.kind === "related_to")).toBe(true);
		expect(relations.map((row) => row.toDocumentId).sort()).toEqual(
			archive.extracted.map((entry) => entry.documentId).sort(),
		);
	});

	test("an entry already stored comes back as a duplicate", async () => {
		const first = await intakeFile(ctx, {
			data: pdf,
			filename: "text-layer.pdf",
			mime: "application/pdf",
			createdById: userId,
		});
		if (!isCreated(first)) throw new Error("expected a created document");

		const archive = expectArchive(
			await intakeFile(ctx, {
				data: zipSync({ "text-layer.pdf": pdf }),
				filename: "batch.zip",
				mime: "application/zip",
				createdById: userId,
				archives: "extract",
			}),
		);
		expect(archive.extracted).toHaveLength(0);
		expect(archive.duplicates).toEqual([
			{
				entry: "text-layer.pdf",
				duplicateOf: first.documentId,
				trashed: false,
			},
		]);
	});

	test("the mode falls back on the `intake.archives` setting", async () => {
		await writeSetting(db, "intake.archives", "keep");
		const archive = expectArchive(
			await intakeFile(ctx, {
				data: zipSync({ "text-layer.pdf": pdf }),
				filename: "batch.zip",
				mime: "application/zip",
				createdById: userId,
			}),
		);
		expect(archive.mode).toBe("keep");
		expect(archive.archiveDocumentId).toBeString();
	});

	test("the channel default values reach the extracted documents", async () => {
		const archive = expectArchive(
			await intakeFile(ctx, {
				data: zipSync({ "text-layer.pdf": pdf }),
				filename: "batch.zip",
				mime: "application/zip",
				createdById: userId,
				source: "link",
				sourceRef: "lnk_x",
				defaults: { archives: "extract", sensitive: false },
			}),
		);
		expect(archive.mode).toBe("extract");
		const [doc] = await db.select().from(document);
		expect(doc?.source).toBe("link");
		// The entry reference replaces the reference of the channel.
		expect(doc?.sourceRef).toBe("batch.zip!text-layer.pdf");
	});

	test("a broken archive is a bad request, not a broken document", async () => {
		await expectRejection(
			intakeFile(ctx, {
				data: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
				filename: "batch.zip",
				mime: "application/zip",
				createdById: userId,
			}),
			ArchiveError,
		);
		expect(await db.select().from(document)).toHaveLength(0);
	});
});
