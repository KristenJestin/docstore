import { describe, expect, test } from "bun:test";
import { exportDocumentsInput, exportFiltersSchema } from "./export";
import {
	createSavedSearchInput,
	savedSearchSchema,
	updateSavedSearchInput,
} from "./saved-search";

/**
 * Issue #14: `updatedSince` and `afterId` are a position in the change feed of
 * `document.list`, not filters. Saved searches and exports refuse them.
 */

const CURSORS = [
	{ updatedSince: "2026-09-29T10:00:00.000Z" },
	{ afterId: "doc_x" },
];

describe("saved searches refuse the sync cursor", () => {
	test.each(CURSORS)("create refuses %o", (cursor) => {
		const result = createSavedSearchInput.safeParse({
			name: "Sync",
			filters: { query: "invoice", ...cursor },
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain("sync cursor");
	});

	test.each(CURSORS)("update refuses %o", (cursor) => {
		expect(
			updateSavedSearchInput.safeParse({
				id: "sav_x",
				filters: { query: "invoice", ...cursor },
			}).success,
		).toBe(false);
	});

	test("filters without a cursor are still accepted", () => {
		expect(
			createSavedSearchInput.safeParse({
				name: "Invoices",
				filters: { query: "invoice", sort: "updatedAt:asc" },
			}).success,
		).toBe(true);
	});

	test("a search stored with a cursor before #14 reads back without it", () => {
		const read = savedSearchSchema.parse({
			id: "sav_x",
			name: "Old",
			filters: { query: "invoice", updatedSince: "2026-09-29T10:00:00.000Z" },
			sortOrder: 0,
			createdAt: new Date(),
		});
		expect(read.filters).not.toHaveProperty("updatedSince");
		expect(read.filters.query).toBe("invoice");
	});
});

describe("exports refuse the sync cursor", () => {
	test.each(CURSORS)("export filters refuse %o", (cursor) => {
		const result = exportFiltersSchema.safeParse({ ...cursor });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain("sync cursor");
		expect(
			exportDocumentsInput.safeParse({ filters: { ...cursor } }).success,
		).toBe(false);
	});

	test("filters without a cursor are still accepted", () => {
		expect(exportFiltersSchema.safeParse({ query: "invoice" }).success).toBe(
			true,
		);
	});
});
