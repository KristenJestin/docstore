import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
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
	effectiveRecurrenceRange,
	updateDocumentType,
} from "./document-type.service";
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
