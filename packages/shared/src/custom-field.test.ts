import { describe, expect, test } from "bun:test";
import { slugify } from "./common";
import {
	customFieldCategoryIssue,
	customFieldValueIssue,
	customFieldValueSchema,
	documentFieldFilterSchema,
} from "./custom-field";

describe("slugify", () => {
	test("strips accents and punctuation", () => {
		expect(slugify("Bulletin de paie")).toBe("bulletin-de-paie");
		expect(slugify("N° de facture")).toBe("n-de-facture");
		expect(slugify("Date d'échéance")).toBe("date-d-echeance");
		expect(slugify("  Impôts & taxes  ")).toBe("impots-taxes");
	});
});

describe("customFieldValueSchema", () => {
	test("money accepts at most two decimals", () => {
		expect(
			customFieldValueSchema.parse({
				kind: "money",
				amount: 1234.56,
				currency: "EUR",
			}),
		).toEqual({ kind: "money", amount: 1234.56, currency: "EUR" });

		expect(
			customFieldValueSchema.safeParse({
				kind: "money",
				amount: 12.345,
				currency: "EUR",
			}).success,
		).toBe(false);
	});

	test("money requires an uppercase ISO currency code", () => {
		expect(
			customFieldValueSchema.safeParse({
				kind: "money",
				amount: 10,
				currency: "eur",
			}).success,
		).toBe(false);
	});

	test("date expects the YYYY-MM-DD format", () => {
		expect(
			customFieldValueSchema.parse({ kind: "date", date: "2025-12-01" }),
		).toEqual({ kind: "date", date: "2025-12-01" });
		expect(
			customFieldValueSchema.safeParse({ kind: "date", date: "01/12/2025" })
				.success,
		).toBe(false);
	});

	test("rejects an unknown `kind` or a missing key", () => {
		expect(
			customFieldValueSchema.safeParse({ kind: "duration", ms: 10 }).success,
		).toBe(false);
		expect(customFieldValueSchema.safeParse({ kind: "text" }).success).toBe(
			false,
		);
	});

	test("url must be a valid URL", () => {
		expect(
			customFieldValueSchema.safeParse({ kind: "url", url: "not-a-url" })
				.success,
		).toBe(false);
		expect(
			customFieldValueSchema.parse({
				kind: "url",
				url: "https://example.com/a",
			}),
		).toEqual({ kind: "url", url: "https://example.com/a" });
	});
});

describe("documentFieldFilterSchema", () => {
	test("only accepts the known operators", () => {
		expect(
			documentFieldFilterSchema.parse({
				fieldId: "cf_1",
				op: "contains",
				value: "abc",
			}).op,
		).toBe("contains");
		expect(
			documentFieldFilterSchema.safeParse({
				fieldId: "cf_1",
				op: "gte",
				value: 1,
			}).success,
		).toBe(false);
	});
});

describe("customFieldValueIssue", () => {
	const money = {
		name: "Total amount",
		type: "money" as const,
		options: { currency: "EUR" },
	};

	test("accepts a value that matches the definition", () => {
		expect(
			customFieldValueIssue(money, {
				kind: "money",
				amount: 10,
				currency: "EUR",
			}),
		).toBeNull();
	});

	test("refuses a currency other than the configured one", () => {
		expect(
			customFieldValueIssue(money, {
				kind: "money",
				amount: 10,
				currency: "USD",
			}),
		).toContain("EUR");
	});

	test("falls back on EUR when the field names no currency", () => {
		const field = { name: "Amount", type: "money" as const, options: {} };
		expect(
			customFieldValueIssue(field, {
				kind: "money",
				amount: 1,
				currency: "EUR",
			}),
		).toBeNull();
		expect(
			customFieldValueIssue(field, {
				kind: "money",
				amount: 1,
				currency: "CHF",
			}),
		).toContain("EUR");
	});

	test("refuses a negative amount unless `allowNegative`", () => {
		expect(
			customFieldValueIssue(money, {
				kind: "money",
				amount: -1,
				currency: "EUR",
			}),
		).toContain("negative");
		expect(
			customFieldValueIssue(
				{ ...money, options: { currency: "EUR", allowNegative: true } },
				{ kind: "money", amount: -1, currency: "EUR" },
			),
		).toBeNull();
	});

	test("guards a number the same way, and still checks the type", () => {
		const number = { name: "Pages", type: "number" as const, options: {} };
		expect(
			customFieldValueIssue(number, { kind: "number", number: -1 }),
		).toContain("negative");
		expect(
			customFieldValueIssue(number, { kind: "text", text: "x" }),
		).toContain("number");
	});
});

describe("customFieldCategoryIssue", () => {
	test("a global field applies everywhere", () => {
		expect(
			customFieldCategoryIssue({ name: "Ref", categoryIds: [] }, []),
		).toBeNull();
	});

	test("a restricted field applies to its category and its children", () => {
		const field = { name: "Net pay", categoryIds: ["cat_payslip"] };
		expect(customFieldCategoryIssue(field, ["cat_payslip"])).toBeNull();
		// The document sits in a sub-category: its ancestors count.
		expect(
			customFieldCategoryIssue(field, ["cat_child", "cat_payslip"]),
		).toBeNull();
		expect(customFieldCategoryIssue(field, ["cat_invoice"])).toContain(
			"category",
		);
		expect(customFieldCategoryIssue(field, [])).toContain("category");
	});
});
