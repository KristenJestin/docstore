import { describe, expect, test } from "bun:test";
import {
	activityVerb,
	describeActivitySummary,
	listActivityInput,
} from "./activity";

describe("describeActivitySummary: the Activity page says what changed", () => {
	test("tags added and removed read +name −name", () => {
		expect(
			describeActivitySummary({
				action: "document.tagged",
				summary: {
					added: [{ id: "tag_1", name: "energy" }],
					removed: [{ id: "tag_2", name: "home" }],
				},
			}),
		).toBe("+energy · −home");
	});

	test("external references read system · +ref · −ref · ~ref", () => {
		expect(
			describeActivitySummary({
				action: "document.external_refs_set",
				summary: {
					system: "wiki",
					added: [{ name: "10-admin/12-logement/contrat-edf.md" }],
					removed: [{ name: "old.md" }],
					updated: [{ name: "kept.md" }],
				},
			}),
		).toBe("wiki · +10-admin/12-logement/contrat-edf.md · −old.md · ~kept.md");
	});

	test("fields read before → after, and notes only say they changed", () => {
		expect(
			describeActivitySummary({
				action: "document.updated",
				summary: {
					fields: {
						title: { before: "Scan 0042", after: "Bank statement" },
						validUntil: { before: null, after: "2027-01-01" },
						notes: { changed: true },
					},
				},
			}),
		).toBe(
			"title: Scan 0042 → Bank statement · validUntil: none → 2027-01-01 · notes changed",
		);
	});

	test("a search shows its query and filters, never results", () => {
		expect(
			describeActivitySummary({
				action: "search.performed",
				summary: {
					query: "électricité",
					year: 2026,
					page: 1,
					sort: "documentDate:desc",
					deleted: "exclude",
					total: 3,
				},
			}),
		).toBe('"électricité" · year 2026 · 3 results');
	});

	test("a change caused by a merge names its cause", () => {
		expect(
			describeActivitySummary({
				action: "document.updated",
				summary: { via: "party.merged" },
			}),
		).toBe("via party.merged");
	});

	test("a custom field value reads its value, not its kind", () => {
		expect(
			describeActivitySummary({
				action: "document.field_set",
				summary: {
					field: { id: "cfd_1", name: "Amount" },
					value: {
						before: { kind: "money", amount: 12 },
						after: { kind: "money", amount: 15 },
					},
				},
			}),
		).toBe("Amount: 12 → 15");
	});
});

describe("listActivityInput", () => {
	test("defaults to the first page of fifty entries", () => {
		expect(listActivityInput.parse({})).toMatchObject({
			page: 1,
			pageSize: 50,
		});
	});

	test("refuses a since that is not an ISO instant", () => {
		expect(listActivityInput.safeParse({ since: "yesterday" }).success).toBe(
			false,
		);
	});
});

test("activityVerb drops the object and the underscores", () => {
	expect(activityVerb("document.party_linked")).toBe("party linked");
});
