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
import { thumbnailKey } from "@docstore/storage";
import { eq } from "drizzle-orm";
import type { IngestionContext } from "./context";
import { PipelineTargetNotFoundError } from "./errors";
import { intakeFile, isDuplicate } from "./intake";
import {
	decideStatus,
	extractText,
	finalize,
	processDocument,
	render,
} from "./pipeline";
import {
	createTestIngestion,
	expectRejection,
	FIXTURES,
	insertTestUser,
	readFixture,
	type TestIngestion,
} from "./test-utils";

const TIMEOUT = 240_000;

let db: TestDb;
let ingestion: TestIngestion;
let ctx: IngestionContext;
let userId: string;
let textLayerPdf: Uint8Array;
let scannedPdf: Uint8Array;

beforeAll(async () => {
	db = await createTestDb();
	ingestion = await createTestIngestion(db);
	ctx = ingestion.ctx;
	textLayerPdf = await readFixture(FIXTURES.textLayerPdf);
	scannedPdf = await readFixture(FIXTURES.scannedPdf);
});

afterAll(async () => {
	await ingestion.cleanup();
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	userId = await insertTestUser(db);
});

async function intakePdf(
	data: Uint8Array,
	filename = "invoice.pdf",
): Promise<{ documentId: string; fileId: string }> {
	const result = await intakeFile(ctx, {
		data,
		filename,
		mime: "application/pdf",
		createdById: userId,
	});
	if (isDuplicate(result)) throw new Error("unexpected duplicate");
	return { documentId: result.documentId, fileId: result.fileId };
}

describe("extractText", () => {
	test(
		"fills content, ocrLayout and pageCount from the text layer",
		async () => {
			const payload = await intakePdf(textLayerPdf);
			await extractText(ctx, payload);

			const [doc] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			expect(doc?.content).toContain("FACTURE");
			expect(doc?.content).toContain("1 234,56");
			// The step does not change the status: that is `finalize`'s job.
			expect(doc?.status).toBe("processing");

			const [file] = await db
				.select()
				.from(documentFile)
				.where(eq(documentFile.id, payload.fileId));
			expect(file?.pageCount).toBe(2);
			expect(file?.ocrLayout?.pages).toHaveLength(2);
			const words = file?.ocrLayout?.pages[0]?.words ?? [];
			expect(words.length).toBeGreaterThan(5);
			expect(words.map((word) => word.text)).toContain("FACTURE");
		},
		TIMEOUT,
	);

	test(
		"OCRs a PDF without a text layer",
		async () => {
			const payload = await intakePdf(scannedPdf, "scan.pdf");
			await extractText(ctx, payload);

			const [doc] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			expect(doc?.content?.toLowerCase()).toContain("facture");
		},
		TIMEOUT,
	);

	test(
		"is idempotent",
		async () => {
			const payload = await intakePdf(textLayerPdf);
			await extractText(ctx, payload);
			const [first] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			await extractText(ctx, payload);
			const [second] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			expect(second?.content).toBe(first?.content ?? "");
		},
		TIMEOUT,
	);

	test("fails when the file does not exist", async () => {
		await expectRejection(
			extractText(ctx, { documentId: "doc_missing", fileId: "fil_missing" }),
			PipelineTargetNotFoundError,
		);
	});
});

describe("render", () => {
	test(
		"produces a thumbnail in the storage and fills thumbnailKey",
		async () => {
			const payload = await intakePdf(textLayerPdf);
			await render(ctx, payload);

			const key = thumbnailKey(payload.documentId, payload.fileId);
			expect(await ctx.storage.exists(key)).toBe(true);
			const png = new Uint8Array(
				await (await ctx.storage.get(key)).arrayBuffer(),
			);
			expect(png.byteLength).toBeGreaterThan(1000);
			// PNG signature.
			expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

			const [file] = await db
				.select()
				.from(documentFile)
				.where(eq(documentFile.id, payload.fileId));
			expect(file?.thumbnailKey).toBe(key);
		},
		TIMEOUT,
	);
});

describe("finalize", () => {
	test("moves the document from processing to active", async () => {
		const payload = await intakePdf(textLayerPdf);
		await finalize(ctx, payload);

		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, payload.documentId));
		expect(doc?.status).toBe("active");
		expect(doc?.processingError).toBeNull();
	});

	test("does not rewrite a status set meanwhile", async () => {
		const payload = await intakePdf(textLayerPdf);
		await db
			.update(document)
			.set({ status: "archived" })
			.where(eq(document.id, payload.documentId));
		await finalize(ctx, payload);

		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, payload.documentId));
		expect(doc?.status).toBe("archived");
	});

	test("decideStatus follows the review reasons", async () => {
		const payload = await intakePdf(textLayerPdf);
		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, payload.documentId));
		if (!doc) throw new Error("missing document");
		expect(await decideStatus(ctx, doc)).toBe("active");

		// The document has no category: `computeReviewReasons` keeps a
		// `missingCategory` reason (it only drops reasons that no longer apply).
		await db
			.update(document)
			.set({ reviewReasons: [{ code: "missingCategory", message: "…" }] })
			.where(eq(document.id, doc.id));
		const [withReason] = await db
			.select()
			.from(document)
			.where(eq(document.id, doc.id));
		if (!withReason) throw new Error("missing document");
		expect(await decideStatus(ctx, withReason)).toBe("review");
	});

	test("decideStatus ignores the informational `recurringCandidate`", async () => {
		const payload = await intakePdf(textLayerPdf);
		await db
			.update(document)
			.set({
				reviewReasons: [
					{
						code: "recurringCandidate",
						message: "Looks like a recurring document…",
						meta: { partyId: "prt_x", categoryId: "cat_x" },
					},
				],
			})
			.where(eq(document.id, payload.documentId));

		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, payload.documentId));
		if (!doc) throw new Error("missing document");
		expect(await decideStatus(ctx, doc)).toBe("active");
	});
});

describe("processDocument", () => {
	test(
		"chains the four steps",
		async () => {
			const payload = await intakePdf(textLayerPdf);
			await processDocument(ctx, payload);

			const [doc] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			// Without a category nor an Issuer, `analyze` sends the document to the
			// Review queue (default settings of iteration 3).
			expect(doc?.status).toBe("review");
			expect(doc?.reviewReasons.map((reason) => reason.code)).toEqual([
				// Date "15 mars 2024" inferred from the text, below the default
				// threshold.
				"lowConfidence",
				"missingCategory",
				"missingIssuer",
			]);
			expect(doc?.documentDate).toBe("2024-03-15");
			expect(doc?.content).toContain("FACTURE");
			expect(doc?.processingError).toBeNull();

			const [file] = await db
				.select()
				.from(documentFile)
				.where(eq(documentFile.id, payload.fileId));
			expect(file?.pageCount).toBe(2);
			expect(file?.thumbnailKey).toBe(
				thumbnailKey(payload.documentId, payload.fileId),
			);
		},
		TIMEOUT,
	);

	test(
		"logs the error and leaves the document in processing",
		async () => {
			const payload = await intakePdf(textLayerPdf);
			// The object disappears from the storage: `extractText` fails.
			const [file] = await db
				.select()
				.from(documentFile)
				.where(eq(documentFile.id, payload.fileId));
			if (!file) throw new Error("missing file");
			await ctx.storage.delete(file.storageKey);

			await expectRejection(processDocument(ctx, payload));

			const [doc] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			expect(doc?.status).toBe("processing");
			expect(doc?.processingError).toContain("[extractText]");
		},
		TIMEOUT,
	);
});

describe("processDocument — payslip dates", () => {
	test(
		"reads the covered period and the payment date off a real PDF",
		async () => {
			const payslipPdf = await readFixture(FIXTURES.payslipPeriodPdf);
			const payload = await intakePdf(payslipPdf, "payslip.pdf");
			await processDocument(ctx, payload);

			const [doc] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			expect(doc?.content).toContain("BULLETIN DE PAIE");

			// The period is the month the payslip covers…
			expect(doc?.periodStart).toBe("2026-08-01");
			expect(doc?.periodEnd).toBe("2026-08-31");
			// …and the document itself exists on the day it was paid, not on the
			// first day of that period — which is the first date of the text.
			expect(doc?.documentDate).toBe("2026-08-28");
			expect(doc?.datePrecision).toBe("day");
		},
		TIMEOUT,
	);

	/**
	 * The payslips ingested before `analyze` learnt to read "payé le" carry the
	 * first day of their period as their date. `document.reprocess` is what fixes
	 * them: the pipeline rewrites the metadata it computed itself, and only that.
	 */
	test(
		"reprocessing fixes a date the old analyzer got wrong",
		async () => {
			const payslipPdf = await readFixture(FIXTURES.payslipPeriodPdf);
			const payload = await intakePdf(payslipPdf, "payslip.pdf");
			await processDocument(ctx, payload);

			// The state the old behaviour left behind: the date is the start of the
			// period, the period itself was never filled, and nothing says a human
			// chose any of it.
			await db
				.update(document)
				.set({
					documentDate: "2026-08-01",
					datePrecision: "day",
					periodStart: null,
					periodEnd: null,
					manualFields: [],
				})
				.where(eq(document.id, payload.documentId));

			await processDocument(ctx, payload);

			const [fixed] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			expect(fixed?.documentDate).toBe("2026-08-28");
			expect(fixed?.periodStart).toBe("2026-08-01");
			expect(fixed?.periodEnd).toBe("2026-08-31");
		},
		TIMEOUT,
	);

	test(
		"a date entered by hand survives every reprocess",
		async () => {
			const payslipPdf = await readFixture(FIXTURES.payslipPeriodPdf);
			const payload = await intakePdf(payslipPdf, "payslip.pdf");
			await processDocument(ctx, payload);

			// What `document.update` writes when someone edits the date.
			await db
				.update(document)
				.set({
					documentDate: "2026-09-05",
					datePrecision: "day",
					manualFields: ["documentDate", "datePrecision"],
				})
				.where(eq(document.id, payload.documentId));

			await processDocument(ctx, payload);

			const [kept] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			expect(kept?.documentDate).toBe("2026-09-05");
			// The period is not marked: the pipeline still keeps it up to date.
			expect(kept?.periodStart).toBe("2026-08-01");
		},
		TIMEOUT,
	);
});

describe("processDocument — giving up", () => {
	/** Makes the first step fail: the stored object is gone. */
	async function breakStorage(payload: {
		documentId: string;
		fileId: string;
	}): Promise<void> {
		const [file] = await db
			.select()
			.from(documentFile)
			.where(eq(documentFile.id, payload.fileId));
		if (!file) throw new Error("missing file");
		await ctx.storage.delete(file.storageKey);
	}

	test(
		"an attempt that is not the last leaves the document in processing",
		async () => {
			const payload = await intakePdf(textLayerPdf);
			await breakStorage(payload);

			await expectRejection(
				processDocument(ctx, payload, { attempt: 1, maxAttempts: 4 }),
			);

			const [doc] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			expect(doc?.status).toBe("processing");
			expect(doc?.processingError).toContain("[extractText]");
		},
		TIMEOUT,
	);

	test(
		"the last attempt marks the document failed, with its error",
		async () => {
			const payload = await intakePdf(textLayerPdf);
			await breakStorage(payload);

			await expectRejection(
				processDocument(ctx, payload, { attempt: 4, maxAttempts: 4 }),
			);

			const [doc] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			expect(doc?.status).toBe("failed");
			expect(doc?.processingError).toContain("[extractText]");
		},
		TIMEOUT,
	);

	test(
		"a status set by the user in the meantime is not overwritten",
		async () => {
			const payload = await intakePdf(textLayerPdf);
			await breakStorage(payload);
			await db
				.update(document)
				.set({ status: "archived" })
				.where(eq(document.id, payload.documentId));

			await expectRejection(
				processDocument(ctx, payload, { attempt: 4, maxAttempts: 4 }),
			);

			const [doc] = await db
				.select()
				.from(document)
				.where(eq(document.id, payload.documentId));
			expect(doc?.status).toBe("archived");
		},
		TIMEOUT,
	);
});
