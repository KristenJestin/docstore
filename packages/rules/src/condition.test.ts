import { describe, expect, test } from "bun:test";
import type { RuleCondition } from "@docstore/shared/rule";
import type { RuleSubject } from "./condition";
import { evaluateCondition, fieldValues } from "./condition";

function subject(overrides: Partial<RuleSubject> = {}): RuleSubject {
	return {
		content: "Bulletin de paie de décembre 2025 — Nordwind Digital",
		filename: "bulletin-2025-12.pdf",
		mime: "application/pdf",
		pageCount: 3,
		source: "upload",
		detectedIdentifiers: [
			{ kind: "siren", value: "552100554" },
			{ kind: "email", value: "compta@nordwind.example" },
		],
		parties: [
			{ partyId: "prt_1", role: "issuer", name: "Nordwind Digital" },
			{ partyId: "prt_2", role: "subject", name: "Camille Moreau" },
		],
		categoryId: "cat_1",
		categorySlugPath: ["payslip"],
		tags: ["tag_paie"],
		documentDate: "2025-12-05",
		title: "Bulletin décembre",
		...overrides,
	};
}

function matches(condition: RuleCondition, over: Partial<RuleSubject> = {}) {
	return evaluateCondition(condition, subject(over)).matched;
}

describe("fieldValues", () => {
	test("the category is comparable by id and by slug", () => {
		expect(fieldValues("category", subject())).toEqual(["cat_1", "payslip"]);
	});

	test("detected identifiers are filtered by kind", () => {
		expect(fieldValues("detected_identifiers.siren", subject())).toEqual([
			"552100554",
		]);
		expect(fieldValues("detected_identifiers.iban", subject())).toEqual([]);
	});

	test("a missing field returns an empty list", () => {
		expect(fieldValues("page_count", subject({ pageCount: null }))).toEqual([]);
		expect(fieldValues("mail.from", subject())).toEqual([]);
	});

	test("party.name lists every linked Party", () => {
		expect(fieldValues("party.name", subject())).toEqual([
			"Nordwind Digital",
			"Camille Moreau",
		]);
	});
});

describe("comparators", () => {
	test("eq compares exactly", () => {
		expect(
			matches({ field: "mime", cmp: "eq", value: "application/pdf" }),
		).toBe(true);
		expect(
			matches({ field: "mime", cmp: "eq", value: "application/PDF" }),
		).toBe(false);
	});

	test("eq compares numerically when possible", () => {
		expect(matches({ field: "page_count", cmp: "eq", value: 3 })).toBe(true);
		expect(matches({ field: "page_count", cmp: "eq", value: "3" })).toBe(true);
	});

	test("neq requires that no value matches", () => {
		expect(matches({ field: "party.name", cmp: "neq", value: "Autre" })).toBe(
			true,
		);
		expect(
			matches({ field: "party.name", cmp: "neq", value: "Camille Moreau" }),
		).toBe(false);
	});

	test("contains is case-sensitive, icontains is not", () => {
		expect(
			matches({ field: "content", cmp: "contains", value: "Bulletin" }),
		).toBe(true);
		expect(
			matches({ field: "content", cmp: "contains", value: "bulletin" }),
		).toBe(false);
		expect(
			matches({
				field: "content",
				cmp: "icontains",
				value: "BULLETIN DE PAIE",
			}),
		).toBe(true);
	});

	test("startsWith and endsWith ignore case", () => {
		expect(
			matches({ field: "filename", cmp: "startsWith", value: "BULLETIN" }),
		).toBe(true);
		expect(matches({ field: "filename", cmp: "endsWith", value: ".pdf" })).toBe(
			true,
		);
		expect(matches({ field: "filename", cmp: "endsWith", value: ".png" })).toBe(
			false,
		);
	});

	test("regex is case-sensitive unless the leaf carries the i flag", () => {
		// The content reads "Bulletin de paie…": a lowercase pattern must not
		// match it on its own.
		expect(
			matches({
				field: "content",
				cmp: "regex",
				value: "bulletin de (paie|salaire)",
			}),
		).toBe(false);
		expect(
			matches({
				field: "content",
				cmp: "regex",
				value: "bulletin de (paie|salaire)",
				flags: "i",
			}),
		).toBe(true);
		expect(
			matches({
				field: "content",
				cmp: "regex",
				value: "Bulletin de (paie|salaire)",
			}),
		).toBe(true);
		// An empty flags string says the same thing as no flags at all.
		expect(
			matches({
				field: "content",
				cmp: "regex",
				value: "bulletin de paie",
				flags: "",
			}),
		).toBe(false);
	});

	test("an invalid or overly long regex does not bring the engine down", () => {
		expect(matches({ field: "content", cmp: "regex", value: "([a-z" })).toBe(
			false,
		);
		expect(
			matches({ field: "content", cmp: "regex", value: "a".repeat(501) }),
		).toBe(false);
	});

	test("in accepts a list of values", () => {
		expect(
			matches({ field: "source", cmp: "in", value: ["mail", "upload"] }),
		).toBe(true);
		expect(matches({ field: "source", cmp: "in", value: ["mail"] })).toBe(
			false,
		);
	});

	test("gt and lt compare numerically", () => {
		expect(matches({ field: "page_count", cmp: "gt", value: 2 })).toBe(true);
		expect(matches({ field: "page_count", cmp: "lt", value: 2 })).toBe(false);
	});

	test("gt and lt compare ISO dates lexicographically", () => {
		expect(
			matches({ field: "document_date", cmp: "gt", value: "2025-01-01" }),
		).toBe(true);
		expect(
			matches({ field: "document_date", cmp: "lt", value: "2025-01-01" }),
		).toBe(false);
	});

	test("between is inclusive", () => {
		expect(
			matches({
				field: "document_date",
				cmp: "between",
				value: ["2025-12-01", "2025-12-31"],
			}),
		).toBe(true);
		expect(
			matches({ field: "page_count", cmp: "between", value: [3, 3] }),
		).toBe(true);
		expect(
			matches({ field: "page_count", cmp: "between", value: [4, 8] }),
		).toBe(false);
	});

	test("exists tests presence, and its inverse with value false", () => {
		expect(
			matches({ field: "detected_identifiers.siren", cmp: "exists" }),
		).toBe(true);
		expect(matches({ field: "detected_identifiers.iban", cmp: "exists" })).toBe(
			false,
		);
		expect(
			matches({
				field: "detected_identifiers.iban",
				cmp: "exists",
				value: false,
			}),
		).toBe(true);
	});

	test("an empty field satisfies no comparator", () => {
		expect(
			matches(
				{ field: "mail.from", cmp: "icontains", value: "@" },
				{ mail: { subject: "sans expéditeur" } },
			),
		).toBe(false);
	});
});

describe("boolean tree", () => {
	const nested: RuleCondition = {
		op: "and",
		children: [
			{ field: "content", cmp: "icontains", value: "bulletin de paie" },
			{
				op: "or",
				children: [
					{ field: "content", cmp: "regex", value: "SIRET\\s*123" },
					{ field: "content", cmp: "icontains", value: "Nordwind Digital" },
				],
			},
			{
				op: "not",
				children: [
					{ field: "filename", cmp: "startsWith", value: "brouillon" },
				],
			},
		],
	};

	test("evaluates a nested and/or/not tree", () => {
		expect(matches(nested)).toBe(true);
	});

	test("not blocks the rule when its child matches", () => {
		expect(matches(nested, { filename: "brouillon-paie.pdf" })).toBe(false);
	});

	test("and fails as soon as one child fails", () => {
		expect(matches(nested, { content: "Facture d'électricité" })).toBe(false);
	});

	test("an empty and group is true, an empty or group is false", () => {
		expect(matches({ op: "and", children: [] })).toBe(true);
		expect(matches({ op: "or", children: [] })).toBe(false);
	});

	test("the trace holds one record per node, children first", () => {
		const result = evaluateCondition(nested, subject());
		expect(result.matched).toBe(true);
		// 3 leaves from the or/not + 1 root leaf + 2 inner groups + the root.
		expect(result.trace).toHaveLength(7);
		expect(result.trace[result.trace.length - 1]?.node).toBe(nested);
		expect(
			result.trace.every((entry) => typeof entry.result === "boolean"),
		).toBe(true);
	});

	test("each trace entry carries its path from the root and its kind", () => {
		const result = evaluateCondition(nested, subject());

		// Every path is unique: the frontend can key its lookup on it.
		const paths = result.trace.map((entry) => JSON.stringify(entry.path));
		expect(new Set(paths).size).toBe(result.trace.length);

		expect(result.trace).toContainEqual(
			expect.objectContaining({ path: [0], kind: "leaf" }),
		);
		expect(result.trace).toContainEqual(
			expect.objectContaining({ path: [1], kind: "group" }),
		);
		expect(result.trace).toContainEqual(
			expect.objectContaining({ path: [1, 0], kind: "leaf" }),
		);
		expect(result.trace).toContainEqual(
			expect.objectContaining({ path: [1, 1], kind: "leaf" }),
		);
		expect(result.trace).toContainEqual(
			expect.objectContaining({ path: [2], kind: "group" }),
		);
		expect(result.trace).toContainEqual(
			expect.objectContaining({ path: [2, 0], kind: "leaf" }),
		);
		// The root itself: empty path, group kind.
		expect(result.trace[result.trace.length - 1]).toMatchObject({
			path: [],
			kind: "group",
		});
	});

	test("a not without children is true", () => {
		expect(matches({ op: "not", children: [] })).toBe(true);
	});
});
