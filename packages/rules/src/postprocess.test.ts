import { describe, expect, test } from "bun:test";
import { applyPostprocess, parseFrenchNumber } from "./postprocess";

describe("parseFrenchNumber", () => {
	test("French amounts", () => {
		expect(parseFrenchNumber("1 234,56 €")).toBe(1234.56);
		expect(parseFrenchNumber("1 234,56")).toBe(1234.56);
		expect(parseFrenchNumber("12,5")).toBe(12.5);
		expect(parseFrenchNumber("1 000 000,00")).toBe(1000000);
	});

	test("dot as thousands separator", () => {
		expect(parseFrenchNumber("1.234")).toBe(1234);
		expect(parseFrenchNumber("1.234.567,89")).toBe(1234567.89);
	});

	test("English notation", () => {
		expect(parseFrenchNumber("1,234.56")).toBe(1234.56);
	});

	test("negative numbers", () => {
		expect(parseFrenchNumber("-1 234,56 €")).toBe(-1234.56);
		expect(parseFrenchNumber("(1 234,56)")).toBe(-1234.56);
	});

	test("unreadable values", () => {
		expect(parseFrenchNumber("néant")).toBeNull();
		expect(parseFrenchNumber("")).toBeNull();
	});
});

describe("applyPostprocess", () => {
	test("full chain trim -> regex_replace -> uppercase", () => {
		const outcome = applyPostprocess("  net a payer  ", [
			"trim",
			{ regex_replace: { pattern: "\\s+", replacement: "-", flags: "g" } },
			"uppercase",
		]);
		expect(outcome.value).toBe("NET-A-PAYER");
	});

	test("month_fr fills in the precision", () => {
		const outcome = applyPostprocess("Décembre 2025", ["month_fr"]);
		expect(outcome.value).toBe("2025-12-01");
		expect(outcome.precision).toBe("month");
	});

	test("an empty postprocessing chain returns the raw value", () => {
		expect(applyPostprocess("brut", []).value).toBe("brut");
	});

	test("a failing step stops the chain", () => {
		const outcome = applyPostprocess("abc", ["number_fr", "uppercase"]);
		expect(outcome.value).toBeNull();
	});

	test("an invalid replacement pattern voids the value", () => {
		const outcome = applyPostprocess("abc", [
			{ regex_replace: { pattern: "([a-z", replacement: "" } },
		]);
		expect(outcome.value).toBeNull();
	});
});
