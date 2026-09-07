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
import { party } from "@docstore/db/schema/party";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { exportDocumentsInput } from "@docstore/shared/export";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { createTestUser, type TestUser } from "../test-utils";
import {
	buildExportPlan,
	buildManifestCsv,
	type ExportStorage,
	exportDocuments,
	previewExport,
	sanitizeSegment,
} from "./export.service";
import { setSetting } from "./settings.service";

/**
 * Tree export (SPEC §8 iteration 7). Storage is faked: what matters here is the
 * plan (names, folders, deduplication) and the shape of the archive.
 */

let db: TestDb;
let owner: TestUser;

/** In-memory storage: `storageKey` -> bytes. */
const objects = new Map<string, Uint8Array>();
const storage: ExportStorage = {
	read: async (storageKey) => {
		const bytes = objects.get(storageKey);
		if (!bytes) throw new Error(`missing object: ${storageKey}`);
		return new Blob([
			bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			) as ArrayBuffer,
		]);
	},
};

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	objects.clear();
	owner = await createTestUser(db);
});

function input(overrides: Record<string, unknown> = {}) {
	return exportDocumentsInput.parse(overrides);
}

async function seedParty(name: string): Promise<string> {
	const rows = await db
		.insert(party)
		.values({ name, type: "company" })
		.returning({ id: party.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("party not inserted");
	return id;
}

async function seedCategory(name: string): Promise<string> {
	const rows = await db
		.insert(category)
		.values({ name, slug: name.toLowerCase() })
		.returning({ id: category.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("category not inserted");
	return id;
}

interface SeedOptions {
	title: string;
	documentDate?: string;
	periodStart?: string;
	periodEnd?: string;
	categoryId?: string;
	issuerId?: string;
	sensitive?: boolean;
	filename?: string;
	content?: string;
}

async function seedDocument(options: SeedOptions): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title: options.title,
			status: "active",
			createdById: owner.id,
			documentDate: options.documentDate ?? null,
			datePrecision: options.documentDate ? "day" : null,
			periodStart: options.periodStart ?? null,
			periodEnd: options.periodEnd ?? null,
			categoryId: options.categoryId ?? null,
			sensitive: options.sensitive ?? false,
		})
		.returning({ id: document.id });
	const documentId = rows[0]?.id;
	if (!documentId) throw new Error("document not inserted");

	if (options.issuerId) {
		await db.insert(documentParty).values({
			documentId,
			partyId: options.issuerId,
			role: "issuer",
			source: "manual",
		});
	}

	const bytes = new TextEncoder().encode(options.content ?? options.title);
	const storageKey = `documents/${documentId}/file.pdf`;
	objects.set(storageKey, bytes);
	await db.insert(documentFile).values({
		documentId,
		kind: "original",
		filename: options.filename ?? "scan.pdf",
		mime: "application/pdf",
		size: bytes.byteLength,
		sha256: `sha-${documentId}`,
		storageKey,
	});
	return documentId;
}

describe("sanitizeSegment", () => {
	test("keeps a readable name and drops path separators", () => {
		expect(sanitizeSegment("2025-01-15 - EDF - Invoice", "x")).toBe(
			"2025-01-15 - EDF - Invoice",
		);
		expect(sanitizeSegment("a/b:c*d?e", "x")).toBe("a b c d e");
		expect(sanitizeSegment("   ", "fallback")).toBe("fallback");
		expect(sanitizeSegment("...", "fallback")).toBe("fallback");
		expect(sanitizeSegment("x".repeat(200), "x")).toHaveLength(120);
	});
});

describe("buildExportPlan — layouts", () => {
	test("renders the template and honours each layout", async () => {
		const edf = await seedParty("EDF");
		const invoices = await seedCategory("Invoice");
		await seedDocument({
			title: "January bill",
			documentDate: "2025-01-15",
			categoryId: invoices,
			issuerId: edf,
		});
		await seedDocument({ title: "Loose note" });

		const flat = await buildExportPlan(db, input());
		expect(flat.entries.map((entry) => entry.path)).toEqual([
			"2025-01-15 - EDF - Invoice - January bill.pdf",
			"Loose note.pdf",
		]);

		const byYear = await buildExportPlan(db, input({ layout: "by-year" }));
		expect(byYear.entries.map((entry) => entry.path)).toEqual([
			"2025/2025-01-15 - EDF - Invoice - January bill.pdf",
			"undated/Loose note.pdf",
		]);

		const byParty = await buildExportPlan(db, input({ layout: "by-party" }));
		expect(byParty.entries.map((entry) => entry.path)).toEqual([
			"EDF/2025-01-15 - EDF - Invoice - January bill.pdf",
			"no-issuer/Loose note.pdf",
		]);

		const byCategory = await buildExportPlan(
			db,
			input({ layout: "by-category" }),
		);
		expect(byCategory.entries.map((entry) => entry.path)).toEqual([
			"Invoice/2025-01-15 - EDF - Invoice - January bill.pdf",
			"uncategorized/Loose note.pdf",
		]);
	});

	test("a custom template is applied", async () => {
		await seedDocument({ title: "Contract", documentDate: "2024-06-01" });
		const plan = await buildExportPlan(
			db,
			input({ template: "{date:YYYY} {title}" }),
		);
		expect(plan.entries[0]?.path).toBe("2024 Contract.pdf");
	});

	test("`{filename}` excludes the extension: the export appends it once", async () => {
		const nordwind = await seedParty("Nordwind Digital");
		await seedDocument({
			title: "Invoice",
			issuerId: nordwind,
			filename: "facture-nordwind-043.pdf",
		});

		const plan = await buildExportPlan(
			db,
			input({ template: "{period} {issuer} {filename}" }),
		);
		// `{period}` renders empty (no period on this document) and is tidied
		// away; what matters is a single `.pdf`, not `.pdf.pdf`.
		expect(plan.entries[0]?.path).toBe(
			"Nordwind Digital facture-nordwind-043.pdf",
		);
	});

	test("`{ext}` exposes the extension explicitly, without the dot", async () => {
		await seedDocument({ title: "Contract", filename: "contract.PDF" });
		const plan = await buildExportPlan(
			db,
			input({ template: "{title} ({ext})" }),
		);
		expect(plan.entries[0]?.path).toBe("Contract (pdf).pdf");
	});

	test("collisions get a numeric suffix", async () => {
		await seedDocument({ title: "Statement", documentDate: "2025-03-01" });
		await seedDocument({ title: "Statement", documentDate: "2025-03-01" });
		await seedDocument({ title: "Statement", documentDate: "2025-03-01" });

		const plan = await buildExportPlan(db, input());
		expect(plan.entries.map((entry) => entry.path).sort()).toEqual(
			[
				"2025-03-01 - Statement.pdf",
				"2025-03-01 - Statement (2).pdf",
				"2025-03-01 - Statement (3).pdf",
			].sort(),
		);
	});
});

describe("buildExportPlan — sensitive", () => {
	test("sensitive documents stay out unless asked for", async () => {
		await seedDocument({ title: "Payslip", sensitive: true });
		await seedDocument({ title: "Receipt" });

		const guarded = await buildExportPlan(db, input());
		expect(guarded.entries.map((entry) => entry.document.title)).toEqual([
			"Receipt",
		]);

		const opened = await buildExportPlan(db, input({ includeSensitive: true }));
		expect(opened.entries.map((entry) => entry.document.title).sort()).toEqual([
			"Payslip",
			"Receipt",
		]);
	});
});

describe("previewExport", () => {
	test("counts, sizes and samples the paths", async () => {
		await seedDocument({ title: "One", content: "12345" });
		await seedDocument({ title: "Two", content: "1234567890" });

		const preview = await previewExport(db, input());
		expect(preview.count).toBe(2);
		expect(preview.bytes).toBe(15);
		expect(preview.sample).toHaveLength(2);
		expect(preview.truncated).toBe(false);
	});
});

describe("exportDocuments", () => {
	test("produces a readable ZIP with metadata and manifest", async () => {
		const edf = await seedParty("EDF");
		const invoices = await seedCategory("Invoice");
		const documentId = await seedDocument({
			title: "January bill",
			documentDate: "2025-01-15",
			categoryId: invoices,
			issuerId: edf,
			content: "invoice-bytes",
		});
		await seedDocument({ title: "Loose note", content: "note-bytes" });

		const result = await exportDocuments({ db, storage }, input());
		expect(result.count).toBe(2);
		expect(result.filename).toStartWith("docstore-export-");
		expect(result.filename).toEndWith(".zip");

		const archive = new Uint8Array(
			await new Response(result.stream).arrayBuffer(),
		);
		const files = unzipSync(archive);
		const names = Object.keys(files).sort();
		expect(names).toEqual(
			[
				"2025-01-15 - EDF - Invoice - January bill.pdf",
				"Loose note.pdf",
				"manifest.csv",
				"metadata.json",
			].sort(),
		);

		const entry = files["2025-01-15 - EDF - Invoice - January bill.pdf"];
		expect(entry).toBeDefined();
		expect(new TextDecoder().decode(entry)).toBe("invoice-bytes");

		const metadataBytes = files["metadata.json"];
		if (!metadataBytes) throw new Error("metadata.json missing");
		const metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as {
			count: number;
			documents: { id: string; path: string }[];
			parties: { name: string }[];
			categories: { name: string }[];
		};
		expect(metadata.count).toBe(2);
		expect(metadata.documents.map((item) => item.id)).toContain(documentId);
		expect(metadata.parties.map((item) => item.name)).toEqual(["EDF"]);
		expect(metadata.categories.map((item) => item.name)).toEqual(["Invoice"]);

		const manifestBytes = files["manifest.csv"];
		if (!manifestBytes) throw new Error("manifest.csv missing");
		const manifest = new TextDecoder().decode(manifestBytes).split("\n");
		expect(manifest[0]).toStartWith("path,documentId,title");
		expect(manifest).toHaveLength(3);
	});

	test("includeMetadata: false ships the files only", async () => {
		await seedDocument({ title: "Only" });
		const result = await exportDocuments(
			{ db, storage },
			input({ includeMetadata: false }),
		);
		const files = unzipSync(
			new Uint8Array(await new Response(result.stream).arrayBuffer()),
		);
		expect(Object.keys(files)).toEqual(["Only.pdf"]);
	});
});

describe("buildManifestCsv", () => {
	test("escapes the separators of a title", async () => {
		await seedDocument({ title: 'Bill, "special"' });
		const plan = await buildExportPlan(db, input());
		const csv = buildManifestCsv(plan.entries);
		expect(csv).toContain('"Bill, ""special"""');
	});

	test("writes the document date in the content language", async () => {
		await seedDocument({ title: "Bill", documentDate: "2026-01-15" });
		const plan = await buildExportPlan(db, input());
		expect(buildManifestCsv(plan.entries, "en-GB")).toContain("15 Jan 2026");
		expect(buildManifestCsv(plan.entries, "fr-FR")).toContain("15 janv. 2026");
	});
});

describe("export — content language", () => {
	beforeEach(async () => {
		await seedDocument({
			title: "Payslip",
			periodStart: "2026-01-01",
			periodEnd: "2026-01-31",
		});
	});

	test("file names use the month names of the content language", async () => {
		// Default: English, like the interface.
		const english = await buildExportPlan(
			db,
			input({ template: "{period:MMMM yyyy} - {title}" }),
		);
		expect(english.entries[0]?.path).toBe("January 2026 - Payslip.pdf");

		await setSetting(db, { key: "content.locale", value: "fr-FR" });
		const french = await buildExportPlan(
			db,
			input({ template: "{period:MMMM yyyy} - {title}" }),
		);
		expect(french.entries[0]?.path).toBe("janvier 2026 - Payslip.pdf");
	});

	test("{period:MMM} shortens the month in both languages", async () => {
		const english = await buildExportPlan(
			db,
			input({ template: "{period:MMM} {title}" }),
		);
		expect(english.entries[0]?.path).toBe("Jan Payslip.pdf");

		await setSetting(db, { key: "content.locale", value: "fr-FR" });
		const french = await buildExportPlan(
			db,
			input({ template: "{period:MMM} {title}" }),
		);
		expect(french.entries[0]?.path).toBe("janv Payslip.pdf");
	});

	test("a token that pins its language ignores the setting", async () => {
		const plan = await buildExportPlan(
			db,
			input({ template: "{period:MMMM yyyy|fr-FR} - {title}" }),
		);
		expect(plan.entries[0]?.path).toBe("janvier 2026 - Payslip.pdf");
	});
});

describe("export — input strictness", () => {
	test("an unknown filter key is refused", () => {
		const parsed = exportDocumentsInput.safeParse({
			filters: { categoryID: "cat_typo" },
		});
		expect(parsed.success).toBe(false);
	});

	test("the known filters still go through", () => {
		const parsed = exportDocumentsInput.safeParse({
			filters: { status: "active", tagIds: ["tag_1"] },
		});
		expect(parsed.success).toBe(true);
	});

	test("an unknown template placeholder is refused, listing the allowed ones", async () => {
		await seedDocument({ title: "Invoice" });
		const error = await buildExportPlan(
			db,
			input({ template: "{invoice} - {title}" }),
		).then(
			() => null,
			(caught: unknown) => caught as Error,
		);
		expect(error?.message).toContain("{invoice}");
		expect(error?.message).toContain("{issuer}");
		expect(error?.message).toContain("{category}");
	});

	test("the default template is accepted", async () => {
		await seedDocument({ title: "Invoice" });
		expect((await buildExportPlan(db, input())).entries).toHaveLength(1);
	});
});

describe("export — failed documents", () => {
	test("a failed document stays out unless asked for by status", async () => {
		const ok = await seedDocument({ title: "Good" });
		const broken = await seedDocument({ title: "Broken" });
		await db
			.update(document)
			.set({ status: "failed" })
			.where(eq(document.id, broken));

		const plan = await buildExportPlan(db, input());
		expect(plan.entries.map((entry) => entry.documentId)).toEqual([ok]);

		const explicit = await buildExportPlan(
			db,
			input({ filters: { status: "failed" } }),
		);
		expect(explicit.entries.map((entry) => entry.documentId)).toEqual([broken]);
	});
});
