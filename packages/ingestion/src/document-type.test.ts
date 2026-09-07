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
import { party } from "@docstore/db/schema/party";
import { extractionRule, rule } from "@docstore/db/schema/rule";
import { documentTag, tag } from "@docstore/db/schema/tag";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import { isBlockingReviewReason } from "@docstore/shared/document";
import { and, eq } from "drizzle-orm";
import { analyzeDocument, computeReviewReasons } from "./analyze";
import {
	applyDocumentType,
	detectDocumentTypes,
	signatureFromText,
} from "./document-type";
import { applyRules } from "./rules";
import { writeSetting } from "./settings";
import { insertTestUser } from "./test-utils";

/**
 * Document types (SPEC §9): applying one, picking its layout, detecting it
 * during `analyze`, and the `set_document_type` rule action.
 */

let db: TestDb;
let userId: string;
let partyId: string;
let subjectPartyId: string;
let categoryId: string;
let tagId: string;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	userId = await insertTestUser(db);

	const parties = await db
		.insert(party)
		.values([
			{ type: "company", name: "Atelier Bellecombe" },
			{ type: "person", name: "Camille Moreau" },
		])
		.returning({ id: party.id });
	partyId = parties[0]?.id ?? "";
	subjectPartyId = parties[1]?.id ?? "";

	const categories = await db
		.insert(category)
		.values({ name: "Payslip", slug: "payslip" })
		.returning({ id: category.id });
	categoryId = categories[0]?.id ?? "";

	const tags = await db
		.insert(tag)
		.values({ name: "payroll" })
		.returning({ id: tag.id });
	tagId = tags[0]?.id ?? "";
});

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

async function insertType(
	overrides: Partial<typeof documentType.$inferInsert> = {},
): Promise<string> {
	const rows = await db
		.insert(documentType)
		.values({
			name: "Atelier Bellecombe payslips",
			categoryId,
			issuerPartyId: partyId,
			subjectPartyId,
			tagIds: [tagId],
			...overrides,
		})
		.returning({ id: documentType.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document type not inserted");
	return id;
}

async function loadDocument(id: string) {
	const rows = await db.select().from(document).where(eq(document.id, id));
	const row = rows[0];
	if (!row) throw new Error("missing document");
	return row;
}

describe("applyDocumentType", () => {
	test("writes the category, the parties, the tags and the sensitivity", async () => {
		const documentTypeId = await insertType({ sensitiveDefault: true });
		const id = await insertDocument({ content: "Bulletin de paie" });

		const outcome = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});
		expect(outcome.layoutId).toBeNull();
		expect(outcome.reviewReasons).toEqual([]);

		const row = await loadDocument(id);
		expect(row.categoryId).toBe(categoryId);
		expect(row.categorySource).toBe("manual");
		expect(row.documentTypeId).toBe(documentTypeId);
		expect(row.documentTypeSource).toBe("manual");
		expect(row.sensitive).toBe(true);

		const parties = await db
			.select()
			.from(documentParty)
			.where(eq(documentParty.documentId, id));
		expect(parties.map((item) => item.role).sort()).toEqual([
			"issuer",
			"subject",
		]);

		const tags = await db
			.select()
			.from(documentTag)
			.where(eq(documentTag.documentId, id));
		expect(tags.map((item) => item.tagId)).toEqual([tagId]);
	});

	test("an automatic application never overwrites a manual category", async () => {
		const others = await db
			.insert(category)
			.values({ name: "Contract", slug: "contract" })
			.returning({ id: category.id });
		const otherCategoryId = others[0]?.id ?? "";
		const documentTypeId = await insertType();
		const id = await insertDocument({
			categoryId: otherCategoryId,
			categorySource: "manual",
		});

		await applyDocumentType(db, id, documentTypeId, {
			source: "rule",
			confidence: 0.9,
		});
		const row = await loadDocument(id);
		expect(row.categoryId).toBe(otherCategoryId);
		// The type itself is still recorded.
		expect(row.documentTypeId).toBe(documentTypeId);
		expect(row.documentTypeConfidence).toBeCloseTo(0.9);
	});

	test("renders the title template while the title comes from the filename", async () => {
		const documentTypeId = await insertType({
			titleTemplate: "{date:YYYY-MM} - {issuer} - {category}",
		});
		// No file: the title is not the filename-derived one, so it is left alone.
		const untouched = await insertDocument({
			title: "Renamed by hand",
			documentDate: "2026-03-31",
		});
		await applyDocumentType(db, untouched, documentTypeId, {
			source: "manual",
		});
		expect((await loadDocument(untouched)).title).toBe("Renamed by hand");
	});

	test("never lowers an explicit sensitive flag", async () => {
		const documentTypeId = await insertType({ sensitiveDefault: false });
		const id = await insertDocument({ sensitive: true });
		await applyDocumentType(db, id, documentTypeId, { source: "manual" });
		expect((await loadDocument(id)).sensitive).toBe(true);
	});
});

describe("applyDocumentType — layouts", () => {
	async function insertLayout(
		documentTypeId: string,
		overrides: Partial<typeof documentTypeLayout.$inferInsert> = {},
	): Promise<string> {
		const rows = await db
			.insert(documentTypeLayout)
			.values({ documentTypeId, name: "Layout", ...overrides })
			.returning({ id: documentTypeLayout.id });
		const id = rows[0]?.id;
		if (!id) throw new Error("layout not inserted");
		return id;
	}

	test("selects the layout whose signature matches", async () => {
		const documentTypeId = await insertType();
		const old = await insertLayout(documentTypeId, {
			name: "Before 2024",
			sortOrder: 0,
			signature: {
				field: "content",
				cmp: "icontains",
				value: "ancienne mise en page",
			},
		});
		const recent = await insertLayout(documentTypeId, {
			name: "2024",
			sortOrder: 1,
			signature: {
				field: "content",
				cmp: "icontains",
				value: "nouvelle mise en page",
			},
		});
		const id = await insertDocument({ content: "Nouvelle mise en page 2024" });

		const outcome = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});
		expect(outcome.layoutId).toBe(recent);
		expect(outcome.layoutReason).toBe("signature");
		expect(outcome.layoutId).not.toBe(old);
		expect((await loadDocument(id)).layoutId).toBe(recent);
	});

	test("falls back on the date range", async () => {
		const documentTypeId = await insertType();
		await insertLayout(documentTypeId, {
			name: "2023",
			sortOrder: 0,
			validUntil: "2023-12-31",
		});
		const recent = await insertLayout(documentTypeId, {
			name: "2024+",
			sortOrder: 1,
			validFrom: "2024-01-01",
		});
		const id = await insertDocument({
			content: "Nothing distinctive",
			documentDate: "2024-06-15",
		});

		const outcome = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});
		expect(outcome.layoutId).toBe(recent);
		expect(outcome.layoutReason).toBe("dateRange");
	});

	test("otherwise tries every layout and keeps the best confidence", async () => {
		const documentTypeId = await insertType();
		const poor = await insertLayout(documentTypeId, {
			name: "Poor",
			sortOrder: 0,
			validFrom: "1990-01-01",
			validUntil: "1990-12-31",
		});
		const good = await insertLayout(documentTypeId, {
			name: "Good",
			sortOrder: 1,
			validFrom: "1991-01-01",
			validUntil: "1991-12-31",
		});
		await db.insert(extractionRule).values([
			{
				name: "Never matches",
				layoutId: poor,
				target: { kind: "title" },
				strategy: { kind: "regex", pattern: "ZZZ(\\d+)", group: 1 },
				postprocess: [],
			},
			{
				name: "Matches",
				layoutId: good,
				target: { kind: "title" },
				strategy: { kind: "regex", pattern: "Net à payer : (\\S+)", group: 1 },
				postprocess: [],
			},
		]);
		// A date outside both ranges: neither signature nor range can decide.
		const id = await insertDocument({
			content: "Net à payer : 1234",
			documentDate: "2024-06-15",
		});

		const outcome = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});
		expect(outcome.layoutId).toBe(good);
		expect(outcome.layoutReason).toBe("bestConfidence");
	});

	test("falls back on the default layout and still runs its rules", async () => {
		const documentTypeId = await insertType();
		const fallback = await insertLayout(documentTypeId, {
			name: "Default",
			isDefault: true,
			sortOrder: 0,
		});
		await insertLayout(documentTypeId, {
			name: "2022 only",
			sortOrder: 1,
			validFrom: "2022-01-01",
			validUntil: "2022-12-31",
		});
		const fields = await db
			.insert(customField)
			.values({ name: "Net pay", slug: "net-pay", type: "number" })
			.returning({ id: customField.id });
		const netPayId = fields[0]?.id ?? "";
		await db.insert(extractionRule).values({
			name: "Net pay",
			layoutId: fallback,
			target: { kind: "field", fieldId: netPayId },
			// Matches nothing here: no layout reaches the trial threshold.
			strategy: { kind: "regex", pattern: "ZZZ(\\d+)", group: 1 },
			postprocess: [],
		});

		const id = await insertDocument({
			content: "Net à payer : 1234",
			documentDate: "2026-06-15",
		});
		const outcome = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});

		expect(outcome.layoutId).toBe(fallback);
		expect(outcome.layoutReason).toBe("default");
		// The rules of the default layout still ran on the document.
		expect(outcome.extractions.map((item) => item.extractionRuleName)).toEqual([
			"Net pay",
		]);
		expect(outcome.fieldsWritten).toBe(0);
		// The document is still flagged: no layout recognised it.
		expect(outcome.reviewReasons.map((reason) => reason.code)).toContain(
			"unknownLayout",
		);
		expect((await loadDocument(id)).layoutId).toBe(fallback);

		// Recomputing keeps the reason: the layout in place is only the fallback.
		const unknown = outcome.reviewReasons.filter(
			(reason) => reason.code === "unknownLayout",
		);
		await db
			.update(document)
			.set({ reviewReasons: unknown, status: "review" })
			.where(eq(document.id, id));
		expect(
			(await computeReviewReasons(db, id)).map((reason) => reason.code),
		).toEqual(["unknownLayout"]);
	});

	/**
	 * Two layouts recognising the same document is a modelling mistake: the
	 * order settles it silently, so the document says so out loud — without
	 * being held back, since the extraction did run.
	 */
	test("flags an ambiguous match when two signatures both fire", async () => {
		const documentTypeId = await insertType();
		const first = await insertLayout(documentTypeId, {
			name: "Long form",
			isDefault: true,
			signature: { field: "content", cmp: "icontains", value: "bulletin" },
		});
		const second = await insertLayout(documentTypeId, {
			name: "Short form",
			sortOrder: 1,
			signature: { field: "content", cmp: "icontains", value: "paie" },
		});

		const id = await insertDocument({ content: "Bulletin de paie" });
		const outcome = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});

		expect(outcome.layoutId).toBe(first);
		expect(outcome.layoutReason).toBe("signature");
		expect(outcome.reviewReasons.map((reason) => reason.code)).toEqual([
			"ambiguousLayout",
		]);
		expect(outcome.reviewReasons[0]?.meta).toMatchObject({
			documentTypeId,
			layoutId: first,
			alternatives: [{ id: second, name: "Short form" }],
		});
		expect(outcome.reviewReasons.some(isBlockingReviewReason)).toBe(false);
	});

	test("flags two date ranges covering the same document", async () => {
		const documentTypeId = await insertType();
		const first = await insertLayout(documentTypeId, {
			name: "2023 onwards",
			isDefault: true,
			validFrom: "2023-01-01",
		});
		const second = await insertLayout(documentTypeId, {
			name: "2024 only",
			sortOrder: 1,
			validFrom: "2024-01-01",
			validUntil: "2024-12-31",
		});

		const id = await insertDocument({
			content: "Nothing distinctive",
			documentDate: "2024-06-15",
		});
		const outcome = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});

		expect(outcome.layoutId).toBe(first);
		expect(outcome.layoutReason).toBe("dateRange");
		expect(outcome.reviewReasons[0]?.meta).toMatchObject({
			alternatives: [{ id: second, name: "2024 only" }],
		});
	});

	test("clears the ambiguity once a layout is forced", async () => {
		const documentTypeId = await insertType();
		const first = await insertLayout(documentTypeId, {
			name: "Long form",
			isDefault: true,
			signature: { field: "content", cmp: "icontains", value: "bulletin" },
		});
		const second = await insertLayout(documentTypeId, {
			name: "Short form",
			sortOrder: 1,
			signature: { field: "content", cmp: "icontains", value: "paie" },
		});

		const id = await insertDocument({ content: "Bulletin de paie" });
		const ambiguous = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});
		await db
			.update(document)
			.set({ reviewReasons: ambiguous.reviewReasons })
			.where(eq(document.id, id));
		expect(first).not.toBe(second);

		await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
			layoutId: second,
		});
		expect((await loadDocument(id)).reviewReasons).toEqual([]);
	});

	test("a single layout is used as is, whatever its signature", async () => {
		const documentTypeId = await insertType();
		const only = await insertLayout(documentTypeId, {
			name: "Default",
			isDefault: true,
			signature: { field: "content", cmp: "icontains", value: "absent" },
		});
		const id = await insertDocument({ content: "Nothing distinctive" });

		const outcome = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});
		expect(outcome.layoutId).toBe(only);
		expect(outcome.layoutReason).toBe("only");
		expect(outcome.reviewReasons).toEqual([]);
	});

	test("emits `unknownLayout` when nothing matches, and clears it later", async () => {
		const documentTypeId = await insertType();
		const layoutId = await insertLayout(documentTypeId, {
			name: "2023 only",
			validFrom: "2023-01-01",
			validUntil: "2023-12-31",
			signature: { field: "content", cmp: "icontains", value: "absent" },
		});
		await insertLayout(documentTypeId, {
			name: "2022 only",
			sortOrder: 1,
			validFrom: "2022-01-01",
			validUntil: "2022-12-31",
		});
		const id = await insertDocument({
			content: "Nothing distinctive",
			documentDate: "2026-06-15",
		});

		const first = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});
		expect(first.layoutId).toBeNull();
		expect(first.reviewReasons.map((reason) => reason.code)).toEqual([
			"unknownLayout",
		]);

		// The pipeline stores the reason; recomputing keeps it while no layout is set.
		await db
			.update(document)
			.set({ reviewReasons: first.reviewReasons, status: "review" })
			.where(eq(document.id, id));
		expect(
			(await computeReviewReasons(db, id)).map((reason) => reason.code),
		).toEqual(["unknownLayout"]);
		expect((await loadDocument(id)).status).toBe("review");

		// Forcing a layout clears the reason and releases the document.
		const second = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
			layoutId,
		});
		expect(second.layoutId).toBe(layoutId);
		expect((await loadDocument(id)).reviewReasons).toEqual([]);
		expect(await computeReviewReasons(db, id)).toEqual([]);
		expect((await loadDocument(id)).status).toBe("active");
	});

	test("runs the extraction rules of the selected layout", async () => {
		const documentTypeId = await insertType();
		const layoutId = await insertLayout(documentTypeId, { name: "Only" });
		const other = await insertLayout(documentTypeId, { name: "Other" });
		const fields = await db
			.insert(customField)
			.values([
				{ name: "Net pay", slug: "net-pay", type: "number" },
				{ name: "Employee", slug: "employee", type: "text" },
			])
			.returning({ id: customField.id });
		const netPayId = fields[0]?.id ?? "";
		const employeeId = fields[1]?.id ?? "";

		await db.insert(extractionRule).values([
			{
				name: "Net pay",
				layoutId,
				target: { kind: "field", fieldId: netPayId },
				strategy: { kind: "regex", pattern: "Net à payer : (\\d+)", group: 1 },
				postprocess: [],
			},
			{
				name: "Employee",
				layoutId,
				target: { kind: "field", fieldId: employeeId },
				strategy: { kind: "regex", pattern: "Salarié : (\\w+)", group: 1 },
				postprocess: [],
			},
			// Another layout: its rules must not run here.
			{
				name: "Never",
				layoutId: other,
				target: { kind: "field", fieldId: employeeId },
				strategy: { kind: "regex", pattern: "ZZZ(\\w+)", group: 1 },
				postprocess: [],
			},
		]);

		const id = await insertDocument({
			content: "Net à payer : 1234\nSalarié : Camille",
		});
		const outcome = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});
		expect(outcome.layoutId).toBe(layoutId);
		expect(outcome.fieldsWritten).toBe(2);

		const values = await db
			.select()
			.from(documentFieldValue)
			.where(eq(documentFieldValue.documentId, id));
		expect(values).toHaveLength(2);
		expect(values.find((value) => value.fieldId === netPayId)?.value).toEqual({
			kind: "number",
			number: 1234,
		});
		expect(values.every((value) => value.source === "rule")).toBe(true);
	});

	/**
	 * Approving a document stamps `confirmed_at` instead of rewriting the value
	 * to `manual`: a layout fixed afterwards still reaches it, and the stamp
	 * goes away with the value it described (SPEC §4).
	 */
	test("re-applying the type refreshes a confirmed value, dropping the stamp", async () => {
		const documentTypeId = await insertType();
		const layoutId = await insertLayout(documentTypeId, {
			name: "Only",
			isDefault: true,
		});
		const fields = await db
			.insert(customField)
			.values({ name: "Net pay", slug: "net-pay", type: "number" })
			.returning({ id: customField.id });
		const fieldId = fields[0]?.id ?? "";
		await db.insert(extractionRule).values({
			name: "Net pay",
			layoutId,
			target: { kind: "field", fieldId },
			strategy: { kind: "regex", pattern: "Net à payer : (\\d+)", group: 1 },
			postprocess: [],
		});

		const id = await insertDocument({ content: "Net à payer : 1234" });
		// The state `review.approve` leaves behind: still `rule`, now confirmed.
		await db.insert(documentFieldValue).values({
			documentId: id,
			fieldId,
			value: { kind: "number", number: 999 },
			source: "rule",
			confidence: 0.4,
			confirmedAt: new Date(),
		});

		await applyDocumentType(db, id, documentTypeId, { source: "manual" });

		const [value] = await db
			.select()
			.from(documentFieldValue)
			.where(eq(documentFieldValue.documentId, id));
		expect(value?.value).toEqual({ kind: "number", number: 1234 });
		expect(value?.confirmedAt).toBeNull();
	});

	test("a value someone typed survives the same pass", async () => {
		const documentTypeId = await insertType();
		const layoutId = await insertLayout(documentTypeId, {
			name: "Only",
			isDefault: true,
		});
		const fields = await db
			.insert(customField)
			.values({ name: "Net pay", slug: "net-pay", type: "number" })
			.returning({ id: customField.id });
		const fieldId = fields[0]?.id ?? "";
		await db.insert(extractionRule).values({
			name: "Net pay",
			layoutId,
			target: { kind: "field", fieldId },
			strategy: { kind: "regex", pattern: "Net à payer : (\\d+)", group: 1 },
			postprocess: [],
		});

		const id = await insertDocument({ content: "Net à payer : 1234" });
		await db.insert(documentFieldValue).values({
			documentId: id,
			fieldId,
			value: { kind: "number", number: 999 },
			source: "manual",
			confidence: null,
		});

		await applyDocumentType(db, id, documentTypeId, { source: "manual" });

		const [value] = await db
			.select()
			.from(documentFieldValue)
			.where(eq(documentFieldValue.documentId, id));
		expect(value?.value).toEqual({ kind: "number", number: 999 });
	});

	/**
	 * An extraction that finds nothing used to block every document. Only a rule
	 * its author marked "required" does now.
	 */
	test("an optional rule that finds nothing leaves an informational trace", async () => {
		const documentTypeId = await insertType();
		const layoutId = await insertLayout(documentTypeId, {
			name: "Only",
			isDefault: true,
		});
		const fields = await db
			.insert(customField)
			.values({ name: "Reference", slug: "reference", type: "text" })
			.returning({ id: customField.id });
		const fieldId = fields[0]?.id ?? "";
		const rules = await db
			.insert(extractionRule)
			.values({
				name: "Reference",
				layoutId,
				target: { kind: "field", fieldId },
				strategy: { kind: "regex", pattern: "Référence : (\\w+)", group: 1 },
				postprocess: [],
			})
			.returning({ id: extractionRule.id });
		const extractionRuleId = rules[0]?.id ?? "";

		const id = await insertDocument({ content: "Nothing to extract here." });
		const outcome = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});

		expect(outcome.reviewReasons.map((reason) => reason.code)).toEqual([
			"extractionMissed",
		]);
		const reason = outcome.reviewReasons[0];
		expect(reason?.meta).toEqual({ ruleId: extractionRuleId, fieldId });
		expect(outcome.reviewReasons.some(isBlockingReviewReason)).toBe(false);
		// The field is simply left empty.
		expect(
			await db
				.select()
				.from(documentFieldValue)
				.where(eq(documentFieldValue.documentId, id)),
		).toEqual([]);
	});

	test("a required rule that finds nothing still blocks the document", async () => {
		const documentTypeId = await insertType();
		const layoutId = await insertLayout(documentTypeId, {
			name: "Only",
			isDefault: true,
		});
		const fields = await db
			.insert(customField)
			.values({ name: "Reference", slug: "reference", type: "text" })
			.returning({ id: customField.id });
		const fieldId = fields[0]?.id ?? "";
		await db.insert(extractionRule).values({
			name: "Reference",
			layoutId,
			required: true,
			target: { kind: "field", fieldId },
			strategy: { kind: "regex", pattern: "Référence : (\\w+)", group: 1 },
			postprocess: [],
		});

		const id = await insertDocument({ content: "Nothing to extract here." });
		const outcome = await applyDocumentType(db, id, documentTypeId, {
			source: "manual",
		});

		expect(outcome.reviewReasons.map((reason) => reason.code)).toEqual([
			"extractionFailed",
		]);
		expect(outcome.reviewReasons.some(isBlockingReviewReason)).toBe(true);
	});
});

describe("signatureFromText", () => {
	test("keeps the first rare words, ignoring digits and stop words", async () => {
		const condition = signatureFromText(
			"Le bulletin de paie 2024 mentionne SIRET 12345678900011 pour Solutions",
		);
		expect(condition).toMatchObject({ op: "and" });
		const children = (condition as { children: { value: string }[] }).children;
		expect(children.map((child) => child.value)).toEqual([
			"bulletin",
			"mentionne",
			"SIRET",
			"Solutions",
		]);
	});

	test("returns null on an empty text", () => {
		expect(signatureFromText("")).toBeNull();
	});
});

describe("detectDocumentTypes", () => {
	test("returns the matching types, best confidence first", async () => {
		await insertType({
			name: "Weak",
			priority: 0,
			detection: { field: "content", cmp: "icontains", value: "paie" },
			detectionConfidence: 0.4,
		});
		const strong = await insertType({
			name: "Strong",
			priority: 1,
			detection: {
				field: "content",
				cmp: "icontains",
				value: "Atelier Bellecombe",
			},
			detectionConfidence: 0.95,
		});
		const id = await insertDocument({
			content: "Bulletin de paie Atelier Bellecombe",
		});

		const candidates = await detectDocumentTypes(db, id);
		expect(candidates.map((item) => item.documentTypeId)[0]).toBe(strong);
		expect(candidates).toHaveLength(2);
	});

	test("ignores the disabled types and those without a condition", async () => {
		await insertType({ name: "No condition" });
		await insertType({
			name: "Disabled",
			enabled: false,
			detection: { field: "content", cmp: "icontains", value: "paie" },
		});
		const id = await insertDocument({ content: "Bulletin de paie" });
		expect(await detectDocumentTypes(db, id)).toEqual([]);
	});
});

describe("analyzeDocument — detection", () => {
	test("applies the best match above the threshold", async () => {
		await writeSetting(db, "review.confidenceThreshold", 0.8);
		const documentTypeId = await insertType({
			detection: {
				field: "content",
				cmp: "icontains",
				value: "Atelier Bellecombe",
			},
			detectionConfidence: 0.95,
		});
		const id = await insertDocument({
			content: "Bulletin de paie Atelier Bellecombe",
		});

		await analyzeDocument(db, id);
		const row = await loadDocument(id);
		expect(row.documentTypeId).toBe(documentTypeId);
		expect(row.documentTypeSource).toBe("rule");
		expect(row.categoryId).toBe(categoryId);
	});

	test("only proposes `typeCandidate` below the threshold", async () => {
		await writeSetting(db, "review.confidenceThreshold", 0.8);
		const documentTypeId = await insertType({
			detection: {
				field: "content",
				cmp: "icontains",
				value: "Atelier Bellecombe",
			},
			detectionConfidence: 0.5,
		});
		const id = await insertDocument({
			content: "Bulletin de paie Atelier Bellecombe",
		});

		const reasons = await analyzeDocument(db, id);
		const candidate = reasons.find((reason) => reason.code === "typeCandidate");
		expect(candidate?.meta?.documentTypeId).toBe(documentTypeId);
		expect(candidate?.ref).toBe(documentTypeId);

		const row = await loadDocument(id);
		expect(row.documentTypeId).toBeNull();
		// Informational: the document is not held back.
		expect(row.status).toBe("active");

		// Applying the type by hand drops the proposal.
		await applyDocumentType(db, id, documentTypeId, { source: "manual" });
		expect(
			(await computeReviewReasons(db, id)).map((reason) => reason.code),
		).not.toContain("typeCandidate");
	});

	test("never overrides a type already carried by the document", async () => {
		const chosen = await insertType({ name: "Chosen by hand" });
		await insertType({
			name: "Detected",
			detection: {
				field: "content",
				cmp: "icontains",
				value: "Atelier Bellecombe",
			},
			detectionConfidence: 1,
		});
		const id = await insertDocument({
			content: "Bulletin de paie Atelier Bellecombe",
		});
		await applyDocumentType(db, id, chosen, { source: "manual" });

		await analyzeDocument(db, id);
		expect((await loadDocument(id)).documentTypeId).toBe(chosen);
	});
});

describe("rule action set_document_type", () => {
	test("applies the whole type when the rule matches", async () => {
		const documentTypeId = await insertType();
		const rules = await db
			.insert(rule)
			.values({
				name: "Atelier Bellecombe payslip",
				condition: {
					field: "content",
					cmp: "icontains",
					value: "Atelier Bellecombe",
				},
				actions: [{ type: "set_document_type", documentTypeId }],
			})
			.returning({ id: rule.id });
		const ruleId = rules[0]?.id ?? "";

		const id = await insertDocument({
			content: "Bulletin de paie Atelier Bellecombe",
		});
		const result = await applyRules(db, id, { trigger: "ingest" });
		expect(result?.matchedCount).toBe(1);
		expect(result?.rules[0]?.operations).toEqual([
			{ type: "set_document_type", documentTypeId, confidence: 1 },
		]);

		const row = await loadDocument(id);
		expect(row.documentTypeId).toBe(documentTypeId);
		expect(row.documentTypeSource).toBe("rule");
		expect(row.categoryId).toBe(categoryId);
		expect(ruleId).not.toBe("");

		const issuer = await db
			.select()
			.from(documentParty)
			.where(
				and(eq(documentParty.documentId, id), eq(documentParty.role, "issuer")),
			);
		expect(issuer[0]?.partyId).toBe(partyId);
	});

	test("an unknown type raises an `extractionFailed` reason", async () => {
		await db.insert(rule).values({
			name: "Broken",
			condition: { op: "and", children: [] },
			actions: [{ type: "set_document_type", documentTypeId: "dty_absent" }],
		});
		const id = await insertDocument({ content: "Anything" });

		const result = await applyRules(db, id, { trigger: "ingest" });
		expect(result?.reviewReasons.map((reason) => reason.code)).toEqual([
			"extractionFailed",
		]);
		expect((await loadDocument(id)).documentTypeId).toBeNull();
	});
});
