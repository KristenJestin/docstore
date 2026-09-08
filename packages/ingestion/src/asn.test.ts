import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { document, documentFile } from "@docstore/db/schema/document";
import { documentType } from "@docstore/db/schema/document-type";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import type { AsnAutoAssignMode } from "@docstore/shared/settings";
import { eq } from "drizzle-orm";
import { allocateAsn, isScannedDocument, maybeAutoAssignAsn } from "./asn";
import type { IngestionContext } from "./context";
import { applyDocumentType } from "./document-type";
import { intakeFile, isCreated } from "./intake";
import { extractText, finalize } from "./pipeline";
import { writeSetting } from "./settings";
import {
	createTestIngestion,
	FIXTURES,
	insertTestUser,
	readFixture,
	type TestIngestion,
} from "./test-utils";

/**
 * Automatic archive serial numbers (SPEC §2): the `asn.autoAssign` setting,
 * the `paperOriginal` document types, and the promise both share — a number is
 * handed out once and never taken back.
 */

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

function setMode(mode: AsnAutoAssignMode): Promise<void> {
	return writeSetting(db, "asn.autoAssign", mode);
}

async function intakePdf(
	data: Uint8Array,
	filename: string,
): Promise<{ documentId: string; fileId: string }> {
	const result = await intakeFile(ctx, {
		data,
		filename,
		mime: "application/pdf",
		createdById: userId,
	});
	if (!isCreated(result)) throw new Error("expected a created document");
	return { documentId: result.documentId, fileId: result.fileId };
}

/** Intake, text extraction and `finalize`: the three steps ASN depends on. */
async function ingest(
	data: Uint8Array,
	filename: string,
): Promise<{ documentId: string; fileId: string }> {
	const payload = await intakePdf(data, filename);
	await extractText(ctx, payload);
	await finalize(ctx, payload);
	return payload;
}

async function loadDocument(id: string) {
	const rows = await db.select().from(document).where(eq(document.id, id));
	const row = rows[0];
	if (!row) throw new Error("missing document");
	return row;
}

async function insertDocument(
	overrides: Partial<typeof document.$inferInsert> = {},
): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title: "Untitled",
			status: "active",
			createdById: userId,
			...overrides,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

describe("isScannedDocument", () => {
	test(
		"tells a PDF text layer from a page that went through OCR",
		async () => {
			const withLayer = await intakePdf(textLayerPdf, "invoice.pdf");
			const scanned = await intakePdf(scannedPdf, "scan.pdf");
			await extractText(ctx, withLayer);
			await extractText(ctx, scanned);

			expect(await isScannedDocument(db, withLayer.documentId)).toBe(false);
			expect(await isScannedDocument(db, scanned.documentId)).toBe(true);
		},
		TIMEOUT,
	);

	test("an image original never has a text layer to read", async () => {
		const id = await insertDocument();
		await db.insert(documentFile).values({
			documentId: id,
			kind: "original",
			filename: "receipt.png",
			mime: "image/png",
			size: 12,
			sha256: `sha-${id}`,
			storageKey: `originals/${id}.png`,
		});

		expect(await isScannedDocument(db, id)).toBe(true);
	});
});

describe("asn.autoAssign", () => {
	test(
		"`never` leaves both a text layer and a scan unnumbered",
		async () => {
			// `never` is the default: nothing is written for it on purpose.
			const withLayer = await ingest(textLayerPdf, "invoice.pdf");
			const scanned = await ingest(scannedPdf, "scan.pdf");

			expect((await loadDocument(withLayer.documentId)).asn).toBeNull();
			expect((await loadDocument(scanned.documentId)).asn).toBeNull();
		},
		TIMEOUT,
	);

	test(
		"`always` numbers every document, once each",
		async () => {
			await setMode("always");
			const first = await ingest(textLayerPdf, "invoice.pdf");
			const second = await ingest(scannedPdf, "scan.pdf");

			const one = await loadDocument(first.documentId);
			const two = await loadDocument(second.documentId);
			expect(one.asn).toBe(1);
			expect(one.asnSource).toBe("auto");
			expect(two.asn).toBe(2);
			expect(two.asnSource).toBe("auto");
		},
		TIMEOUT,
	);

	test(
		"`scans` only numbers the document whose text had to be recognised",
		async () => {
			await setMode("scans");
			const withLayer = await ingest(textLayerPdf, "invoice.pdf");
			const scanned = await ingest(scannedPdf, "scan.pdf");

			expect((await loadDocument(withLayer.documentId)).asn).toBeNull();
			const row = await loadDocument(scanned.documentId);
			expect(row.asn).toBe(1);
			expect(row.asnSource).toBe("auto");
		},
		TIMEOUT,
	);

	test(
		"reprocessing keeps the number the document already carries",
		async () => {
			await setMode("always");
			const payload = await ingest(textLayerPdf, "invoice.pdf");
			const assigned = (await loadDocument(payload.documentId)).asn;
			expect(assigned).toBe(1);

			await extractText(ctx, payload);
			await finalize(ctx, payload);

			expect((await loadDocument(payload.documentId)).asn).toBe(assigned);
		},
		TIMEOUT,
	);

	test("a trashed or failed document is left out", async () => {
		await setMode("always");
		const trashed = await insertDocument({ deletedAt: new Date() });
		const failed = await insertDocument({ status: "failed" });

		expect(await maybeAutoAssignAsn(ctx, trashed)).toBeNull();
		expect(await maybeAutoAssignAsn(ctx, failed)).toBeNull();
	});

	test("a number set by hand is never replaced", async () => {
		await setMode("always");
		const id = await insertDocument({ asn: 12 });

		expect(await maybeAutoAssignAsn(ctx, id)).toBeNull();
		const row = await loadDocument(id);
		expect(row.asn).toBe(12);
		expect(row.asnSource).toBe("manual");
	});
});

describe("paperOriginal document types", () => {
	async function insertType(paperOriginal: boolean): Promise<string> {
		const rows = await db
			.insert(documentType)
			.values({ name: "Payslip", paperOriginal })
			.returning({ id: documentType.id });
		const id = rows[0]?.id;
		if (!id) throw new Error("document type not inserted");
		return id;
	}

	test("applying the type numbers the document, whatever the setting says", async () => {
		const documentTypeId = await insertType(true);
		const id = await insertDocument();

		await applyDocumentType(db, id, documentTypeId, { source: "manual" });

		const row = await loadDocument(id);
		expect(row.asn).toBe(1);
		expect(row.asnSource).toBe("auto");
	});

	test("a type without the flag numbers nothing", async () => {
		const documentTypeId = await insertType(false);
		const id = await insertDocument();

		await applyDocumentType(db, id, documentTypeId, { source: "manual" });

		expect((await loadDocument(id)).asn).toBeNull();
	});

	test("applying it twice does not hand out a second number", async () => {
		const documentTypeId = await insertType(true);
		const id = await insertDocument();

		await applyDocumentType(db, id, documentTypeId, { source: "manual" });
		const first = (await loadDocument(id)).asn;
		await applyDocumentType(db, id, documentTypeId, { source: "rule" });

		expect((await loadDocument(id)).asn).toBe(first);
		// The next document still gets the number right after it.
		const other = await insertDocument();
		await applyDocumentType(db, other, documentTypeId, { source: "manual" });
		expect((await loadDocument(other)).asn).toBe(2);
	});

	test("a document already numbered by hand keeps its number", async () => {
		const documentTypeId = await insertType(true);
		const id = await insertDocument({ asn: 7 });

		await applyDocumentType(db, id, documentTypeId, { source: "manual" });

		const row = await loadDocument(id);
		expect(row.asn).toBe(7);
		expect(row.asnSource).toBe("manual");
	});
});

describe("allocateAsn", () => {
	test("hands out consecutive numbers and skips an already numbered document", async () => {
		const first = await insertDocument();
		const second = await insertDocument();

		expect(await allocateAsn(db, first, "manual")).toBe(1);
		expect((await loadDocument(first)).asnSource).toBe("manual");
		expect(await allocateAsn(db, second, "auto")).toBe(2);

		const numbered = await insertDocument({ asn: 41 });
		expect(await allocateAsn(db, numbered, "auto")).toBeNull();
		expect((await loadDocument(numbered)).asn).toBe(41);
	});
});
