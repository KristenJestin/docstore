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
	documentTypeTimeline,
	effectiveRecurrenceRange,
	getDocumentType,
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
