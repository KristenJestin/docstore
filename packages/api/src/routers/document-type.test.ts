import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { category } from "@docstore/db/schema/category";
import { document, documentParty } from "@docstore/db/schema/document";
import { party } from "@docstore/db/schema/party";
import { extractionRule } from "@docstore/db/schema/rule";
import { tag } from "@docstore/db/schema/tag";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { eq } from "drizzle-orm";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

let db: TestDb;
let owner: TestUser;
let client: ReturnType<typeof createTestClient>;
let partyId: string;
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
	owner = await createTestUser(db);
	client = createTestClient(db, owner);

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

	const tags = await db
		.insert(tag)
		.values({ name: "energy" })
		.returning({ id: tag.id });
	tagId = tags[0]?.id ?? "";
});

/**
 * Document attached to the recurring type by its issuer, its category and its
 * period. Every date is in the past: the timeline is deterministic.
 */
async function seedPeriodDocument(
	periodStart: string,
	overrides: {
		partyId?: string | null;
		categoryId?: string | null;
		title?: string;
		content?: string;
	} = {},
): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title: overrides.title ?? `Invoice ${periodStart}`,
			status: "active",
			periodStart,
			documentDate: periodStart,
			datePrecision: "month",
			categoryId:
				overrides.categoryId === undefined ? categoryId : overrides.categoryId,
			...(overrides.content ? { content: overrides.content } : {}),
			createdById: owner.id,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");

	const issuer = overrides.partyId === undefined ? partyId : overrides.partyId;
	if (issuer) {
		await db
			.insert(documentParty)
			.values({ documentId: id, partyId: issuer, role: "issuer" });
	}
	return id;
}

/** Monthly recurrence of 6 periods (January to June 2024), without grace. */
function monthlyInput() {
	return {
		name: "EDF invoice",
		issuerPartyId: partyId,
		categoryId,
		recurrence: {
			periodicity: "monthly" as const,
			startPeriod: "2024-01-01",
			endPeriod: "2024-06-30",
			graceDays: 0,
		},
	};
}

describe("documentType.create", () => {
	test("creates a plain type, without recurrence", async () => {
		const created = await client.documentType.create({
			name: "Car insurance certificate",
			categoryId,
			tagIds: [tagId],
			sensitiveDefault: true,
		});
		expect(created.id).toStartWith("dty_");
		expect(created.periodicity).toBeNull();
		expect(created.startPeriod).toBeNull();
		expect(created.tagIds).toEqual([tagId]);
		expect(created.sensitiveDefault).toBe(true);
		expect(created.enabled).toBe(true);
		expect(created.detectionConfidence).toBeCloseTo(0.9);
	});

	test("snaps the start of the recurrence to its period", async () => {
		const created = await client.documentType.create({
			...monthlyInput(),
			recurrence: { ...monthlyInput().recurrence, startPeriod: "2024-01-17" },
		});
		expect(created.startPeriod).toBe("2024-01-01");
		expect(created.graceDays).toBe(0);
	});

	test("rejects an end bound earlier than the start", async () => {
		await expectOrpcError(
			client.documentType.create({
				...monthlyInput(),
				recurrence: {
					periodicity: "monthly",
					startPeriod: "2024-06-01",
					endPeriod: "2024-01-31",
				},
			}),
			"BAD_REQUEST",
		);
	});

	test("404 on an unknown Party, category or tag", async () => {
		await expectOrpcError(
			client.documentType.create({
				...monthlyInput(),
				issuerPartyId: "prt_absent",
			}),
			"NOT_FOUND",
		);
		await expectOrpcError(
			client.documentType.create({ name: "X", categoryId: "cat_absent" }),
			"NOT_FOUND",
		);
		await expectOrpcError(
			client.documentType.create({ name: "X", tagIds: ["tag_absent"] }),
			"NOT_FOUND",
		);
	});
});

describe("documentType — titles", () => {
	/** Monthly type whose documents are named after their period. */
	function titledInput(name = "EDF invoice") {
		return {
			...monthlyInput(),
			name,
			titleTemplate: "{type} {period:MMMM yyyy}",
		};
	}

	test("a new recurring type starts with the default template", async () => {
		const recurring = await client.documentType.create(monthlyInput());
		expect(recurring.titleTemplate).toBe("{type} {period:MMMM yyyy}");

		// A one-off type leaves the titles alone.
		const oneOff = await client.documentType.create({ name: "Passport" });
		expect(oneOff.titleTemplate).toBeNull();

		// An explicit `null` is obeyed, recurrence or not.
		const bare = await client.documentType.create({
			...monthlyInput(),
			name: "Bare",
			titleTemplate: null,
		});
		expect(bare.titleTemplate).toBeNull();
	});

	test("previewTitles shows what regenerateTitles would write", async () => {
		const january = await seedPeriodDocument("2024-01-01", {
			title: "scan-001",
		});
		const february = await seedPeriodDocument("2024-02-01", {
			title: "scan-002",
		});
		const created = await client.documentType.create(titledInput());

		const preview = await client.documentType.previewTitles({
			id: created.id,
			limit: 5,
		});
		// Most recent period first.
		expect(preview.map((item) => item.title)).toEqual([
			"EDF invoice February 2024",
			"EDF invoice January 2024",
		]);
		expect(preview.every((item) => item.manual)).toBe(false);
		// Nothing was written.
		expect((await client.document.get({ id: january })).title).toBe("scan-001");

		expect(
			await client.documentType.regenerateTitles({ id: created.id }),
		).toEqual({ updated: 2, skipped: 0 });
		expect((await client.document.get({ id: january })).title).toBe(
			"EDF invoice January 2024",
		);
		expect((await client.document.get({ id: february })).title).toBe(
			"EDF invoice February 2024",
		);

		// Titles already matching the template are left alone the second time.
		expect(
			await client.documentType.regenerateTitles({ id: created.id }),
		).toEqual({ updated: 0, skipped: 2 });
	});

	test("a title set by hand survives unless `overwriteManual`", async () => {
		const id = await seedPeriodDocument("2024-01-01", { title: "scan-001" });
		const created = await client.documentType.create(titledInput());
		await client.document.update({ id, title: "The one I typed" });

		const preview = await client.documentType.previewTitles({ id: created.id });
		expect(preview[0]?.manual).toBe(true);

		expect(
			await client.documentType.regenerateTitles({ id: created.id }),
		).toEqual({ updated: 0, skipped: 1 });
		expect((await client.document.get({ id })).title).toBe("The one I typed");

		expect(
			await client.documentType.regenerateTitles({
				id: created.id,
				overwriteManual: true,
			}),
		).toEqual({ updated: 1, skipped: 0 });
		expect((await client.document.get({ id })).title).toBe(
			"EDF invoice January 2024",
		);
	});

	test("BAD_REQUEST when the type has no template", async () => {
		const created = await client.documentType.create({
			...monthlyInput(),
			titleTemplate: null,
		});
		await expectOrpcError(
			client.documentType.regenerateTitles({ id: created.id }),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			client.documentType.previewTitles({ id: created.id }),
			"BAD_REQUEST",
		);
	});

	test("the bulk action uses the template of the type each document carries", async () => {
		const withType = await seedPeriodDocument("2024-01-01", {
			title: "scan-001",
		});
		const untyped = await seedPeriodDocument("2024-02-01", {
			title: "scan-002",
			partyId: null,
			categoryId: null,
		});
		const created = await client.documentType.create(titledInput());
		await db
			.update(document)
			.set({ documentTypeId: created.id })
			.where(eq(document.id, withType));

		const result = await client.document.bulk({
			ids: [withType, untyped],
			action: { type: "regenerateTitle" },
		});
		expect(result.updated).toBe(1);
		expect((await client.document.get({ id: withType })).title).toBe(
			"EDF invoice January 2024",
		);
		// No type, no template: the title is left as it is.
		expect((await client.document.get({ id: untyped })).title).toBe("scan-002");
	});
});

describe("documentType — missing periods", () => {
	test("monthly recurrence of 6 months with 2 gaps", async () => {
		for (const month of [
			"2024-01-01",
			"2024-02-01",
			"2024-04-01",
			"2024-06-01",
		]) {
			await seedPeriodDocument(month);
		}
		const created = await client.documentType.create(monthlyInput());

		const detail = await client.documentType.get({ id: created.id });
		expect(detail.timeline).toHaveLength(6);
		expect(detail.stats?.expected).toBe(6);
		expect(detail.stats?.present).toBe(4);
		expect(detail.stats?.missing).toEqual(["2024-03", "2024-05"]);
		expect(detail.stats?.lastPeriod).toBe("2024-06");
		expect(detail.memberCount).toBe(4);
		expect(detail.timeline.map((entry) => entry.status)).toEqual([
			"present",
			"present",
			"missing",
			"present",
			"missing",
			"present",
		]);

		const listed = await client.documentType.list({});
		expect(listed).toHaveLength(1);
		expect(listed[0]?.stats?.missing).toEqual(["2024-03", "2024-05"]);
		expect(listed[0]?.issuerName).toBe("EDF");
		expect(listed[0]?.issuer).toEqual({
			id: partyId,
			name: "EDF",
			logoKey: null,
		});
		expect(listed[0]?.subject).toBeNull();
		expect(listed[0]?.categoryName).toBe("Invoice");
	});

	test("weekly recurrence uses ISO weeks", async () => {
		// 2024-01-01 is a Monday; 2024-01-15 skips the second week.
		await seedPeriodDocument("2024-01-01");
		await seedPeriodDocument("2024-01-15");
		const created = await client.documentType.create({
			...monthlyInput(),
			name: "Weekly report",
			recurrence: {
				periodicity: "weekly",
				startPeriod: "2024-01-01",
				endPeriod: "2024-01-21",
				graceDays: 0,
			},
		});

		const detail = await client.documentType.get({ id: created.id });
		expect(detail.timeline.map((entry) => entry.period)).toEqual([
			"2024-W01",
			"2024-W02",
			"2024-W03",
		]);
		expect(detail.stats?.missing).toEqual(["2024-W02"]);
		expect(detail.timeline[0]?.dueDate).toBe("2024-01-07");
	});

	test("quarterly: a document of the quarter covers the period", async () => {
		await seedPeriodDocument("2024-02-15");
		await seedPeriodDocument("2024-10-01");
		const created = await client.documentType.create({
			...monthlyInput(),
			name: "Quarterly tax",
			recurrence: {
				periodicity: "quarterly",
				startPeriod: "2024-01-01",
				endPeriod: "2024-12-31",
				graceDays: 0,
			},
		});

		const detail = await client.documentType.get({ id: created.id });
		expect(detail.timeline.map((entry) => entry.period)).toEqual([
			"2024-Q1",
			"2024-Q2",
			"2024-Q3",
			"2024-Q4",
		]);
		expect(detail.stats?.missing).toEqual(["2024-Q2", "2024-Q3"]);
		expect(detail.stats?.present).toBe(2);
	});

	test("semiannual: two halves a year, keyed H1 and H2", async () => {
		await seedPeriodDocument("2024-02-15");
		await seedPeriodDocument("2025-08-01");
		const created = await client.documentType.create({
			...monthlyInput(),
			name: "Semiannual statement",
			recurrence: {
				periodicity: "semiannual",
				startPeriod: "2024-03-10",
				endPeriod: "2025-12-31",
				graceDays: 0,
			},
		});

		// The start is snapped to 1 January, the first day of its half.
		expect(created.startPeriod).toBe("2024-01-01");

		const detail = await client.documentType.get({ id: created.id });
		expect(detail.timeline.map((entry) => entry.period)).toEqual([
			"2024-H1",
			"2024-H2",
			"2025-H1",
			"2025-H2",
		]);
		expect(detail.timeline.map((entry) => entry.dueDate)).toEqual([
			"2024-06-30",
			"2024-12-31",
			"2025-06-30",
			"2025-12-31",
		]);
		expect(detail.stats?.missing).toEqual(["2024-H2", "2025-H1"]);
		expect(detail.stats?.present).toBe(2);
		expect(detail.stats?.lastPeriod).toBe("2025-H2");
	});

	test("yearly recurrence", async () => {
		await seedPeriodDocument("2021-05-01");
		const created = await client.documentType.create({
			...monthlyInput(),
			name: "Tax notice",
			recurrence: {
				periodicity: "yearly",
				startPeriod: "2020-01-01",
				endPeriod: "2022-12-31",
				graceDays: 0,
			},
		});

		const detail = await client.documentType.get({ id: created.id });
		expect(detail.timeline.map((entry) => entry.period)).toEqual([
			"2020",
			"2021",
			"2022",
		]);
		expect(detail.stats?.missing).toEqual(["2020", "2022"]);
		expect(detail.stats?.lastPeriod).toBe("2021");
	});

	test("the current period stays `pending` until the due date has passed", async () => {
		const created = await client.documentType.create({
			name: "Open recurrence",
			issuerPartyId: partyId,
			categoryId,
			recurrence: { periodicity: "monthly", startPeriod: "2024-01-01" },
		});
		const detail = await client.documentType.get({ id: created.id });
		expect(detail.timeline.at(-1)?.status).toBe("pending");
	});

	test("a type without recurrence has no timeline and no stats", async () => {
		const created = await client.documentType.create({ name: "Passport" });
		const detail = await client.documentType.get({ id: created.id });
		expect(detail.timeline).toEqual([]);
		expect(detail.stats).toBeNull();
	});

	test("`recurringOnly` keeps only the recurring types", async () => {
		await client.documentType.create({ name: "Passport" });
		await client.documentType.create(monthlyInput());
		expect(await client.documentType.list({})).toHaveLength(2);
		expect(
			await client.documentType.list({ recurringOnly: true }),
		).toHaveLength(1);
	});
});

describe("documentType.setDocumentOverride", () => {
	test("excludes an attached document and forces an outside one", async () => {
		await seedPeriodDocument("2024-01-01");
		const february = await seedPeriodDocument("2024-02-01");
		await seedPeriodDocument("2024-04-01");
		await seedPeriodDocument("2024-06-01");
		// Document outside the criteria: neither this issuer nor this category.
		const intruder = await seedPeriodDocument("2024-03-01", {
			partyId: null,
			categoryId: null,
			title: "March paper invoice",
		});

		const created = await client.documentType.create(monthlyInput());
		expect(
			(await client.documentType.get({ id: created.id })).stats?.missing,
		).toEqual(["2024-03", "2024-05"]);

		const excluded = await client.documentType.setDocumentOverride({
			documentTypeId: created.id,
			documentId: february,
			included: false,
		});
		expect(excluded.stats?.missing).toEqual(["2024-02", "2024-03", "2024-05"]);

		const forced = await client.documentType.setDocumentOverride({
			documentTypeId: created.id,
			documentId: intruder,
			included: true,
		});
		expect(forced.stats?.missing).toEqual(["2024-02", "2024-05"]);

		// The override is replaced, not duplicated.
		const restored = await client.documentType.setDocumentOverride({
			documentTypeId: created.id,
			documentId: february,
			included: true,
		});
		expect(restored.stats?.missing).toEqual(["2024-05"]);
	});

	test("404 on an unknown document", async () => {
		const created = await client.documentType.create(monthlyInput());
		await expectOrpcError(
			client.documentType.setDocumentOverride({
				documentTypeId: created.id,
				documentId: "doc_absent",
				included: true,
			}),
			"NOT_FOUND",
		);
	});
});

describe("document.list — documentTypeId filter", () => {
	test("returns only the members of the type", async () => {
		const january = await seedPeriodDocument("2024-01-01");
		const february = await seedPeriodDocument("2024-02-01");
		await seedPeriodDocument("2024-02-01", {
			partyId: null,
			categoryId: null,
			title: "Outside the type",
		});
		const created = await client.documentType.create(monthlyInput());

		const page = await client.document.list({ documentTypeId: created.id });
		expect(page.items.map((item) => item.id).sort()).toEqual(
			[january, february].sort(),
		);
	});

	test("list rows carry the document type of each document", async () => {
		const id = await seedPeriodDocument("2024-01-01");
		const created = await client.documentType.create({
			name: "EDF invoice",
			categoryId,
			color: "#3366ff",
		});
		await client.documentType.apply({
			documentTypeId: created.id,
			documentIds: [id],
		});

		const page = await client.document.list({});
		expect(page.items[0]?.documentType).toEqual({
			id: created.id,
			name: "EDF invoice",
			color: "#3366ff",
		});
	});
});

describe("documentType.suggest", () => {
	test("suggests a regular issuer + category pair", async () => {
		const ids: string[] = [];
		for (const month of ["2024-01-01", "2024-02-01", "2024-03-01"]) {
			ids.push(await seedPeriodDocument(month));
		}

		const suggestions = await client.documentType.suggest({});
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({
			partyId,
			categoryId,
			periodicity: "monthly",
			sampleCount: 3,
			partyName: "EDF",
			partyLogoKey: null,
			categoryName: "Invoice",
			startPeriod: "2024-01-01",
			endPeriod: "2024-03-01",
		});
		expect(suggestions[0]?.documentIds.sort()).toEqual([...ids].sort());
	});

	test("two documents on two periods are enough (threshold 2)", async () => {
		await seedPeriodDocument("2024-01-01");
		expect(await client.documentType.suggest({})).toHaveLength(0);

		await seedPeriodDocument("2024-02-01");
		const suggestions = await client.documentType.suggest({});
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]?.sampleCount).toBe(2);
		expect(suggestions[0]?.periodicity).toBe("monthly");
	});

	test("two documents on the same period are not a recurrence", async () => {
		await seedPeriodDocument("2024-01-01");
		await seedPeriodDocument("2024-01-18", { title: "Second January invoice" });
		expect(await client.documentType.suggest({})).toHaveLength(0);
	});

	test("ignores pairs already covered by a type", async () => {
		await seedPeriodDocument("2024-01-01");
		await seedPeriodDocument("2024-02-01");
		expect(await client.documentType.suggest({})).toHaveLength(1);

		await client.documentType.create(monthlyInput());
		expect(await client.documentType.suggest({})).toHaveLength(0);
	});

	test("infers a quarterly periodicity from the gaps", async () => {
		for (const month of [
			"2024-01-01",
			"2024-04-01",
			"2024-07-01",
			"2024-10-01",
		]) {
			await seedPeriodDocument(month);
		}
		const suggestions = await client.documentType.suggest({});
		expect(suggestions[0]?.periodicity).toBe("quarterly");
		// Bounds are snapped to the quarter, not the raw observed month.
		expect(suggestions[0]?.startPeriod).toBe("2024-01-01");
		expect(suggestions[0]?.endPeriod).toBe("2024-10-01");
	});

	test("infers a yearly periodicity from the gaps", async () => {
		for (const month of ["2022-05-01", "2023-05-01", "2024-05-01"]) {
			await seedPeriodDocument(month);
		}
		const suggestions = await client.documentType.suggest({});
		expect(suggestions[0]?.periodicity).toBe("yearly");
		expect(suggestions[0]?.startPeriod).toBe("2022-01-01");
		expect(suggestions[0]?.endPeriod).toBe("2024-01-01");
	});
});

describe("documentType.createFromSuggestion", () => {
	test("creates an open recurrence named after the Party and the category", async () => {
		await seedPeriodDocument("2024-01-01");
		await seedPeriodDocument("2024-02-01");
		const suggestion = (await client.documentType.suggest({}))[0];
		if (!suggestion) throw new Error("no suggestion");

		const created = await client.documentType.createFromSuggestion({
			partyId: suggestion.partyId,
			categoryId: suggestion.categoryId,
			periodicity: suggestion.periodicity,
			startPeriod: suggestion.startPeriod,
		});

		expect(created.name).toBe("EDF — Invoice");
		expect(created.periodicity).toBe("monthly");
		expect(created.startPeriod).toBe("2024-01-01");
		// Left open on purpose: the point is to spot the next missing period.
		expect(created.endPeriod).toBeNull();
		expect(created.issuerName).toBe("EDF");
		expect(created.issuer).toEqual({ id: partyId, name: "EDF", logoKey: null });
		expect(created.categoryName).toBe("Invoice");
		expect(created.stats?.present).toBe(2);
		expect(created.stats?.lastPeriod).toBe("2024-02");

		// The couple is covered from now on.
		expect(await client.documentType.suggest({})).toHaveLength(0);
	});

	test("honours an explicit name and end bound", async () => {
		const created = await client.documentType.createFromSuggestion({
			partyId,
			categoryId,
			periodicity: "quarterly",
			startPeriod: "2024-01-01",
			endPeriod: "2024-12-31",
			name: "EDF quarterly",
		});
		expect(created.name).toBe("EDF quarterly");
		expect(created.endPeriod).toBe("2024-12-31");
	});

	test("404 on an unknown Party", async () => {
		await expectOrpcError(
			client.documentType.createFromSuggestion({
				partyId: "prt_absent",
				categoryId,
				periodicity: "monthly",
				startPeriod: "2024-01-01",
			}),
			"NOT_FOUND",
		);
	});
});

describe("documentType.createFromDocument", () => {
	test("prefills from the document and applies the type to it", async () => {
		const id = await seedPeriodDocument("2024-01-01");
		await client.document.addTag({ id, tagId });
		await client.document.update({ id, sensitive: true });

		const created = await client.documentType.createFromDocument({
			documentId: id,
		});
		expect(created.name).toBe("EDF — Invoice");
		expect(created.categoryId).toBe(categoryId);
		expect(created.issuerPartyId).toBe(partyId);
		expect(created.tagIds).toEqual([tagId]);
		expect(created.sensitiveDefault).toBe(true);
		expect(created.periodicity).toBeNull();
		expect(created.documentCount).toBe(1);

		const detail = await client.document.get({ id });
		expect(detail.documentType).toMatchObject({
			id: created.id,
			source: "manual",
			membership: "computed",
		});
	});

	test("accepts an explicit name and a recurrence", async () => {
		const id = await seedPeriodDocument("2024-01-01");
		const created = await client.documentType.createFromDocument({
			documentId: id,
			name: "EDF bills",
			recurrence: { periodicity: "monthly", startPeriod: "2024-01-01" },
		});
		expect(created.name).toBe("EDF bills");
		expect(created.periodicity).toBe("monthly");
		expect(created.stats?.present).toBeGreaterThan(0);
	});

	test("404 on an unknown document", async () => {
		await expectOrpcError(
			client.documentType.createFromDocument({ documentId: "doc_absent" }),
			"NOT_FOUND",
		);
	});
});

describe("documentType.apply", () => {
	test("writes the category, the issuer, the tags and the title", async () => {
		const created = await client.documentType.create({
			name: "EDF invoice",
			categoryId,
			issuerPartyId: partyId,
			tagIds: [tagId],
			titleTemplate: "{date:YYYY-MM} - {issuer}",
		});
		const id = await seedPeriodDocument("2024-01-01", {
			partyId: null,
			categoryId: null,
			title: "scan-0001",
		});

		const result = await client.documentType.apply({
			documentTypeId: created.id,
			documentIds: [id],
		});
		expect(result.applied).toBe(1);
		// Every type owns a Default layout: it is applied without any question.
		expect(result.results[0]?.layoutReason).toBe("only");
		expect(result.results[0]?.layoutId).not.toBeNull();

		const detail = await client.document.get({ id });
		expect(detail.category?.id).toBe(categoryId);
		expect(detail.parties.map((item) => item.role)).toEqual(["issuer"]);
		expect(detail.tags.map((item) => item.id)).toEqual([tagId]);
		expect(detail.documentType?.id).toBe(created.id);
		// No file: the title is not the filename-derived one and stays untouched.
		expect(detail.title).toBe("scan-0001");
	});

	test("clears `missingCategory`/`missingIssuer` and releases the document, like `document.setCategory`", async () => {
		const created = await client.documentType.create({
			name: "EDF invoice",
			categoryId,
			issuerPartyId: partyId,
		});
		const id = await seedPeriodDocument("2024-01-01", {
			partyId: null,
			categoryId: null,
		});
		await db
			.update(document)
			.set({
				status: "review",
				reviewReasons: [
					{ code: "missingCategory", message: "…", field: "category" },
					{ code: "missingIssuer", message: "…", field: "issuer" },
				],
			})
			.where(eq(document.id, id));

		await client.documentType.apply({
			documentTypeId: created.id,
			documentIds: [id],
		});

		const detail = await client.document.get({ id });
		expect(detail.reviewReasons).toEqual([]);
		expect(detail.status).toBe("active");
	});

	test("reports the failures document by document", async () => {
		const created = await client.documentType.create({ name: "EDF invoice" });
		const id = await seedPeriodDocument("2024-01-01");

		const result = await client.documentType.apply({
			documentTypeId: created.id,
			documentIds: [id, "doc_absent"],
		});
		expect(result.applied).toBe(1);
		expect(result.results[1]).toMatchObject({
			documentId: "doc_absent",
			applied: false,
		});
		expect(result.results[1]?.error).toContain("doc_absent");
	});

	test("a type whose extraction fills `validUntil` regenerates its expiry reminders", async () => {
		const created = await client.documentType.create({
			name: "ID card",
			categoryId,
		});
		const detail = await client.documentType.get({ id: created.id });
		const layoutId = detail.layouts[0]?.id;
		if (!layoutId) throw new Error("missing default layout");

		await db.insert(extractionRule).values({
			name: "Expiry",
			layoutId,
			target: { kind: "valid_until" },
			strategy: {
				kind: "regex",
				pattern: "Valid until (\\d{4}-\\d{2}-\\d{2})",
				group: 1,
			},
			postprocess: [],
		});

		const id = await seedPeriodDocument("2024-01-01", {
			partyId: null,
			categoryId: null,
			content: "Valid until 2026-12-31",
		});

		await client.documentType.apply({
			documentTypeId: created.id,
			documentIds: [id],
		});

		const applied = await client.document.get({ id });
		expect(applied.validUntil).toBe("2026-12-31");

		const reminders = await client.reminder.list({});
		expect(reminders).toHaveLength(3);
		expect(reminders.every((item) => item.documentId === id)).toBe(true);
	});

	test("refuses a layout that belongs to another type", async () => {
		const first = await client.documentType.create({ name: "First" });
		const second = await client.documentType.create({ name: "Second" });
		const layout = await client.documentType.addLayout({
			documentTypeId: second.id,
			name: "Only",
		});
		const id = await seedPeriodDocument("2024-01-01");

		await expectOrpcError(
			client.documentType.apply({
				documentTypeId: first.id,
				documentIds: [id],
				layoutId: layout.id,
			}),
			"BAD_REQUEST",
		);
	});
});

describe("documentType — layouts", () => {
	test("adds, reorders, tests and removes a layout", async () => {
		const created = await client.documentType.create({
			name: "Payslip",
			categoryId,
		});
		// The type is born with its Default layout.
		const initial = (await client.documentType.get({ id: created.id })).layouts;
		expect(initial).toHaveLength(1);
		expect(initial[0]).toMatchObject({ name: "Default", isDefault: true });

		const first = await client.documentType.addLayout({
			documentTypeId: created.id,
			name: "Before 2024",
			validUntil: "2023-12-31",
		});
		const second = await client.documentType.addLayout({
			documentTypeId: created.id,
			name: "2024",
			validFrom: "2024-01-01",
			signature: { field: "content", cmp: "icontains", value: "nouveau" },
		});
		expect(first.sortOrder).toBe(1);
		expect(second.sortOrder).toBe(2);
		expect(first.isDefault).toBe(false);
		// Back to back, not overlapping: nothing to warn about.
		expect(first.overlaps).toEqual([]);
		expect(second.overlaps).toEqual([]);

		const reordered = await client.documentType.reorderLayouts({
			documentTypeId: created.id,
			ids: [second.id, first.id, initial[0]?.id ?? ""],
		});
		expect(reordered.map((layout) => layout.id)).toEqual([
			second.id,
			first.id,
			initial[0]?.id ?? "",
		]);

		const renamed = await client.documentType.updateLayout({
			id: first.id,
			name: "Legacy",
			signature: null,
		});
		expect(renamed.name).toBe("Legacy");
		expect(renamed.signature).toBeNull();

		await db.insert(extractionRule).values({
			name: "Net pay",
			layoutId: second.id,
			target: { kind: "title" },
			strategy: { kind: "regex", pattern: "Net : (\\d+)", group: 1 },
			postprocess: [],
		});
		const id = await seedPeriodDocument("2024-01-01", {
			content: "Nouveau bulletin. Net : 1234",
		});

		const tested = await client.documentType.testLayout({
			layoutId: second.id,
			documentId: id,
		});
		expect(tested.results).toHaveLength(1);
		expect(tested.results[0]?.value).toBe("1234");
		expect(tested.averageConfidence).toBeGreaterThan(0);
		expect(tested.signatureMatched).toBe(true);

		await client.documentType.removeLayout({ id: first.id });
		expect(
			(await client.documentType.get({ id: created.id })).layouts,
		).toHaveLength(2);
	});

	/**
	 * Overlapping windows are saved as they are — bounds are typed in one at a
	 * time — but the answer names what the new range now collides with.
	 */
	test("reports the layouts whose date range the saved one meets", async () => {
		const created = await client.documentType.create({ name: "Payslip" });
		const before = await client.documentType.addLayout({
			documentTypeId: created.id,
			name: "Before 2024",
			validUntil: "2024-06-30",
		});
		expect(before.overlaps).toEqual([]);

		const after = await client.documentType.addLayout({
			documentTypeId: created.id,
			name: "From 2024",
			validFrom: "2024-01-01",
		});
		expect(after.overlaps).toEqual([
			{
				id: before.id,
				name: "Before 2024",
				from: "2024-01-01",
				until: "2024-06-30",
			},
		]);

		// Moving the bound past the collision clears the warning.
		const moved = await client.documentType.updateLayout({
			id: after.id,
			validFrom: "2024-07-01",
		});
		expect(moved.overlaps).toEqual([]);

		// A layout without any bound never takes part in the date-range race.
		const unbounded = await client.documentType.addLayout({
			documentTypeId: created.id,
			name: "Anytime",
		});
		expect(unbounded.overlaps).toEqual([]);
	});

	/**
	 * The default layout is the fallback of the type. It used to be whichever
	 * layout the type was born with, for good: moving it meant deleting that
	 * one, taking its extraction rules with it.
	 */
	test("moves the Default onto another layout, and reorders it freely", async () => {
		const created = await client.documentType.create({ name: "Payslip" });
		const initial = (await client.documentType.get({ id: created.id })).layouts;
		const original = initial[0]?.id ?? "";
		const extra = await client.documentType.addLayout({
			documentTypeId: created.id,
			name: "2024 redesign",
		});

		const moved = await client.documentType.setDefaultLayout({ id: extra.id });
		expect(
			moved.filter((layout) => layout.isDefault).map((layout) => layout.id),
		).toEqual([extra.id]);

		// Idempotent: promoting the current default changes nothing.
		const again = await client.documentType.setDefaultLayout({ id: extra.id });
		expect(
			again.filter((layout) => layout.isDefault).map((layout) => layout.id),
		).toEqual([extra.id]);

		// And the default takes its turn in the evaluation order like any other.
		const reordered = await client.documentType.reorderLayouts({
			documentTypeId: created.id,
			ids: [extra.id, original],
		});
		expect(reordered.map((layout) => layout.id)).toEqual([extra.id, original]);

		await expectOrpcError(
			client.documentType.setDefaultLayout({ id: "dtl_absent" }),
			"NOT_FOUND",
		);
	});

	test("refuses to remove the only layout of a type", async () => {
		const created = await client.documentType.create({ name: "Payslip" });
		const layouts = (await client.documentType.get({ id: created.id })).layouts;
		const only = layouts[0]?.id ?? "";

		await expectOrpcError(
			client.documentType.removeLayout({ id: only }),
			"BAD_REQUEST",
		);

		// With a second one, the default can go: another layout takes over.
		const extra = await client.documentType.addLayout({
			documentTypeId: created.id,
			name: "2024",
		});
		await client.documentType.removeLayout({ id: only });
		const remaining = (await client.documentType.get({ id: created.id }))
			.layouts;
		expect(remaining).toHaveLength(1);
		expect(remaining[0]).toMatchObject({ id: extra.id, isDefault: true });
	});

	test("deleting a layout deletes its extraction rules", async () => {
		const created = await client.documentType.create({ name: "Payslip" });
		const extra = await client.documentType.addLayout({
			documentTypeId: created.id,
			name: "2024",
		});
		const extraction = await client.extractionRule.create({
			name: "Net pay",
			layoutId: extra.id,
			target: { kind: "title" },
			strategy: { kind: "regex", pattern: "Net : (\\d+)", group: 1 },
		});

		await client.documentType.removeLayout({ id: extra.id });
		await expectOrpcError(
			client.extractionRule.get({ id: extraction.id }),
			"NOT_FOUND",
		);
	});

	test("createLayoutFromDocument seeds a signature from the text", async () => {
		const created = await client.documentType.create({ name: "Payslip" });
		const id = await seedPeriodDocument("2024-01-01", {
			content: "Bulletin de paie mensuel Solutions Informatiques",
		});

		const layout = await client.documentType.createLayoutFromDocument({
			documentTypeId: created.id,
			documentId: id,
			name: "From sample",
		});
		expect(layout.signature).toMatchObject({ op: "and" });

		const tested = await client.documentType.testLayout({
			layoutId: layout.id,
			documentId: id,
		});
		expect(tested.signatureMatched).toBe(true);
	});
});

describe("documentType.detect / preview", () => {
	test("detect lists the matching types without writing", async () => {
		const created = await client.documentType.create({
			name: "EDF invoice",
			categoryId,
			detection: { field: "content", cmp: "icontains", value: "électricité" },
			detectionConfidence: 0.85,
		});
		const id = await seedPeriodDocument("2024-01-01", {
			categoryId: null,
			content: "Facture d'électricité",
		});

		const layouts = (await client.documentType.get({ id: created.id })).layouts;
		const detected = await client.documentType.detect({ documentId: id });
		expect(detected.candidates).toHaveLength(1);
		expect(detected.candidates[0]).toMatchObject({
			documentTypeId: created.id,
			name: "EDF invoice",
			// The type only has its Default layout: it is the one selected.
			layoutId: layouts[0]?.id ?? "",
			layoutReason: "only",
		});
		expect(detected.candidates[0]?.confidence).toBeCloseTo(0.85);

		// Dry run: nothing was written.
		expect((await client.document.get({ id })).category).toBeNull();
	});

	test("preview describes what applying would do", async () => {
		const created = await client.documentType.create({
			name: "EDF invoice",
			categoryId,
			issuerPartyId: partyId,
			tagIds: [tagId],
			sensitiveDefault: true,
			titleTemplate: "{date:YYYY-MM} - {issuer}",
			recurrence: { periodicity: "monthly", startPeriod: "2024-01-01" },
		});
		const id = await seedPeriodDocument("2024-01-01", {
			partyId: null,
			categoryId: null,
			title: "scan-0002",
		});

		const preview = await client.documentType.preview({
			id: created.id,
			documentId: id,
		});
		expect(preview.category?.id).toBe(categoryId);
		expect(preview.parties).toEqual([{ partyId, name: "EDF", role: "issuer" }]);
		expect(preview.tags.map((item) => item.id)).toEqual([tagId]);
		expect(preview.sensitive).toBe(true);
		expect(preview.period).toBe("2024-01");
		expect(preview.layout).toMatchObject({ name: "Default", reason: "only" });

		// Still a dry run.
		expect((await client.document.get({ id })).category).toBeNull();
	});

	test("preview accepts a draft instead of a persisted type", async () => {
		const id = await seedPeriodDocument("2024-01-01");
		const preview = await client.documentType.preview({
			draft: { name: "Draft type", categoryId, tagIds: [] },
			documentId: id,
		});
		expect(preview.documentTypeId).toBeNull();
		expect(preview.name).toBe("Draft type");
		expect(preview.category?.id).toBe(categoryId);
	});
});

describe("document.get — documentType", () => {
	test("reports the computed membership and its period", async () => {
		const january = await seedPeriodDocument("2024-01-01");
		const created = await client.documentType.create(monthlyInput());

		const detail = await client.document.get({ id: january });
		expect(detail.documentType).toEqual({
			id: created.id,
			name: "EDF invoice",
			icon: null,
			color: null,
			source: "manual",
			confidence: null,
			layout: null,
			period: "2024-01",
			membership: "computed",
		});
	});

	test("reports `forced` and `excluded`, and `null` removes the override", async () => {
		const january = await seedPeriodDocument("2024-01-01");
		const intruder = await seedPeriodDocument("2024-03-01", {
			partyId: null,
			categoryId: null,
			title: "March paper invoice",
		});
		const created = await client.documentType.create(monthlyInput());

		// A document outside the criteria carries no type at all.
		expect(
			(await client.document.get({ id: intruder })).documentType,
		).toBeNull();

		await client.documentType.setDocumentOverride({
			documentTypeId: created.id,
			documentId: intruder,
			included: true,
		});
		expect(
			(await client.document.get({ id: intruder })).documentType,
		).toMatchObject({
			id: created.id,
			membership: "forced",
			period: "2024-03",
		});

		await client.documentType.setDocumentOverride({
			documentTypeId: created.id,
			documentId: january,
			included: false,
		});
		expect(
			(await client.document.get({ id: january })).documentType,
		).toBeNull();

		// `null` drops the override: back to the computed membership.
		await client.documentType.setDocumentOverride({
			documentTypeId: created.id,
			documentId: january,
			included: null,
		});
		expect(
			(await client.document.get({ id: january })).documentType,
		).toMatchObject({ id: created.id, membership: "computed" });
	});

	test("a document outside the bounds is not a member", async () => {
		const outside = await seedPeriodDocument("2023-11-01");
		await client.documentType.create(monthlyInput());
		expect(
			(await client.document.get({ id: outside })).documentType,
		).toBeNull();
	});

	test("an explicit assignment carries its source, confidence and layout", async () => {
		const created = await client.documentType.create({
			name: "EDF invoice",
			categoryId,
		});
		const layout = await client.documentType.addLayout({
			documentTypeId: created.id,
			name: "Only",
		});
		const id = await seedPeriodDocument("2024-01-01");
		await client.documentType.apply({
			documentTypeId: created.id,
			documentIds: [id],
			layoutId: layout.id,
		});

		const detail = await client.document.get({ id });
		expect(detail.documentType).toMatchObject({
			id: created.id,
			source: "manual",
			confidence: null,
			layout: { id: layout.id, name: "Only" },
		});
	});
});

describe("document.bulk — setDocumentType", () => {
	test("applies then clears the type over a selection", async () => {
		const first = await seedPeriodDocument("2024-01-01");
		const second = await seedPeriodDocument("2024-02-01");
		// No issuer and no category: members are exactly the documents assigned.
		const created = await client.documentType.create({
			name: "EDF invoice",
			tagIds: [tagId],
		});

		const applied = await client.document.bulk({
			ids: [first, second],
			action: { type: "setDocumentType", documentTypeId: created.id },
		});
		expect(applied.updated).toBe(2);
		expect((await client.document.get({ id: first })).tags).toHaveLength(1);
		expect(
			(await client.document.list({ documentTypeId: created.id })).items,
		).toHaveLength(2);

		const cleared = await client.document.bulk({
			ids: [first, second],
			action: { type: "setDocumentType", documentTypeId: null },
		});
		expect(cleared.updated).toBe(2);
		// The type is gone; the tags it added are left alone.
		expect(
			(await client.document.list({ documentTypeId: created.id })).items,
		).toHaveLength(0);
		expect((await client.document.get({ id: first })).tags).toHaveLength(1);
	});
});

describe("documentType.update / toggle / reorder / delete", () => {
	test("updates then deletes", async () => {
		const created = await client.documentType.create(monthlyInput());

		const updated = await client.documentType.update({
			id: created.id,
			name: "EDF invoice (renamed)",
			recurrence: {
				periodicity: "monthly",
				startPeriod: "2024-01-01",
				endPeriod: "2024-06-30",
				graceDays: 20,
			},
		});
		expect(updated.name).toBe("EDF invoice (renamed)");
		expect(updated.graceDays).toBe(20);

		const toggled = await client.documentType.toggle({
			id: created.id,
			enabled: false,
		});
		expect(toggled.enabled).toBe(false);

		await client.documentType.delete({ id: created.id });
		await expectOrpcError(
			client.documentType.get({ id: created.id }),
			"NOT_FOUND",
		);
	});

	test("dropping the recurrence clears every period column", async () => {
		const created = await client.documentType.create(monthlyInput());
		const updated = await client.documentType.update({
			id: created.id,
			recurrence: null,
		});
		expect(updated.periodicity).toBeNull();
		expect(updated.startPeriod).toBeNull();
		expect(updated.graceDays).toBeNull();
	});

	test("changing the periodicity realigns the period start", async () => {
		const created = await client.documentType.create({
			...monthlyInput(),
			recurrence: { periodicity: "monthly", startPeriod: "2024-02-01" },
		});
		const updated = await client.documentType.update({
			id: created.id,
			recurrence: { periodicity: "yearly", startPeriod: "2024-02-01" },
		});
		expect(updated.startPeriod).toBe("2024-01-01");
	});

	test("reorder rewrites the detection priorities", async () => {
		const first = await client.documentType.create({ name: "First" });
		const second = await client.documentType.create({ name: "Second" });

		await client.documentType.reorder({ ids: [second.id, first.id] });
		const listed = await client.documentType.list({});
		expect(listed.map((item) => item.id)).toEqual([second.id, first.id]);
		expect(listed.map((item) => item.priority)).toEqual([0, 1]);
	});

	test("refuses to delete a type still carried by documents", async () => {
		const created = await client.documentType.create({ name: "EDF invoice" });
		const id = await seedPeriodDocument("2024-01-01");
		await client.documentType.apply({
			documentTypeId: created.id,
			documentIds: [id],
		});

		await expectOrpcError(
			client.documentType.delete({ id: created.id, detachDocuments: false }),
			"BAD_REQUEST",
		);

		const deleted = await client.documentType.delete({
			id: created.id,
			detachDocuments: true,
		});
		expect(deleted.detached).toBe(1);
		expect((await client.document.get({ id })).documentType).toBeNull();
	});
});

describe("documentType — disabled types", () => {
	test("apply refuses a disabled type unless forced", async () => {
		const type = await client.documentType.create({
			name: "Retired",
			categoryId,
			enabled: false,
		});
		const documentId = await seedPeriodDocument("2024-01-01");

		const error = await expectOrpcError(
			client.documentType.apply({
				documentTypeId: type.id,
				documentIds: [documentId],
			}),
			"BAD_REQUEST",
		);
		expect(error.message).toContain("disabled");

		const forced = await client.documentType.apply({
			documentTypeId: type.id,
			documentIds: [documentId],
			force: true,
		});
		expect(forced.applied).toBe(1);
	});

	test("detection ignores a disabled type", async () => {
		const detection = {
			field: "content" as const,
			cmp: "icontains" as const,
			value: "kilowatt",
		};
		const enabled = await client.documentType.create({
			name: "Electricity",
			detection,
		});
		const disabled = await client.documentType.create({
			name: "Electricity (old)",
			detection,
			enabled: false,
		});

		const documentId = await seedPeriodDocument("2024-01-01", {
			content: "Consumption in kilowatt hours",
		});
		const { candidates } = await client.documentType.detect({ documentId });
		expect(candidates.map((item) => item.documentTypeId)).toEqual([enabled.id]);
		expect(candidates.map((item) => item.documentTypeId)).not.toContain(
			disabled.id,
		);
	});

	test("list({ includeDisabled: false }) really filters", async () => {
		await client.documentType.create({ name: "Live" });
		await client.documentType.create({ name: "Retired", enabled: false });

		expect(
			(await client.documentType.list({ includeDisabled: false })).map(
				(item) => item.name,
			),
		).toEqual(["Live"]);
		expect(
			(await client.documentType.list({ includeDisabled: true })).map(
				(item) => item.name,
			),
		).toEqual(["Live", "Retired"]);
	});
});

describe("documentType — documentCount", () => {
	test("counts forced members and drops the excluded and the trashed", async () => {
		const type = await client.documentType.create({ name: "Invoice" });
		const carried = await seedPeriodDocument("2024-01-01");
		const forced = await seedPeriodDocument("2024-02-01");
		const excluded = await seedPeriodDocument("2024-03-01");
		const trashed = await seedPeriodDocument("2024-04-01");

		await client.documentType.apply({
			documentTypeId: type.id,
			documentIds: [carried, excluded, trashed],
		});
		expect((await client.documentType.get({ id: type.id })).documentCount).toBe(
			3,
		);

		await client.documentType.setDocumentOverride({
			documentTypeId: type.id,
			documentId: forced,
			included: true,
		});
		await client.documentType.setDocumentOverride({
			documentTypeId: type.id,
			documentId: excluded,
			included: false,
		});
		await client.document.trash({ id: trashed });

		// carried + forced; excluded and trashed are out.
		expect((await client.documentType.get({ id: type.id })).documentCount).toBe(
			2,
		);
		expect((await client.documentType.list({}))[0]?.documentCount).toBe(2);
	});
});

describe("documentType.get — outOfRange", () => {
	test("lists the members whose period precedes `startPeriod`", async () => {
		const type = await client.documentType.create(monthlyInput());
		const inside = await seedPeriodDocument("2024-02-01");
		const before = await seedPeriodDocument("2023-11-01", {
			title: "Invoice 2023-11",
		});

		const detail = await client.documentType.get({ id: type.id });
		expect(detail.outOfRange).toEqual([
			{
				documentId: before,
				title: "Invoice 2023-11",
				period: "2023-11",
				periodStart: "2023-11-01",
			},
		]);
		expect(detail.timeline.some((entry) => entry.documentId === inside)).toBe(
			true,
		);
		expect(detail.timeline.some((entry) => entry.documentId === before)).toBe(
			false,
		);
	});

	test("is empty for a non-recurring type", async () => {
		const type = await client.documentType.create({ name: "Plain" });
		expect((await client.documentType.get({ id: type.id })).outOfRange).toEqual(
			[],
		);
	});
});
