import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { user as userTable } from "@docstore/db/schema/auth";
import { category } from "@docstore/db/schema/category";
import { document, documentParty } from "@docstore/db/schema/document";
import { party } from "@docstore/db/schema/party";
import { reminder } from "@docstore/db/schema/reminder";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import {
	createDocumentTypeInput,
	updateDocumentTypeInput,
} from "@docstore/shared/document-type";

import type { DocumentTypeMember } from "./document-type.service";
import {
	createDocumentType,
	documentTypeForDocument,
	documentTypeTimeline,
	effectiveRecurrenceRange,
	getDocumentType,
	previewDocumentTypeTitles,
	requireDocumentType,
	updateDocumentType,
} from "./document-type.service";
import { generateReminders } from "./reminder.service";
import { createTag } from "./tag.service";

/**
 * Effective range of a recurrence (`docs/document-types.md` §2). Both bounds
 * are optional: what is missing is read from the member documents, which is
 * what keeps a timeline from painting red cells back to 1970.
 */

const TODAY = "2026-09-08";

function members(...anchors: string[]): DocumentTypeMember[] {
	return anchors.map((anchor, index) => ({
		documentId: `doc_${index}`,
		title: `Document ${anchor}`,
		anchor,
		arrival: anchor,
	}));
}

describe("effectiveRecurrenceRange", () => {
	test("a type without periodicity has no range", () => {
		expect(
			effectiveRecurrenceRange(
				{ periodicity: null, startPeriod: null, endPeriod: null },
				members("2024-03-12"),
				TODAY,
			),
		).toBeNull();
	});

	test("both bounds explicit: the range is exactly what was typed in", () => {
		expect(
			effectiveRecurrenceRange(
				{
					periodicity: "monthly",
					startPeriod: "2024-01-01",
					endPeriod: "2024-06-01",
				},
				members("2024-02-11", "2023-08-04"),
				TODAY,
			),
		).toEqual({
			start: "2024-01-01",
			end: "2024-06-01",
			derived: false,
			open: false,
		});
	});

	test("an explicit start with no end runs to the current period", () => {
		expect(
			effectiveRecurrenceRange(
				{ periodicity: "monthly", startPeriod: "2024-01-01", endPeriod: null },
				[],
				TODAY,
			),
		).toEqual({
			start: "2024-01-01",
			end: "2026-09-01",
			derived: false,
			open: true,
		});
	});

	test("without a first period the range starts at the oldest member", () => {
		expect(
			effectiveRecurrenceRange(
				{ periodicity: "monthly", startPeriod: null, endPeriod: null },
				members("2024-05-17", "2024-03-02", "2025-11-30"),
				TODAY,
			),
		).toEqual({
			start: "2024-03-01",
			end: "2026-09-01",
			derived: true,
			open: true,
		});
	});

	test("without a first period and without a member there is no range", () => {
		expect(
			effectiveRecurrenceRange(
				{ periodicity: "monthly", startPeriod: null, endPeriod: null },
				[],
				TODAY,
			),
		).toBeNull();
	});

	test("a derived start still stops at an explicit last period", () => {
		expect(
			effectiveRecurrenceRange(
				{
					periodicity: "quarterly",
					startPeriod: null,
					endPeriod: "2024-12-31",
				},
				members("2024-02-15", "2024-08-01"),
				TODAY,
			),
		).toEqual({
			start: "2024-01-01",
			end: "2024-10-01",
			derived: true,
			open: false,
		});
	});

	test("an open recurrence stretches to a member filed ahead of today", () => {
		expect(
			effectiveRecurrenceRange(
				{ periodicity: "yearly", startPeriod: null, endPeriod: null },
				members("2024-06-01", "2027-02-01"),
				TODAY,
			),
		).toEqual({
			start: "2024-01-01",
			end: "2027-01-01",
			derived: true,
			open: true,
		});
	});

	test("the derived bounds are snapped to their own period", () => {
		// 2024-03-14 is a Thursday: the week starts on the Monday.
		expect(
			effectiveRecurrenceRange(
				{ periodicity: "weekly", startPeriod: null, endPeriod: null },
				members("2024-03-14"),
				"2024-03-20",
			),
		).toEqual({
			start: "2024-03-11",
			end: "2024-03-18",
			derived: true,
			open: true,
		});
	});
});

/**
 * Renaming a type is a patch, not a rewrite (`docs/document-types.md` §1).
 *
 * The update input used to be derived from the create one with `.partial()`,
 * which keeps the defaults: a form sending nothing but the new name also sent
 * `tagIds: []` and `sensitiveDefault: false`, and the type came back stripped.
 */
describe("updateDocumentType — a patch leaves the rest alone", () => {
	let db: TestDb;

	beforeAll(async () => {
		db = await createTestDb();
	});

	afterAll(async () => {
		await db.$client.end();
	});

	beforeEach(async () => {
		await truncateAll(db);
	});

	async function seedType() {
		const urgent = await createTag(db, { name: "urgent" });
		const created = await createDocumentType(
			db,
			createDocumentTypeInput.parse({
				name: "EDF bill",
				tagIds: [urgent.id],
				sensitiveDefault: true,
				paperOriginal: true,
				detection: {
					op: "and",
					children: [{ field: "content", cmp: "contains", value: "EDF" }],
				},
				detectionConfidence: 0.75,
				enabled: false,
				priority: 42,
			}),
		);
		return { created, tagId: urgent.id };
	}

	test("renaming keeps the tags, the sensitivity and the detection", async () => {
		const { created, tagId } = await seedType();
		expect(created.tagIds).toEqual([tagId]);

		// Exactly what the rename form sends, parsed by the real schema.
		const updated = await updateDocumentType(
			db,
			updateDocumentTypeInput.parse({
				id: created.id,
				name: "EDF electricity bill",
			}),
		);

		expect(updated.name).toBe("EDF electricity bill");
		expect(updated.tagIds).toEqual([tagId]);
		expect(updated.sensitiveDefault).toBe(true);
		expect(updated.paperOriginal).toBe(true);
		expect(updated.detection).toEqual(created.detection);
		expect(updated.detectionConfidence).toBe(0.75);
		expect(updated.enabled).toBe(false);
		expect(updated.priority).toBe(42);
	});

	test("a field explicitly sent is still written", async () => {
		const { created } = await seedType();
		const updated = await updateDocumentType(
			db,
			updateDocumentTypeInput.parse({
				id: created.id,
				tagIds: [],
				sensitiveDefault: false,
			}),
		);
		expect(updated.tagIds).toEqual([]);
		expect(updated.sensitiveDefault).toBe(false);
		expect(updated.name).toBe("EDF bill");
	});
});

/**
 * Issue #32: a yearly type used to expect its period in December, whatever
 * the month its documents actually arrive in. D32-01: the type carries an
 * expected month; D32-02: without one, the month is learned from its
 * documents; without either, the last month of the period stays the default.
 */
describe("yearly recurrence — expected month", () => {
	let db: TestDb;
	let userId: string;
	let issuerId: string;
	let categoryId: string;

	beforeAll(async () => {
		db = await createTestDb();
	});

	afterAll(async () => {
		await db.$client.end();
	});

	beforeEach(async () => {
		await truncateAll(db);
		const [user] = await db
			.insert(userTable)
			.values({ id: "usr_32", name: "Kris", email: "kris-32@test.local" })
			.returning({ id: userTable.id });
		const [issuer] = await db
			.insert(party)
			.values({ type: "company", name: "Tax office" })
			.returning({ id: party.id });
		const [notice] = await db
			.insert(category)
			.values({ name: "Tax notice", slug: "tax-notice" })
			.returning({ id: category.id });
		if (!user || !issuer || !notice) throw new Error("seed failed");
		userId = user.id;
		issuerId = issuer.id;
		categoryId = notice.id;
	});

	async function seedNotice(documentDate: string) {
		const [row] = await db
			.insert(document)
			.values({
				title: `Tax notice ${documentDate}`,
				status: "active",
				createdById: userId,
				categoryId,
				documentDate,
			})
			.returning({ id: document.id });
		if (!row) throw new Error("document not inserted");
		await db
			.insert(documentParty)
			.values({ documentId: row.id, partyId: issuerId, role: "issuer" });
	}

	async function seedType(recurrence: Record<string, unknown>) {
		const created = await createDocumentType(
			db,
			createDocumentTypeInput.parse({
				name: "Tax notice",
				issuerPartyId: issuerId,
				categoryId,
				recurrence: { periodicity: "yearly", graceDays: 15, ...recurrence },
			}),
		);
		return requireDocumentType(db, created.id);
	}

	test("a yearly type expected on 15 July is pending until 15 July + grace, then missing", async () => {
		const row = await seedType({
			startPeriod: "2026-01-01",
			expectedMonth: 7,
			expectedDay: 15,
		});
		expect(row.expectedMonth).toBe(7);

		const before = await documentTypeTimeline(db, row, "2026-07-30");
		expect(before).toEqual([
			expect.objectContaining({
				period: "2026",
				status: "pending",
				dueDate: "2026-07-30",
			}),
		]);

		const after = await documentTypeTimeline(db, row, "2026-07-31");
		expect(after).toEqual([
			expect.objectContaining({ period: "2026", status: "missing" }),
		]);
	});

	test("its period_gap reminder fires after 15 July + grace, not in December", async () => {
		await seedType({
			startPeriod: "2026-01-01",
			expectedMonth: 7,
			expectedDay: 15,
		});

		const early = await generateReminders(db, { today: "2026-07-30" });
		expect(early.created).toBe(0);

		const late = await generateReminders(db, { today: "2026-09-29" });
		expect(late.created).toBe(1);
		const [gap] = await db.select().from(reminder);
		expect(gap).toMatchObject({
			kind: "period_gap",
			period: "2026-01-01",
			dueDate: "2026-07-30",
		});
	});

	test("without an expected month, the month is learned from the documents", async () => {
		await seedNotice("2024-07-10");
		await seedNotice("2025-07-12");
		const row = await seedType({ expectedDay: 15 });

		const before = await documentTypeTimeline(db, row, "2026-07-20");
		expect(before.at(-1)).toMatchObject({
			period: "2026",
			status: "pending",
			dueDate: "2026-07-30",
		});

		const after = await documentTypeTimeline(db, row, "2026-09-29");
		expect(after.at(-1)).toMatchObject({ period: "2026", status: "missing" });

		const detail = await getDocumentType(db, row.id);
		expect(detail.expectedMonth).toBeNull();
		expect(detail.learnedExpectedMonth).toBe(7);
	});

	test("an expected month typed in wins over the documents", async () => {
		await seedNotice("2024-07-10");
		const row = await seedType({ expectedMonth: 3, expectedDay: 1 });

		const timeline = await documentTypeTimeline(db, row, "2026-09-29");
		expect(timeline.at(-1)?.dueDate).toBe("2026-03-16");
		expect((await getDocumentType(db, row.id)).learnedExpectedMonth).toBeNull();
	});

	test("with neither a month nor a document, the last month of the period is kept", async () => {
		const row = await seedType({ startPeriod: "2026-01-01", expectedDay: 15 });

		const timeline = await documentTypeTimeline(db, row, "2026-09-29");
		expect(timeline.at(-1)).toMatchObject({
			status: "pending",
			dueDate: "2026-12-30",
		});
	});

	test("an expected month is dropped on a monthly type and bounded on a quarterly one", async () => {
		const monthly = await seedType({
			periodicity: "monthly",
			expectedMonth: 7,
		});
		expect(monthly.expectedMonth).toBeNull();

		expect(() =>
			createDocumentTypeInput.parse({
				name: "Quarterly",
				recurrence: { periodicity: "quarterly", expectedMonth: 4 },
			}),
		).toThrow("between 1 and 3");
	});
});

/**
 * Issue #39: the income tax notice for income year 2025 arrives in July 2026.
 * D39-01: the type says its documents arrive `arrivesAfter` periods after the
 * period they cover; D39-02: a document without a period is filed that many
 * periods before its date; D39-03: the due date and the learned month move by
 * the same number of periods, and the timeline, stats and reminders follow.
 */
describe("income tax notice arriving the following year (#39)", () => {
	let db: TestDb;
	let userId: string;
	let issuerId: string;
	let categoryId: string;

	beforeAll(async () => {
		db = await createTestDb();
	});

	afterAll(async () => {
		await db.$client.end();
	});

	beforeEach(async () => {
		await truncateAll(db);
		const [user] = await db
			.insert(userTable)
			.values({ id: "usr_39", name: "Kris", email: "kris-39@test.local" })
			.returning({ id: userTable.id });
		const [issuer] = await db
			.insert(party)
			.values({ type: "company", name: "DGFiP" })
			.returning({ id: party.id });
		const [notice] = await db
			.insert(category)
			.values({ name: "Tax notice", slug: "tax-notice" })
			.returning({ id: category.id });
		if (!user || !issuer || !notice) throw new Error("seed failed");
		userId = user.id;
		issuerId = issuer.id;
		categoryId = notice.id;
	});

	async function seedNotice(documentDate: string, periodStart?: string) {
		const [row] = await db
			.insert(document)
			.values({
				title: `Notice ${documentDate}`,
				status: "active",
				createdById: userId,
				categoryId,
				documentDate,
				periodStart: periodStart ?? null,
			})
			.returning({ id: document.id });
		if (!row) throw new Error("document not inserted");
		await db
			.insert(documentParty)
			.values({ documentId: row.id, partyId: issuerId, role: "issuer" });
		return row.id;
	}

	async function seedType(recurrence: Record<string, unknown> = {}) {
		const created = await createDocumentType(
			db,
			createDocumentTypeInput.parse({
				name: "Avis d'impôt sur le revenu",
				issuerPartyId: issuerId,
				categoryId,
				titleTemplate: "{type} {period}",
				recurrence: {
					periodicity: "yearly",
					graceDays: 15,
					arrivesAfter: 1,
					...recurrence,
				},
			}),
		);
		return requireDocumentType(db, created.id);
	}

	test("the expected month is learned as July from documents dated 2024-07-08 and 2025-07-08", async () => {
		await seedNotice("2024-07-08");
		await seedNotice("2025-07-08");
		const row = await seedType();
		expect(row.arrivesAfter).toBe(1);

		const detail = await getDocumentType(db, row.id);
		expect(detail.arrivesAfter).toBe(1);
		expect(detail.expectedMonth).toBeNull();
		expect(detail.learnedExpectedMonth).toBe(7);
		expect(detail.range).toMatchObject({ start: "2023-01-01" });
		const timeline = await documentTypeTimeline(db, row, "2026-07-01");
		expect(timeline.map((entry) => [entry.period, entry.status])).toEqual([
			["2023", "present"],
			["2024", "present"],
			["2025", "pending"],
			["2026", "pending"],
		]);
	});

	test("period 2025 is due in July 2026 plus grace, pending before and missing after", async () => {
		await seedNotice("2024-07-08");
		await seedNotice("2025-07-08");
		const row = await seedType();

		const before = await documentTypeTimeline(db, row, "2026-08-15");
		expect(before.find((entry) => entry.period === "2025")).toMatchObject({
			status: "pending",
			// Last day of July 2026, plus 15 grace days.
			dueDate: "2026-08-15",
		});

		const after = await documentTypeTimeline(db, row, "2026-08-16");
		expect(after.find((entry) => entry.period === "2025")).toMatchObject({
			status: "missing",
		});
		// 2026 is only expected in July 2027.
		expect(after.at(-1)).toMatchObject({
			period: "2026",
			status: "pending",
			dueDate: "2027-08-15",
		});
		expect((await getDocumentType(db, row.id)).stats).toMatchObject({
			present: 2,
		});
	});

	test("a period_gap reminder fires for 2025 once July 2026 and its grace have passed", async () => {
		await seedNotice("2024-07-08");
		await seedNotice("2025-07-08");
		await seedType();

		const early = await generateReminders(db, { today: "2026-08-15" });
		expect(early.created).toBe(0);

		const late = await generateReminders(db, { today: "2026-08-16" });
		expect(late.created).toBe(1);
		const [gap] = await db.select().from(reminder);
		expect(gap).toMatchObject({
			kind: "period_gap",
			period: "2025-01-01",
			dueDate: "2026-08-15",
		});
	});

	test("the 2025 notice received in July 2026 fills period 2025", async () => {
		await seedNotice("2024-07-08");
		await seedNotice("2025-07-08");
		const received = await seedNotice("2026-07-08");
		const row = await seedType();

		const timeline = await documentTypeTimeline(db, row, "2026-09-29");
		expect(timeline.find((entry) => entry.period === "2025")).toMatchObject({
			status: "present",
			documentId: received,
		});
		expect((await documentTypeForDocument(db, received))?.period).toBe("2025");
		const titles = await previewDocumentTypeTitles(db, {
			id: row.id,
			limit: 1,
		});
		expect(titles[0]).toMatchObject({
			documentId: received,
			title: "Avis d'impôt sur le revenu 2025",
		});
	});

	test("a document carrying its own period keeps it", async () => {
		await seedNotice("2024-07-08", "2023-01-01");
		await seedNotice("2025-07-08", "2024-01-01");
		const row = await seedType();

		expect((await getDocumentType(db, row.id)).learnedExpectedMonth).toBe(7);
		const timeline = await documentTypeTimeline(db, row, "2026-08-16");
		expect(timeline.map((entry) => [entry.period, entry.status])).toEqual([
			["2023", "present"],
			["2024", "present"],
			["2025", "missing"],
			["2026", "pending"],
		]);
	});

	test("arrivesAfter defaults to 0 and is bounded", async () => {
		await seedNotice("2025-07-08");
		const row = await seedType({ arrivesAfter: undefined });
		expect(row.arrivesAfter).toBe(0);
		// Without the offset, the same document covers its own year.
		const timeline = await documentTypeTimeline(db, row, "2026-09-29");
		expect(timeline[0]).toMatchObject({ period: "2025", status: "present" });

		expect(() =>
			createDocumentTypeInput.parse({
				name: "Too late",
				recurrence: { periodicity: "yearly", arrivesAfter: 4 },
			}),
		).toThrow();

		const updated = await updateDocumentType(
			db,
			updateDocumentTypeInput.parse({
				id: row.id,
				recurrence: { periodicity: "yearly", arrivesAfter: 1 },
			}),
		);
		expect(updated.arrivesAfter).toBe(1);
		const oneOff = await createDocumentType(
			db,
			createDocumentTypeInput.parse({ name: "One-off" }),
		);
		expect(oneOff.arrivesAfter).toBe(0);
	});
});
