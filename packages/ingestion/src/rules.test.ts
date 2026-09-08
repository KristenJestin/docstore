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
	customField,
	documentFieldValue,
} from "@docstore/db/schema/custom-field";
import { document, documentParty } from "@docstore/db/schema/document";
import {
	documentType,
	documentTypeLayout,
} from "@docstore/db/schema/document-type";
import { documentDossier, dossier } from "@docstore/db/schema/dossier";
import { party } from "@docstore/db/schema/party";
import { extractionRule, rule, ruleRun } from "@docstore/db/schema/rule";
import { shareLink } from "@docstore/db/schema/share";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import type { PlannedOperation, RuleAction } from "@docstore/shared/rule";
import { and, eq } from "drizzle-orm";
import type { IngestionContext } from "./context";
import { intakeFile, isCreated } from "./intake";
import { processDocument } from "./pipeline";
import { applyOperations, applyRules, purgeRuleRuns } from "./rules";
import { writeSetting } from "./settings";
import { buildSubject, matchIdentifiers } from "./subject";
import {
	createTestIngestion,
	FIXTURES,
	insertTestUser,
	readFixture,
	type TestIngestion,
} from "./test-utils";

const TIMEOUT = 240_000;

/** Valid SIRET (Luhn) present in the `invoice-siret.pdf` fixture. */
const SIRET = "90000001900027";
/** Amount extracted from the `text-layer.pdf` fixture. */
const AMOUNT_PATTERN = "(\\d[\\d\\s.,]*\\d)";

let db: TestDb;
let ingestion: TestIngestion;
let ctx: IngestionContext;
let userId: string;
let textLayerPdf: Uint8Array;
let invoiceSiretPdf: Uint8Array;

beforeAll(async () => {
	db = await createTestDb();
	ingestion = await createTestIngestion(db);
	ctx = ingestion.ctx;
	textLayerPdf = await readFixture(FIXTURES.textLayerPdf);
	invoiceSiretPdf = await readFixture(FIXTURES.invoiceSiretPdf);
});

afterAll(async () => {
	await ingestion.cleanup();
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	userId = await insertTestUser(db);
});

async function insertCategory(name: string, slug: string): Promise<string> {
	const rows = await db
		.insert(category)
		.values({ name, slug })
		.returning({ id: category.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("category not inserted");
	return id;
}

async function insertMoneyField(name: string, slug: string): Promise<string> {
	const rows = await db
		.insert(customField)
		.values({ name, slug, type: "money", options: { currency: "EUR" } })
		.returning({ id: customField.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("custom field not inserted");
	return id;
}

/**
 * "Invoice" rule: applies the Invoice document type, which carries the
 * category and — in the Default layout — the extraction of the amount.
 */
async function setupInvoiceRule(): Promise<{
	categoryId: string;
	fieldId: string;
	documentTypeId: string;
	layoutId: string;
	extractionRuleId: string;
	ruleId: string;
}> {
	const categoryId = await insertCategory("Invoice", "invoice");
	const fieldId = await insertMoneyField("Total amount", "total-amount");

	const types = await db
		.insert(documentType)
		.values({ name: "Invoice", categoryId })
		.returning({ id: documentType.id });
	const documentTypeId = types[0]?.id;
	if (!documentTypeId) throw new Error("document type not inserted");

	const layouts = await db
		.insert(documentTypeLayout)
		.values({ documentTypeId, name: "Default", isDefault: true })
		.returning({ id: documentTypeLayout.id });
	const layoutId = layouts[0]?.id;
	if (!layoutId) throw new Error("layout not inserted");

	const extractions = await db
		.insert(extractionRule)
		.values({
			name: "Net payable",
			layoutId,
			target: { kind: "field", fieldId },
			strategy: {
				kind: "anchor",
				// French anchor: the fixture PDF is a French invoice.
				label: "NET (À|A) PAYER",
				position: "sameLine",
				valuePattern: AMOUNT_PATTERN,
			},
			postprocess: ["number_fr"],
		})
		.returning({ id: extractionRule.id });
	const extractionRuleId = extractions[0]?.id;
	if (!extractionRuleId) throw new Error("extraction rule not inserted");

	const actions: RuleAction[] = [{ type: "set_document_type", documentTypeId }];
	const rules = await db
		.insert(rule)
		.values({
			name: "Invoice by keyword",
			enabled: true,
			priority: 0,
			triggers: ["ingest", "manual"],
			// French keyword: it is matched against the French fixture text.
			condition: { field: "content", cmp: "icontains", value: "facture" },
			actions,
		})
		.returning({ id: rule.id });
	const ruleId = rules[0]?.id;
	if (!ruleId) throw new Error("rule not inserted");

	return {
		categoryId,
		fieldId,
		documentTypeId,
		layoutId,
		extractionRuleId,
		ruleId,
	};
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

async function loadDocument(id: string) {
	const rows = await db.select().from(document).where(eq(document.id, id));
	const row = rows[0];
	if (!row) throw new Error("missing document");
	return row;
}

describe("pipeline with rules", () => {
	test(
		"applies the category, extracts the amount and sends the document to Review",
		async () => {
			const setup = await setupInvoiceRule();
			const payload = await intakePdf(textLayerPdf, "invoice.pdf");

			await processDocument(ctx, payload);

			const doc = await loadDocument(payload.documentId);
			expect(doc.categoryId).toBe(setup.categoryId);
			expect(doc.categorySource).toBe("rule");
			expect(doc.categoryConfidence).toBe(1);

			const values = await db
				.select()
				.from(documentFieldValue)
				.where(eq(documentFieldValue.documentId, payload.documentId));
			expect(values[0]?.value).toEqual({
				kind: "money",
				amount: 1234.56,
				currency: "EUR",
			});
			expect(values[0]?.source).toBe("rule");
			expect(values[0]?.confidence).toBe(1);

			// No Issuer: `review.requireIssuer` sends the document to the queue.
			expect(doc.status).toBe("review");
			expect(doc.reviewReasons.map((reason) => reason.code)).toContain(
				"missingIssuer",
			);

			const runs = await db
				.select()
				.from(ruleRun)
				.where(eq(ruleRun.documentId, payload.documentId));
			expect(runs).toHaveLength(1);
			expect(runs[0]?.matched).toBe(true);
			expect(runs[0]?.ruleId).toBe(setup.ruleId);

			const updated = await db
				.select()
				.from(rule)
				.where(eq(rule.id, setup.ruleId));
			expect(updated[0]?.matchCount).toBe(1);
			expect(updated[0]?.lastMatchedAt).not.toBeNull();
		},
		TIMEOUT,
	);

	test(
		"matches the Issuer by SIRET and leaves the document active",
		async () => {
			await setupInvoiceRule();
			// The threshold drops below the confidence of an inferred date (0.6).
			await writeSetting(db, "review.confidenceThreshold", 0.5);

			const parties = await db
				.insert(party)
				.values({
					type: "company",
					name: "Nordwind Digital",
					identifiers: { siret: SIRET },
				})
				.returning({ id: party.id });
			const partyId = parties[0]?.id;
			if (!partyId) throw new Error("party not inserted");

			const payload = await intakePdf(invoiceSiretPdf, "invoice-nordwind.pdf");
			await processDocument(ctx, payload);

			const links = await db
				.select()
				.from(documentParty)
				.where(
					and(
						eq(documentParty.documentId, payload.documentId),
						eq(documentParty.role, "issuer"),
					),
				);
			expect(links[0]?.partyId).toBe(partyId);
			expect(links[0]?.source).toBe("rule");
			expect(links[0]?.confidence).toBeCloseTo(0.9, 5);

			const doc = await loadDocument(payload.documentId);
			expect(doc.reviewReasons).toEqual([]);
			expect(doc.status).toBe("active");
			// The date "12 octobre 2025" was inferred from the text.
			expect(doc.documentDate).toBe("2025-10-12");
			expect(doc.datePrecision).toBe("day");
		},
		TIMEOUT,
	);

	test(
		"a disabled rule is not evaluated",
		async () => {
			const setup = await setupInvoiceRule();
			await db
				.update(rule)
				.set({ enabled: false })
				.where(eq(rule.id, setup.ruleId));

			const payload = await intakePdf(textLayerPdf, "invoice.pdf");
			await processDocument(ctx, payload);

			const doc = await loadDocument(payload.documentId);
			expect(doc.categoryId).toBeNull();
			expect(doc.status).toBe("review");
			expect(doc.reviewReasons.map((reason) => reason.code)).toContain(
				"missingCategory",
			);
		},
		TIMEOUT,
	);
});

describe("applyRules", () => {
	test(
		"the dry-run mode plans without writing",
		async () => {
			const setup = await setupInvoiceRule();
			const payload = await intakePdf(textLayerPdf, "invoice.pdf");
			// Only `extractText` is needed to get the text and the OCR layer.
			const { extractText } = await import("./pipeline");
			await extractText(ctx, payload);

			const result = await applyRules(db, payload.documentId, {
				trigger: "ingest",
				dryRun: true,
			});
			expect(result?.matchedCount).toBe(1);
			expect(result?.rules[0]?.operations).toContainEqual({
				type: "set_document_type",
				documentTypeId: setup.documentTypeId,
				confidence: 1,
			});

			const doc = await loadDocument(payload.documentId);
			expect(doc.categoryId).toBeNull();
			expect(doc.documentTypeId).toBeNull();
			const runs = await db.select().from(ruleRun);
			expect(runs).toHaveLength(0);
		},
		TIMEOUT,
	);

	test("returns null for an unknown document", async () => {
		expect(
			await applyRules(db, "doc_missing", { trigger: "ingest" }),
		).toBeNull();
	});

	test(
		"stopOnMatch interrupts the evaluation of the following rules",
		async () => {
			const setup = await setupInvoiceRule();
			await db
				.update(rule)
				.set({ stopOnMatch: true })
				.where(eq(rule.id, setup.ruleId));
			await db.insert(rule).values({
				name: "Everything else",
				enabled: true,
				priority: 10,
				triggers: ["ingest"],
				condition: { op: "and", children: [] },
				actions: [{ type: "set_sensitive", sensitive: true }],
			});

			const payload = await intakePdf(textLayerPdf, "invoice.pdf");
			await processDocument(ctx, payload);

			const doc = await loadDocument(payload.documentId);
			expect(doc.categoryId).toBe(setup.categoryId);
			expect(doc.sensitive).toBe(false);
		},
		TIMEOUT,
	);
});

describe("buildSubject", () => {
	test(
		"exposes the content, the file and the detected identifiers",
		async () => {
			const payload = await intakePdf(invoiceSiretPdf, "invoice-nordwind.pdf");
			const { extractText } = await import("./pipeline");
			await extractText(ctx, payload);

			const prepared = await buildSubject(db, payload.documentId);
			expect(prepared?.subject.mime).toBe("application/pdf");
			expect(prepared?.subject.filename).toBe("invoice-nordwind.pdf");
			expect(prepared?.subject.source).toBe("upload");
			expect(
				prepared?.subject.detectedIdentifiers.map((item) => item.value),
			).toContain(SIRET);
			expect(prepared?.subject.detectedDates?.[0]?.date).toBe("2025-10-12");
		},
		TIMEOUT,
	);

	test("returns null for an unknown document", async () => {
		expect(await buildSubject(db, "doc_missing")).toBeNull();
	});
});

describe("matchIdentifiers", () => {
	test("matches a Party by scalar identifier and by array", async () => {
		const rows = await db
			.insert(party)
			.values({
				type: "company",
				name: "Nordwind Digital",
				identifiers: { siret: SIRET, domain: ["nordwind.example"] },
			})
			.returning({ id: party.id });
		const partyId = rows[0]?.id ?? "";

		const matches = await matchIdentifiers(db, [
			{ kind: "siret", value: SIRET },
			{ kind: "domain", value: "nordwind.example" },
			{ kind: "siren", value: "900000019" },
		]);

		expect(matches).toHaveLength(2);
		expect(matches[0]).toMatchObject({ partyId, confidence: 0.9 });
		expect(matches[1]).toMatchObject({ partyId, confidence: 0.7 });
	});

	test("no Party matched", async () => {
		expect(await matchIdentifiers(db, [])).toEqual([]);
		expect(
			await matchIdentifiers(db, [{ kind: "siret", value: SIRET }]),
		).toEqual([]);
	});
});

describe("purgeRuleRuns", () => {
	test("deletes the runs beyond the retention window", async () => {
		const setup = await setupInvoiceRule();
		const documents = await db
			.insert(document)
			.values({ title: "Doc", status: "active", createdById: userId })
			.returning({ id: document.id });
		const documentId = documents[0]?.id ?? "";

		await db.insert(ruleRun).values([
			{
				ruleId: setup.ruleId,
				documentId,
				matched: true,
				createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
			},
			{ ruleId: setup.ruleId, documentId, matched: true },
		]);

		expect(await purgeRuleRuns(db)).toBe(1);
		expect(await db.select().from(ruleRun)).toHaveLength(1);
	});
});

describe("applyOperations — custom field constraints", () => {
	async function seedField(
		options: Record<string, unknown>,
		categoryIds: string[] = [],
	): Promise<string> {
		const rows = await db
			.insert(customField)
			.values({
				name: "Net pay",
				slug: `net-pay-${Math.random().toString(36).slice(2, 8)}`,
				type: "money",
				options,
				categoryIds,
			})
			.returning({ id: customField.id });
		return rows[0]?.id ?? "";
	}

	async function seedDocument(categoryId: string | null): Promise<string> {
		const rows = await db
			.insert(document)
			.values({
				title: "Payslip",
				status: "active",
				createdById: userId,
				categoryId,
			})
			.returning({ id: document.id });
		return rows[0]?.id ?? "";
	}

	test("a negative amount is not stored and feeds the review queue", async () => {
		const fieldId = await seedField({ currency: "EUR" });
		const documentId = await seedDocument(null);

		const outcome = await applyOperations(db, documentId, [
			{ type: "set_field", fieldId, value: -12, confidence: 0.9 },
		]);
		expect(outcome.applied).toEqual([]);
		expect(outcome.reasons[0]?.code).toBe("extractionFailed");
		expect(outcome.reasons[0]?.message).toContain("negative");
		expect(
			await db
				.select()
				.from(documentFieldValue)
				.where(eq(documentFieldValue.documentId, documentId)),
		).toHaveLength(0);
	});

	test("`allowNegative` lets a credit note through", async () => {
		const fieldId = await seedField({ currency: "EUR", allowNegative: true });
		const documentId = await seedDocument(null);

		const outcome = await applyOperations(db, documentId, [
			{ type: "set_field", fieldId, value: -12, confidence: 0.9 },
		]);
		expect(outcome.applied).toHaveLength(1);
	});

	test("a field restricted to another category is refused", async () => {
		const categories = await db
			.insert(category)
			.values([
				{ name: "Payslip", slug: "payslip-rules" },
				{ name: "Invoice", slug: "invoice-rules" },
			])
			.returning({ id: category.id, slug: category.slug });
		const payslip =
			categories.find((row) => row.slug === "payslip-rules")?.id ?? "";
		const invoice =
			categories.find((row) => row.slug === "invoice-rules")?.id ?? "";

		const fieldId = await seedField({ currency: "EUR" }, [payslip]);
		const wrong = await seedDocument(invoice);
		const outcome = await applyOperations(db, wrong, [
			{ type: "set_field", fieldId, value: 12, confidence: 0.9 },
		]);
		expect(outcome.applied).toEqual([]);
		expect(outcome.reasons[0]?.message).toContain("category");

		const right = await seedDocument(payslip);
		expect(
			(
				await applyOperations(db, right, [
					{ type: "set_field", fieldId, value: 12, confidence: 0.9 },
				])
			).applied,
		).toHaveLength(1);
	});
});

describe("applyOperations — set_category and add_to_dossier", () => {
	async function seedDocument(
		values: Partial<typeof document.$inferInsert> = {},
	): Promise<string> {
		const rows = await db
			.insert(document)
			.values({
				title: "Notary deed",
				status: "active",
				createdById: userId,
				...values,
			})
			.returning({ id: document.id });
		return rows[0]?.id ?? "";
	}

	test("set_category files a document that has none", async () => {
		const categoryId = await insertCategory("Housing", "housing-ops");
		const documentId = await seedDocument();

		const outcome = await applyOperations(db, documentId, [
			{ type: "set_category", categoryId, confidence: 1 },
		]);
		expect(outcome.applied).toHaveLength(1);

		const row = await loadDocument(documentId);
		expect(row.categoryId).toBe(categoryId);
		expect(row.categorySource).toBe("rule");
		expect(row.categoryConfidence).toBe(1);
	});

	test("set_category leaves a category filed by hand alone", async () => {
		const kept = await insertCategory("Housing", "housing-kept");
		const other = await insertCategory("Tax", "tax-other");
		const documentId = await seedDocument({
			categoryId: kept,
			categorySource: "manual",
			categoryConfirmedAt: new Date(),
		});

		const outcome = await applyOperations(db, documentId, [
			{ type: "set_category", categoryId: other, confidence: 1 },
		]);
		expect(outcome.applied).toEqual([]);
		expect((await loadDocument(documentId)).categoryId).toBe(kept);
	});

	test("set_category replaces a category an earlier rule had set", async () => {
		const first = await insertCategory("Housing", "housing-first");
		const second = await insertCategory("Tax", "tax-second");
		const documentId = await seedDocument({
			categoryId: first,
			categorySource: "rule",
			categoryConfidence: 1,
		});

		await applyOperations(db, documentId, [
			{ type: "set_category", categoryId: second, confidence: 1 },
		]);
		expect((await loadDocument(documentId)).categoryId).toBe(second);
	});

	test("add_to_dossier files the document, twice without failing", async () => {
		const dossiers = await db
			.insert(dossier)
			.values({ name: "House purchase" })
			.returning({ id: dossier.id });
		const dossierId = dossiers[0]?.id ?? "";
		const documentId = await seedDocument();

		const operations: PlannedOperation[] = [
			{ type: "add_to_dossier", dossierId },
		];
		expect((await applyOperations(db, documentId, operations)).applied).toEqual(
			operations,
		);
		await applyOperations(db, documentId, operations);

		const links = await db
			.select()
			.from(documentDossier)
			.where(eq(documentDossier.documentId, documentId));
		expect(links).toHaveLength(1);
	});

	test("add_to_dossier skips a document in the trash", async () => {
		const dossiers = await db
			.insert(dossier)
			.values({ name: "House purchase" })
			.returning({ id: dossier.id });
		const dossierId = dossiers[0]?.id ?? "";
		const documentId = await seedDocument({ deletedAt: new Date() });

		const outcome = await applyOperations(db, documentId, [
			{ type: "add_to_dossier", dossierId },
		]);
		expect(outcome.applied).toEqual([]);
		expect(await db.select().from(documentDossier)).toHaveLength(0);
	});

	test("a sensitive document closes the public windows of its dossier", async () => {
		const dossiers = await db
			.insert(dossier)
			.values({ name: "House purchase" })
			.returning({ id: dossier.id });
		const dossierId = dossiers[0]?.id ?? "";
		const documentId = await seedDocument({ sensitive: true });
		await db.insert(shareLink).values({
			token: `tok-dos-${Date.now()}`,
			dossierId,
			createdById: userId,
		});

		await applyOperations(db, documentId, [
			{ type: "add_to_dossier", dossierId },
		]);

		const links = await db.select().from(shareLink);
		expect(links[0]?.revokedAt).not.toBeNull();
		expect(links[0]?.revokedReason).toBe("sensitive");
	});
});

describe("applyOperations — set_sensitive and share links", () => {
	test("raising the flag revokes the links of the document", async () => {
		const documents = await db
			.insert(document)
			.values({
				title: "Bank statement",
				status: "active",
				createdById: userId,
			})
			.returning({ id: document.id });
		const documentId = documents[0]?.id ?? "";
		await db.insert(shareLink).values({
			token: `tok${Date.now()}`,
			documentId,
			createdById: userId,
		});

		await applyOperations(db, documentId, [
			{ type: "set_sensitive", sensitive: true },
		]);

		const links = await db.select().from(shareLink);
		expect(links[0]?.revokedAt).not.toBeNull();
		expect(links[0]?.revokedReason).toBe("sensitive");
	});
});

describe("applyOperations — manual fields", () => {
	async function seedDocument(manualFields: string[]): Promise<{ id: string }> {
		const rows = await db
			.insert(document)
			.values({
				title: "Payslip — August",
				status: "active",
				createdById: userId,
				documentDate: "2026-08-28",
				datePrecision: "day",
				periodStart: "2026-08-01",
				periodEnd: "2026-08-31",
				validUntil: "2027-01-01",
				manualFields,
			})
			.returning({ id: document.id });
		return { id: rows[0]?.id ?? "" };
	}

	const operations: PlannedOperation[] = [
		{
			type: "set_document_date",
			date: "2020-01-01",
			precision: "day",
			confidence: null,
		},
		{
			type: "set_period",
			start: "2020-01-01",
			end: "2020-01-31",
			confidence: null,
		},
		{ type: "set_valid_until", date: "2020-12-31", confidence: null },
		{ type: "set_title", title: "Rewritten by a rule" },
	];

	test("a rule never writes over what a human typed", async () => {
		const { id } = await seedDocument([
			"documentDate",
			"datePrecision",
			"periodStart",
			"periodEnd",
			"validUntil",
			"title",
		]);

		const result = await applyOperations(db, id, operations);
		// Nothing was applied: the operations are skipped, not silently counted.
		expect(result.applied).toEqual([]);

		const [row] = await db.select().from(document).where(eq(document.id, id));
		expect(row?.documentDate).toBe("2026-08-28");
		expect(row?.periodStart).toBe("2026-08-01");
		expect(row?.validUntil).toBe("2027-01-01");
		expect(row?.title).toBe("Payslip — August");
	});

	test("without a marker the same operations apply", async () => {
		const { id } = await seedDocument([]);

		const result = await applyOperations(db, id, operations);
		expect(result.applied).toHaveLength(4);

		const [row] = await db.select().from(document).where(eq(document.id, id));
		expect(row?.documentDate).toBe("2020-01-01");
		expect(row?.periodStart).toBe("2020-01-01");
		expect(row?.validUntil).toBe("2020-12-31");
		expect(row?.title).toBe("Rewritten by a rule");
	});
});
