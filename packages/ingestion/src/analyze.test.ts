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
import { documentType } from "@docstore/db/schema/document-type";
import { duplicateIgnore } from "@docstore/db/schema/duplicate-ignore";
import { party } from "@docstore/db/schema/party";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import { isBlockingReviewReason } from "@docstore/shared/document";
import { eq } from "drizzle-orm";
import { analyzeDocument, computeReviewReasons } from "./analyze";
import { writeSetting } from "./settings";
import { insertTestUser } from "./test-utils";

let db: TestDb;
let userId: string;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	userId = await insertTestUser(db);
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

async function loadDocument(id: string) {
	const rows = await db.select().from(document).where(eq(document.id, id));
	const row = rows[0];
	if (!row) throw new Error("missing document");
	return row;
}

describe("analyzeDocument — review reasons wording", () => {
	test("the missing issuer reason has no stray capital", async () => {
		await writeSetting(db, "review.requireIssuer", true);
		const id = await insertDocument({ content: "Nothing relevant here." });

		const reasons = await analyzeDocument(db, id);
		const reason = reasons.find((item) => item.code === "missingIssuer");
		expect(reason?.message).toBe("No issuer could be identified.");
	});

	test("a possible duplicate cites the other document's title, not its id", async () => {
		const otherId = await insertDocument({
			title: "EDF invoice — March",
			documentDate: "2026-03-01",
		});
		const id = await insertDocument({
			title: "EDF invoice — March",
			documentDate: "2026-03-01",
		});

		const reasons = await analyzeDocument(db, id);
		const reason = reasons.find((item) => item.code === "possibleDuplicate");
		expect(reason?.message).toBe(
			"A document already has this title and date: “EDF invoice — March”.",
		);
		expect(reason?.ref).toBe(otherId);
		expect(reason?.message).not.toContain(otherId);
	});

	test("a possible duplicate is informational and never queues a document", async () => {
		// The two other guards would queue the document on their own: this test
		// is about the duplicate note, not about them.
		await writeSetting(db, "review.requireCategory", false);
		await writeSetting(db, "review.requireIssuer", false);
		await insertDocument({
			title: "EDF invoice — March",
			documentDate: "2026-03-01",
		});
		const id = await insertDocument({
			title: "EDF invoice — March",
			documentDate: "2026-03-01",
		});

		const reasons = await analyzeDocument(db, id);
		expect(reasons.map((reason) => reason.code)).toContain("possibleDuplicate");
		expect(reasons.some(isBlockingReviewReason)).toBe(false);

		// `computeReviewReasons` keeps the note and leaves the document active.
		await db
			.update(document)
			.set({ status: "review" })
			.where(eq(document.id, id));
		const recomputed = await computeReviewReasons(db, id);
		expect(recomputed.map((reason) => reason.code)).toContain(
			"possibleDuplicate",
		);
		expect((await loadDocument(id)).status).toBe("active");
	});
});

describe("analyzeDocument — household members are never the issuer", () => {
	/** Valid French IBAN, formatted as a payslip prints it. */
	const IBAN = "FR76 3000 6000 0112 3456 7890 189";
	/** Valid SIRET (Luhn). */
	const SIRET = "90000001900027";

	async function insertParty(
		name: string,
		values: Partial<typeof party.$inferInsert>,
	): Promise<string> {
		const rows = await db
			.insert(party)
			.values({ type: "company", name, ...values })
			.returning({ id: party.id });
		return rows[0]?.id ?? "";
	}

	async function linksOf(documentId: string) {
		return db
			.select({ partyId: documentParty.partyId, role: documentParty.role })
			.from(documentParty)
			.where(eq(documentParty.documentId, documentId));
	}

	test("a member matched by IBAN is proposed as subject", async () => {
		const camille = await insertParty("Camille Moreau", {
			type: "person",
			isHouseholdMember: true,
			identifiers: { iban: [IBAN.replace(/\s/g, "")] },
		});
		const id = await insertDocument({
			content: `Bulletin de paie — virement sur ${IBAN}`,
		});

		await analyzeDocument(db, id);
		expect(await linksOf(id)).toEqual([{ partyId: camille, role: "subject" }]);
	});

	test("the employer takes the issuer slot, the member the subject one", async () => {
		const camille = await insertParty("Camille Moreau", {
			type: "person",
			isHouseholdMember: true,
			identifiers: { iban: [IBAN.replace(/\s/g, "")] },
		});
		const employer = await insertParty("Nordwind Digital", {
			identifiers: { siret: SIRET },
		});
		const id = await insertDocument({
			content: `Bulletin de paie — SIRET ${SIRET} — virement sur ${IBAN}`,
		});

		await analyzeDocument(db, id);
		const links = await linksOf(id);
		expect(links).toHaveLength(2);
		expect(links).toContainEqual({ partyId: employer, role: "issuer" });
		expect(links).toContainEqual({ partyId: camille, role: "subject" });
	});

	test("a member alone leaves the issuer missing rather than wrong", async () => {
		await writeSetting(db, "review.requireIssuer", true);
		await insertParty("Camille Moreau", {
			type: "person",
			isHouseholdMember: true,
			identifiers: { iban: [IBAN.replace(/\s/g, "")] },
		});
		const id = await insertDocument({
			content: `Attestation — RIB ${IBAN}`,
		});

		const reasons = await analyzeDocument(db, id);
		expect(reasons.map((reason) => reason.code)).toContain("missingIssuer");
	});

	test("a company matched by IBAN is still an issuer", async () => {
		const supplier = await insertParty("Nordwind Digital", {
			identifiers: { iban: [IBAN.replace(/\s/g, "")] },
		});
		const id = await insertDocument({ content: `Facture — IBAN ${IBAN}` });

		await analyzeDocument(db, id);
		expect(await linksOf(id)).toEqual([{ partyId: supplier, role: "issuer" }]);
	});
});

describe("analyzeDocument — recurringCandidate", () => {
	let partyId: string;
	let categoryId: string;

	async function seedCouple(): Promise<void> {
		const parties = await db
			.insert(party)
			.values({ type: "company", name: "EDF" })
			.returning({ id: party.id });
		partyId = parties[0]?.id ?? "";
		const categories = await db
			.insert(category)
			.values({ name: "Invoice", slug: "invoice" })
			.returning({ id: category.id });
		categoryId = categories[0]?.id ?? "";
	}

	/** Document issued by `partyId`, filed under `categoryId`, on `period`. */
	async function seedInvoice(period: string): Promise<string> {
		const id = await insertDocument({
			title: `EDF invoice ${period}`,
			categoryId,
			periodStart: period,
			documentDate: period,
			datePrecision: "month",
		});
		await db
			.insert(documentParty)
			.values({ documentId: id, partyId, role: "issuer", source: "rule" });
		return id;
	}

	beforeEach(seedCouple);

	test("a single document is not a recurrence", async () => {
		const id = await seedInvoice("2024-01-01");
		const reasons = await analyzeDocument(db, id);
		expect(reasons.map((reason) => reason.code)).not.toContain(
			"recurringCandidate",
		);
	});

	test("two documents on distinct periods raise the reason", async () => {
		const january = await seedInvoice("2024-01-01");
		const february = await seedInvoice("2024-02-01");

		const reasons = await analyzeDocument(db, february);
		const reason = reasons.find((item) => item.code === "recurringCandidate");
		expect(reason?.message).toBe(
			"Looks like a recurring document: 2 documents from EDF in Invoice (monthly). Create a document type?",
		);
		expect(reason?.ref).toBe(partyId);
		expect(reason?.meta).toMatchObject({
			partyId,
			categoryId,
			periodicity: "monthly",
			startPeriod: "2024-01-01",
			endPeriod: "2024-02-01",
		});
		const documentIds = reason?.meta?.documentIds as string[] | undefined;
		expect(documentIds?.sort()).toEqual([january, february].sort());
	});

	test("two documents on the same period are not a recurrence", async () => {
		await seedInvoice("2024-01-01");
		const second = await seedInvoice("2024-01-01");
		const reasons = await analyzeDocument(db, second);
		expect(reasons.map((reason) => reason.code)).not.toContain(
			"recurringCandidate",
		);
	});

	test("the periodicity follows the observed gaps", async () => {
		await seedInvoice("2022-05-01");
		await seedInvoice("2023-05-01");
		const last = await seedInvoice("2024-05-01");

		const reasons = await analyzeDocument(db, last);
		const reason = reasons.find((item) => item.code === "recurringCandidate");
		expect(reason?.message).toContain("(yearly)");
		expect(reason?.meta).toMatchObject({
			periodicity: "yearly",
			startPeriod: "2022-01-01",
			endPeriod: "2024-01-01",
		});
	});

	test("stays quiet when a document type already covers the couple", async () => {
		await seedInvoice("2024-01-01");
		const february = await seedInvoice("2024-02-01");
		await db.insert(documentType).values({
			name: "EDF — Invoice",
			issuerPartyId: partyId,
			categoryId,
			periodicity: "monthly",
			startPeriod: "2024-01-01",
		});

		const reasons = await analyzeDocument(db, february);
		expect(reasons.map((reason) => reason.code)).not.toContain(
			"recurringCandidate",
		);
	});

	test("it never sends the document to review on its own", async () => {
		await seedInvoice("2024-01-01");
		const february = await seedInvoice("2024-02-01");
		await db
			.update(document)
			.set({ status: "review" })
			.where(eq(document.id, february));

		const reasons = await analyzeDocument(db, february);
		expect(reasons.map((reason) => reason.code)).toEqual([
			"recurringCandidate",
		]);

		// `computeReviewReasons` keeps the reason but releases the document.
		expect(await computeReviewReasons(db, february)).toHaveLength(1);
		expect((await loadDocument(february)).status).toBe("active");
	});

	test("computeReviewReasons drops it once a type covers the couple", async () => {
		await seedInvoice("2024-01-01");
		const february = await seedInvoice("2024-02-01");
		await analyzeDocument(db, february);
		expect(await computeReviewReasons(db, february)).toHaveLength(1);

		await db.insert(documentType).values({
			name: "EDF — Invoice",
			issuerPartyId: partyId,
			categoryId,
			periodicity: "monthly",
			startPeriod: "2024-01-01",
		});
		expect(await computeReviewReasons(db, february)).toEqual([]);
		expect((await loadDocument(february)).reviewReasons).toEqual([]);
	});
});

describe("computeReviewReasons", () => {
	test("drops `missingCategory` once a category is set", async () => {
		const categories = await db
			.insert(category)
			.values({ name: "Invoice", slug: "invoice" })
			.returning({ id: category.id });
		const categoryId = categories[0]?.id;
		if (!categoryId) throw new Error("category not inserted");

		const id = await insertDocument({
			status: "review",
			reviewReasons: [{ code: "missingCategory", message: "…" }],
		});

		expect(await computeReviewReasons(db, id)).toEqual([
			{ code: "missingCategory", message: "…" },
		]);

		await db.update(document).set({ categoryId }).where(eq(document.id, id));
		expect(await computeReviewReasons(db, id)).toEqual([]);

		const doc = await loadDocument(id);
		expect(doc.status).toBe("active");
	});

	test("drops `missingIssuer` once an issuer party is linked", async () => {
		const parties = await db
			.insert(party)
			.values({ type: "company", name: "EDF" })
			.returning({ id: party.id });
		const partyId = parties[0]?.id;
		if (!partyId) throw new Error("party not inserted");

		const id = await insertDocument({
			status: "review",
			reviewReasons: [{ code: "missingIssuer", message: "…", field: "issuer" }],
		});
		expect(await computeReviewReasons(db, id)).toHaveLength(1);

		await db
			.insert(documentParty)
			.values({ documentId: id, partyId, role: "issuer", source: "rule" });
		expect(await computeReviewReasons(db, id)).toEqual([]);
		expect((await loadDocument(id)).status).toBe("active");
	});

	test("drops a `lowConfidence` category reason once the confidence clears the threshold", async () => {
		const categories = await db
			.insert(category)
			.values({ name: "Invoice", slug: "invoice" })
			.returning({ id: category.id });
		const categoryId = categories[0]?.id;
		if (!categoryId) throw new Error("category not inserted");

		const id = await insertDocument({
			status: "review",
			categoryId,
			categorySource: "rule",
			categoryConfidence: 0.4,
			reviewReasons: [
				{
					code: "lowConfidence",
					message: "…",
					field: "category",
					confidence: 0.4,
				},
			],
		});
		expect(await computeReviewReasons(db, id)).toHaveLength(1);

		await db
			.update(document)
			.set({ categoryConfidence: 0.95 })
			.where(eq(document.id, id));
		expect(await computeReviewReasons(db, id)).toEqual([]);
		expect((await loadDocument(id)).status).toBe("active");
	});

	test("drops a `lowConfidence` custom field reason once it is corrected manually", async () => {
		const fields = await db
			.insert(customField)
			.values({ name: "Total amount", slug: "total-amount", type: "number" })
			.returning({ id: customField.id });
		const fieldId = fields[0]?.id;
		if (!fieldId) throw new Error("custom field not inserted");

		const id = await insertDocument({
			status: "review",
			reviewReasons: [
				{
					code: "lowConfidence",
					message: "…",
					field: fieldId,
					confidence: 0.3,
				},
			],
		});
		await db.insert(documentFieldValue).values({
			documentId: id,
			fieldId,
			value: { kind: "number", number: 12 },
			source: "rule",
			confidence: 0.3,
		});
		expect(await computeReviewReasons(db, id)).toHaveLength(1);

		// A manual correction clears the confidence column.
		await db
			.update(documentFieldValue)
			.set({ source: "manual", confidence: null })
			.where(eq(documentFieldValue.documentId, id));
		expect(await computeReviewReasons(db, id)).toEqual([]);
		expect((await loadDocument(id)).status).toBe("active");
	});

	test("keeps other pending reasons: the document stays in review", async () => {
		const id = await insertDocument({
			status: "review",
			reviewReasons: [
				{ code: "missingCategory", message: "…" },
				{ code: "missingIssuer", message: "…", field: "issuer" },
			],
		});

		const parties = await db
			.insert(party)
			.values({ type: "company", name: "EDF" })
			.returning({ id: party.id });
		await db.insert(documentParty).values({
			documentId: id,
			partyId: parties[0]?.id ?? "",
			role: "issuer",
			source: "rule",
		});

		const reasons = await computeReviewReasons(db, id);
		expect(reasons.map((reason) => reason.code)).toEqual(["missingCategory"]);
		expect((await loadDocument(id)).status).toBe("review");
	});

	test('drops `possibleDuplicate` once the pair is dismissed ("Keep both")', async () => {
		const otherId = await insertDocument({ title: "Other" });
		const id = await insertDocument({
			status: "review",
			reviewReasons: [
				{
					code: "possibleDuplicate",
					message: "…",
					field: "title",
					ref: otherId,
				},
			],
		});
		expect(await computeReviewReasons(db, id)).toHaveLength(1);

		// Normalized so `documentId < otherDocumentId`, exactly like
		// `document.ignoreDuplicate` stores it.
		const [a, b] = id < otherId ? [id, otherId] : [otherId, id];
		await db
			.insert(duplicateIgnore)
			.values({ documentId: a, otherDocumentId: b });

		expect(await computeReviewReasons(db, id)).toEqual([]);
		expect((await loadDocument(id)).status).toBe("active");
	});

	test("drops `possibleDuplicate` once the other document is trashed", async () => {
		const otherId = await insertDocument({ title: "Other" });
		const id = await insertDocument({
			status: "review",
			reviewReasons: [
				{
					code: "possibleDuplicate",
					message: "…",
					field: "title",
					ref: otherId,
				},
			],
		});
		expect(await computeReviewReasons(db, id)).toHaveLength(1);

		await db
			.update(document)
			.set({ deletedAt: new Date() })
			.where(eq(document.id, otherId));

		expect(await computeReviewReasons(db, id)).toEqual([]);
		expect((await loadDocument(id)).status).toBe("active");
	});

	test("returns an empty array for an unknown document", async () => {
		expect(await computeReviewReasons(db, "doc_missing")).toEqual([]);
	});
});

describe("analyzeDocument — payslip dates", () => {
	const PAYSLIP = [
		"BULLETIN DE PAIE",
		"Période du 01/08/2026 au 31/08/2026",
		"NET À PAYER 2 145,30",
		"Payé le 05/09/2026",
	].join("\n");

	test("fills the period and prefers the payment date for the document date", async () => {
		const id = await insertDocument({ content: PAYSLIP });
		await analyzeDocument(db, id);

		const doc = await loadDocument(id);
		expect(doc.periodStart).toBe("2026-08-01");
		expect(doc.periodEnd).toBe("2026-08-31");
		// Not 2026-08-01, which is only the first day of the covered period.
		expect(doc.documentDate).toBe("2026-09-05");
	});

	test("reads the English wording as well", async () => {
		const id = await insertDocument({
			content: "Pay period from 2026-08-01 to 2026-08-31\nIssued on 05/09/2026",
		});
		await analyzeDocument(db, id);

		const doc = await loadDocument(id);
		expect(doc.periodStart).toBe("2026-08-01");
		expect(doc.periodEnd).toBe("2026-08-31");
		expect(doc.documentDate).toBe("2026-09-05");
	});

	test("without a payment date, the period start is not taken either", async () => {
		const id = await insertDocument({
			content: "Période du 01/08/2026 au 31/08/2026\nÉdition 12/09/2026",
		});
		await analyzeDocument(db, id);

		const doc = await loadDocument(id);
		expect(doc.periodStart).toBe("2026-08-01");
		expect(doc.documentDate).toBe("2026-09-12");
	});

	test("a period entered by hand is left alone", async () => {
		const id = await insertDocument({
			content: PAYSLIP,
			periodStart: "2026-07-01",
			periodEnd: "2026-07-31",
			// What `document.update` records when someone edits the period.
			manualFields: ["periodStart", "periodEnd"],
		});
		await analyzeDocument(db, id);

		const doc = await loadDocument(id);
		expect(doc.periodStart).toBe("2026-07-01");
		expect(doc.periodEnd).toBe("2026-07-31");
	});

	/**
	 * The mirror case: without a marker, the value on the row came from an
	 * earlier pass of this very module, and a second pass is allowed to correct
	 * it — this is what `document.reprocess` is for.
	 */
	test("a period nobody edited is recomputed", async () => {
		const id = await insertDocument({
			content: PAYSLIP,
			periodStart: "2026-07-01",
			periodEnd: "2026-07-31",
		});
		await analyzeDocument(db, id);

		const doc = await loadDocument(id);
		expect(doc.periodStart).toBe("2026-08-01");
		expect(doc.periodEnd).toBe("2026-08-31");
	});

	test("a date entered by hand survives the analysis", async () => {
		const id = await insertDocument({
			content: PAYSLIP,
			documentDate: "2026-12-24",
			datePrecision: "day",
			manualFields: ["documentDate", "datePrecision"],
		});
		await analyzeDocument(db, id);

		const doc = await loadDocument(id);
		expect(doc.documentDate).toBe("2026-12-24");
		// The period carries no marker: it is filled all the same.
		expect(doc.periodStart).toBe("2026-08-01");
	});
});

/**
 * A date read off the text used to carry a flat 0.6 confidence, under the 0.75
 * threshold: every single document landed in the review queue for it.
 */
describe("analyzeDocument — where the document date comes from", () => {
	test("a labelled date is written with a confidence above the threshold", async () => {
		const id = await insertDocument({
			content:
				"Facture\nPériode du 01/08/2026 au 31/08/2026\nPayé le 05/09/2026",
		});
		const reasons = await analyzeDocument(db, id);

		const doc = await loadDocument(id);
		expect(doc.documentDate).toBe("2026-09-05");
		expect(doc.dateSource).toBe("labelled");
		expect(doc.dateConfidence).toBe(0.9);
		expect(reasons.filter((reason) => reason.field === "documentDate")).toEqual(
			[],
		);
	});

	test("a date read off the covered period is trusted as well", async () => {
		const id = await insertDocument({
			content: "Relevé de compte du 01/08/2026 au 31/08/2026",
		});
		await analyzeDocument(db, id);

		const doc = await loadDocument(id);
		expect(doc.documentDate).toBe("2026-08-01");
		expect(doc.dateSource).toBe("period");
		expect(doc.dateConfidence).toBe(0.9);
	});

	test("the bare first date of the text is informational, never blocking", async () => {
		// The date is the only thing under scrutiny here.
		await writeSetting(db, "review.requireCategory", false);
		await writeSetting(db, "review.requireIssuer", false);
		const id = await insertDocument({
			content: "Facture 12/09/2026 — total 30,00 EUR",
			status: "review",
		});
		const reasons = await analyzeDocument(db, id);

		const doc = await loadDocument(id);
		expect(doc.documentDate).toBe("2026-09-12");
		expect(doc.dateSource).toBe("inferred");
		expect(doc.dateConfidence).toBe(0.6);

		const dateReason = reasons.find(
			(reason) =>
				reason.code === "lowConfidence" && reason.field === "documentDate",
		);
		expect(dateReason).toBeDefined();
		expect(reasons.some(isBlockingReviewReason)).toBe(false);

		// The reason is surfaced, but the document goes on living its life.
		await computeReviewReasons(db, id);
		expect((await loadDocument(id)).status).toBe("active");
	});

	test("a date typed by hand drops the reason it used to raise", async () => {
		const id = await insertDocument({
			content: "Facture 12/09/2026",
			status: "review",
			documentDate: "2026-01-15",
			datePrecision: "day",
			manualFields: ["documentDate"],
			dateSource: "manual",
			reviewReasons: [
				{
					code: "lowConfidence",
					message: 'Date "12/09/2026" inferred from the text (confidence 60%).',
					confidence: 0.6,
					field: "documentDate",
				},
				{ code: "missingCategory", message: "No category.", field: "category" },
			],
		});

		const reasons = await computeReviewReasons(db, id);
		expect(reasons.map((reason) => reason.code)).toEqual(["missingCategory"]);
		expect((await loadDocument(id)).documentDate).toBe("2026-01-15");
	});
});
