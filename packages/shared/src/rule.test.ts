import { describe, expect, test } from "bun:test";
import { ruleActionSchema } from "./rule";

/**
 * `set_period` is the one action with three ways of saying the same thing:
 * literal bounds, the `year` shortcut for a yearly document, an extraction
 * rule. All three are optional — an action carrying none of them falls back to
 * the period detected in the text.
 */
describe("ruleActionSchema — set_period", () => {
	test("accepts literal bounds", () => {
		expect(
			ruleActionSchema.parse({
				type: "set_period",
				periodStart: "2024-04-01",
				periodEnd: "2025-03-31",
			}),
		).toEqual({
			type: "set_period",
			periodStart: "2024-04-01",
			periodEnd: "2025-03-31",
		});
	});

	test("accepts the year shortcut", () => {
		expect(ruleActionSchema.parse({ type: "set_period", year: 2025 })).toEqual({
			type: "set_period",
			year: 2025,
		});
	});

	test("still accepts the bare action and an extraction rule", () => {
		expect(ruleActionSchema.parse({ type: "set_period" })).toEqual({
			type: "set_period",
		});
		expect(
			ruleActionSchema.parse({ type: "set_period", extractionRuleId: "ext_1" }),
		).toEqual({ type: "set_period", extractionRuleId: "ext_1" });
	});

	test("refuses a bound that is not a date and a year that is not one", () => {
		expect(() =>
			ruleActionSchema.parse({ type: "set_period", periodStart: "01/01/2025" }),
		).toThrow();
		expect(() =>
			ruleActionSchema.parse({ type: "set_period", year: 25 }),
		).toThrow();
		expect(() =>
			ruleActionSchema.parse({ type: "set_period", year: 2025.5 }),
		).toThrow();
	});
});
