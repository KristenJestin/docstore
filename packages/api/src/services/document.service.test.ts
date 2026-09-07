import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { category } from "@docstore/db/schema/category";
import {
	document,
	documentFile,
	documentParty,
} from "@docstore/db/schema/document";
import { documentTag, tag } from "@docstore/db/schema/tag";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { analyzeDocument } from "@docstore/ingestion";
import type {
	DocumentStatus,
	ListDocumentsInput,
} from "@docstore/shared/document";
import { eq } from "drizzle-orm";
import { createTestUser, expectOrpcError, type TestUser } from "../test-utils";
import {
	addDocumentParty,
	deleteDocumentPermanently,
	getDocument,
	getDocumentFileLayout,
	getDocumentStats,
	listDocuments,
	removeDocumentParty,
	restoreDocument,
	setDocumentCategory,
	setDocumentParties,
	trashDocument,
	updateDocument,
} from "./document.service";
import { createParty } from "./party.service";

let db: TestDb;
let owner: TestUser;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
});

const listDefaults: ListDocumentsInput = {
	deleted: "exclude",
	page: 1,
	pageSize: 25,
	sort: "documentDate:desc",
};

type SeedOptions = {
	title: string;
	content?: string;
	status?: DocumentStatus;
	documentDate?: string;
	sensitive?: boolean;
};

async function seedDocument(options: SeedOptions): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title: options.title,
			content: options.content ?? null,
			status: options.status ?? "active",
			documentDate: options.documentDate ?? null,
			datePrecision: options.documentDate ? "day" : null,
			sensitive: options.sensitive ?? false,
			createdById: owner.id,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document was not inserted");
	return id;
}

async function seedFile(documentId: string, kind: "original" | "archive") {
	const rows = await db
		.insert(documentFile)
		.values({
			documentId,
			kind,
			filename: `${kind}.pdf`,
			mime: "application/pdf",
			size: 1024,
			sha256: `${documentId}-${kind}`,
			storageKey: `docs/${documentId}/${kind}.pdf`,
			pageCount: kind === "original" ? 3 : 1,
			thumbnailKey: kind === "original" ? `thumbs/${documentId}.webp` : null,
			ocrLayout: {
				pages: [
					{
						width: 100,
						height: 200,
						words: [{ text: "invoice", x0: 1, y0: 2, x1: 3, y1: 4, conf: 0.9 }],
					},
				],
			},
		})
		.returning({ id: documentFile.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("file was not inserted");
	return id;
}

async function seedParty(name: string) {
	return createParty(db, {
		type: "company",
		name,
		aliases: [],
		identifiers: {},
		isHouseholdMember: false,
	});
}

describe("document.service — list and search", () => {
	test("full-text search", async () => {
		const target = await seedDocument({
			title: "Document 2025",
			content: "Internet subscription invoice for the month of January.",
			documentDate: "2025-01-15",
		});
		await seedDocument({
			title: "Other document",
			content: "Civil liability certificate.",
			documentDate: "2025-02-15",
		});

		const found = await listDocuments(db, {
			...listDefaults,
			query: "subscription",
		});
		expect(found.items.map((item) => item.id)).toEqual([target]);

		const missed = await listDocuments(db, {
			...listDefaults,
			query: "insurance",
		});
		expect(missed.total).toBe(0);
	});

	test("filters by party, year, sensitive, status and range", async () => {
		const issuer = await seedParty("EDF");
		const linked = await seedDocument({
			title: "Invoice 2024",
			documentDate: "2024-06-01",
			sensitive: true,
		});
		await seedDocument({ title: "Note 2025", documentDate: "2025-06-01" });
		await seedDocument({ title: "Draft", status: "review" });

		await db
			.insert(documentParty)
			.values({ documentId: linked, partyId: issuer.id, role: "issuer" });

		const byParty = await listDocuments(db, {
			...listDefaults,
			partyId: issuer.id,
		});
		expect(byParty.items.map((item) => item.id)).toEqual([linked]);
		expect(byParty.items[0]?.parties[0]?.name).toBe("EDF");
		expect(byParty.items[0]?.parties[0]?.role).toBe("issuer");

		const byYear = await listDocuments(db, { ...listDefaults, year: 2024 });
		expect(byYear.items.map((item) => item.id)).toEqual([linked]);

		const bySensitive = await listDocuments(db, {
			...listDefaults,
			sensitive: true,
		});
		expect(bySensitive.items.map((item) => item.id)).toEqual([linked]);

		const byStatus = await listDocuments(db, {
			...listDefaults,
			status: "review",
		});
		expect(byStatus.items.map((item) => item.title)).toEqual(["Draft"]);

		const byRange = await listDocuments(db, {
			...listDefaults,
			dateFrom: "2025-01-01",
			dateTo: "2025-12-31",
		});
		expect(byRange.items.map((item) => item.title)).toEqual(["Note 2025"]);
	});

	test("exposes the thumbnail and page count of the original file", async () => {
		const id = await seedDocument({ title: "With files" });
		await seedFile(id, "archive");
		const originalFileId = await seedFile(id, "original");

		const list = await listDocuments(db, listDefaults);
		// `thumbnailFileId` is what the download routes take; `thumbnailKey` is
		// kept alongside it for compatibility.
		expect(list.items[0]?.thumbnailFileId).toBe(originalFileId);
		expect(list.items[0]?.thumbnailKey).toBe(`thumbs/${id}.webp`);
		expect(list.items[0]?.pageCount).toBe(3);
	});

	test("paginates and sorts", async () => {
		await seedDocument({ title: "A", documentDate: "2025-01-01" });
		await seedDocument({ title: "B", documentDate: "2025-02-01" });
		await seedDocument({ title: "C", documentDate: "2025-03-01" });

		const first = await listDocuments(db, { ...listDefaults, pageSize: 2 });
		expect(first.total).toBe(3);
		expect(first.totalPages).toBe(2);
		expect(first.items.map((item) => item.title)).toEqual(["C", "B"]);

		const second = await listDocuments(db, {
			...listDefaults,
			page: 2,
			pageSize: 2,
		});
		expect(second.items.map((item) => item.title)).toEqual(["A"]);

		const byTitle = await listDocuments(db, {
			...listDefaults,
			sort: "title:asc",
		});
		expect(byTitle.items.map((item) => item.title)).toEqual(["A", "B", "C"]);
	});
});

describe("document.service — detail and OCR layer", () => {
	test("returns the content and the files without ocrLayout", async () => {
		const id = await seedDocument({
			title: "Invoice",
			content: "Full OCR text",
		});
		const fileId = await seedFile(id, "original");

		const detail = await getDocument(db, id);
		expect(detail.content).toBe("Full OCR text");
		expect(detail.files).toHaveLength(1);
		expect(detail.files[0]).not.toHaveProperty("ocrLayout");

		const layout = await getDocumentFileLayout(db, fileId);
		expect(layout.documentId).toBe(id);
		expect(layout.ocrLayout?.pages[0]?.words[0]?.text).toBe("invoice");

		await expectOrpcError(
			getDocumentFileLayout(db, "fil_unknown"),
			"NOT_FOUND",
		);
	});
});

describe("document.service — update", () => {
	test("applies a partial patch", async () => {
		const id = await seedDocument({ title: "Draft", status: "review" });
		const updated = await updateDocument(db, id, {
			title: "EDF invoice",
			status: "active",
			documentDate: "2025-03-04",
			datePrecision: "day",
		});
		expect(updated.title).toBe("EDF invoice");
		expect(updated.status).toBe("active");
		expect(updated.documentDate).toBe("2025-03-04");
	});

	test("rejects a date without precision", async () => {
		const id = await seedDocument({ title: "No date" });
		await expectOrpcError(
			updateDocument(db, id, { documentDate: "2025-03-04" }),
			"BAD_REQUEST",
		);
	});

	test("rejects an inconsistent period and validity", async () => {
		const id = await seedDocument({ title: "Contract" });

		await expectOrpcError(
			updateDocument(db, id, {
				periodStart: "2025-02-01",
				periodEnd: "2025-01-01",
			}),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			updateDocument(db, id, {
				validFrom: "2025-02-01",
				validUntil: "2025-01-01",
			}),
			"BAD_REQUEST",
		);

		const valid = await updateDocument(db, id, {
			periodStart: "2025-01-01",
			periodEnd: "2025-01-31",
		});
		expect(valid.periodEnd).toBe("2025-01-31");
	});

	test("NOT_FOUND on an unknown document", async () => {
		await expectOrpcError(
			updateDocument(db, "doc_unknown", { title: "X" }),
			"NOT_FOUND",
		);
	});
});

describe("document.service — Party links", () => {
	test("replaces, adds and removes links", async () => {
		const id = await seedDocument({ title: "Invoice" });
		const edf = await seedParty("EDF");
		const orange = await seedParty("Orange");

		const replaced = await setDocumentParties(db, id, [
			{ partyId: edf.id, role: "issuer" },
			{ partyId: orange.id, role: "mentioned" },
		]);
		expect(replaced.parties).toHaveLength(2);
		expect(replaced.parties.every((link) => link.source === "manual")).toBe(
			true,
		);

		const reduced = await setDocumentParties(db, id, [
			{ partyId: edf.id, role: "issuer" },
		]);
		expect(reduced.parties.map((link) => link.name)).toEqual(["EDF"]);

		const added = await addDocumentParty(db, id, orange.id, "recipient");
		expect(added.parties).toHaveLength(2);

		await expectOrpcError(
			addDocumentParty(db, id, orange.id, "recipient"),
			"CONFLICT",
		);

		const removed = await removeDocumentParty(db, id, orange.id, "recipient");
		expect(removed.parties.map((link) => link.name)).toEqual(["EDF"]);

		await expectOrpcError(
			removeDocumentParty(db, id, orange.id, "recipient"),
			"NOT_FOUND",
		);
		await expectOrpcError(
			setDocumentParties(db, id, [{ partyId: "prt_unknown", role: "issuer" }]),
			"NOT_FOUND",
		);
	});
});

describe("document.service — category and tag summaries", () => {
	test("exposes the source/confidence of the category and of each tag", async () => {
		const id = await seedDocument({ title: "Invoice" });
		const categories = await db
			.insert(category)
			.values({ name: "Invoice", slug: "invoice" })
			.returning({ id: category.id });
		const categoryId = categories[0]?.id ?? "";
		await db
			.update(document)
			.set({ categoryId, categorySource: "rule", categoryConfidence: 0.82 })
			.where(eq(document.id, id));

		const tags = await db
			.insert(tag)
			.values({ name: "energy" })
			.returning({ id: tag.id });
		const tagId = tags[0]?.id ?? "";
		await db
			.insert(documentTag)
			.values({ documentId: id, tagId, source: "rule", confidence: 0.65 });

		const detail = await getDocument(db, id);
		expect(detail.category).toMatchObject({
			id: categoryId,
			source: "rule",
			confidence: 0.82,
		});
		expect(detail.tags[0]).toMatchObject({
			id: tagId,
			source: "rule",
			confidence: 0.65,
		});

		const list = await listDocuments(db, listDefaults);
		expect(list.items[0]?.category).toMatchObject({
			source: "rule",
			confidence: 0.82,
		});
		expect(list.items[0]?.tags[0]).toMatchObject({
			source: "rule",
			confidence: 0.65,
		});
	});

	test("a manual category assignment resets the source and the confidence", async () => {
		const id = await seedDocument({ title: "Invoice" });
		const categories = await db
			.insert(category)
			.values({ name: "Invoice", slug: "invoice" })
			.returning({ id: category.id });
		const categoryId = categories[0]?.id ?? "";
		await db
			.update(document)
			.set({ categoryId, categorySource: "rule", categoryConfidence: 0.82 })
			.where(eq(document.id, id));

		const updated = await setDocumentCategory(db, id, categoryId);
		expect(updated.category).toMatchObject({
			id: categoryId,
			source: "manual",
			confidence: null,
		});
	});
});

describe("document.service — trash and statistics", () => {
	test("trashes, restores then deletes permanently", async () => {
		const id = await seedDocument({ title: "To discard" });
		await seedFile(id, "original");

		const trashed = await trashDocument(db, id);
		expect(trashed.deletedAt).not.toBeNull();
		expect((await listDocuments(db, listDefaults)).total).toBe(0);
		expect(
			(await listDocuments(db, { ...listDefaults, deleted: "only" })).total,
		).toBe(1);

		const restored = await restoreDocument(db, id);
		expect(restored.deletedAt).toBeNull();
		expect((await listDocuments(db, listDefaults)).total).toBe(1);

		const deletedKeys: string[][] = [];
		const result = await deleteDocumentPermanently(db, id, {
			onDeleteFiles: async (keys) => {
				deletedKeys.push(keys);
			},
		});
		expect(result.deleted).toBe(true);
		expect(deletedKeys[0]).toEqual([
			`docs/${id}/original.pdf`,
			`thumbs/${id}.webp`,
		]);
		await expectOrpcError(getDocument(db, id), "NOT_FOUND");
	});

	test("a failed document is listable and counted", async () => {
		const failed = await seedDocument({ title: "Broken", status: "failed" });
		await seedDocument({ title: "Fine", status: "active" });

		const page = await listDocuments(db, { ...listDefaults, status: "failed" });
		expect(page.items.map((item) => item.id)).toEqual([failed]);

		const stats = await getDocumentStats(db);
		expect(stats.byStatus.failed).toBe(1);
		expect(stats.total).toBe(2);
	});

	test("counts documents per status outside the trash", async () => {
		await seedDocument({ title: "A", status: "active" });
		await seedDocument({ title: "B", status: "review" });
		await seedDocument({ title: "C", status: "review" });
		const trashed = await seedDocument({ title: "D", status: "archived" });
		await trashDocument(db, trashed);

		const stats = await getDocumentStats(db);
		expect(stats.total).toBe(3);
		expect(stats.review).toBe(2);
		expect(stats.byStatus).toEqual({
			processing: 0,
			review: 2,
			active: 1,
			archived: 0,
			failed: 0,
		});
	});
});

/**
 * `document.manual_fields` (SPEC §5): the pipeline recomputes everything it
 * wrote — that is what makes `document.reprocess` able to fix a date an older
 * analyzer read wrong — and leaves alone whatever a human typed.
 */
describe("updateDocument — manual fields", () => {
	/** Payslip text: a covered period, and a payment date after it. */
	const PAYSLIP = [
		"BULLETIN DE PAIE",
		"Période du 01/08/2026 au 31/08/2026",
		"Payé le 28/08/2026",
	].join("\n");

	async function dateOf(id: string) {
		const [row] = await db
			.select({
				documentDate: document.documentDate,
				periodStart: document.periodStart,
				periodEnd: document.periodEnd,
				manualFields: document.manualFields,
			})
			.from(document)
			.where(eq(document.id, id));
		if (!row) throw new Error("document not found");
		return row;
	}

	test("a document nobody edited has none", async () => {
		const id = await seedDocument({ title: "Payslip" });
		expect((await getDocument(db, id)).manualFields).toEqual([]);
	});

	test("analyze fixes a date the old behaviour got wrong", async () => {
		const id = await seedDocument({ title: "Payslip", content: PAYSLIP });
		// The state the old analyzer left: the date is the first day of the
		// period, and the period itself was never filled.
		await db
			.update(document)
			.set({ documentDate: "2026-08-01", datePrecision: "day" })
			.where(eq(document.id, id));

		await analyzeDocument(db, id);

		const fixed = await dateOf(id);
		expect(fixed.documentDate).toBe("2026-08-28");
		expect(fixed.periodStart).toBe("2026-08-01");
		expect(fixed.periodEnd).toBe("2026-08-31");
	});

	test("a date set through `update` is recorded and then respected", async () => {
		const id = await seedDocument({ title: "Payslip", content: PAYSLIP });

		const updated = await updateDocument(db, id, {
			documentDate: "2026-09-05",
			datePrecision: "day",
		});
		expect(updated.manualFields.sort()).toEqual([
			"datePrecision",
			"documentDate",
		]);

		await analyzeDocument(db, id);

		const kept = await dateOf(id);
		expect(kept.documentDate).toBe("2026-09-05");
		// The period carries no marker: the pipeline still keeps it up to date.
		expect(kept.periodStart).toBe("2026-08-01");
	});

	test("clearing a field marks it too, and the markers accumulate", async () => {
		const id = await seedDocument({ title: "Payslip", content: PAYSLIP });

		await updateDocument(db, id, { validUntil: null });
		await updateDocument(db, id, { title: "Payslip — August 2026" });
		const detail = await updateDocument(db, id, { periodStart: "2026-07-01" });

		expect(detail.manualFields.sort()).toEqual([
			"periodStart",
			"title",
			"validUntil",
		]);

		await analyzeDocument(db, id);

		const kept = await dateOf(id);
		// `periodStart` is marked: the period read off the text is not written.
		expect(kept.periodStart).toBe("2026-07-01");
		expect(kept.periodEnd).toBeNull();
		// The date was never touched by hand: it is still recomputed.
		expect(kept.documentDate).toBe("2026-08-28");
	});

	test("a patch that touches nothing else leaves the markers alone", async () => {
		const id = await seedDocument({ title: "Payslip", content: PAYSLIP });
		await updateDocument(db, id, { title: "Renamed" });

		const detail = await updateDocument(db, id, { physicalLocation: "Box 3" });
		// `physicalLocation` is not something the pipeline computes.
		expect(detail.manualFields).toEqual(["title"]);
	});
});
