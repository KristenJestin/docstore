import { describe, expect, test } from "bun:test";
import { formatDateEnGb, slugify } from "./common";

describe("slugify", () => {
	test("removes accents, lowercases and hyphenates", () => {
		expect(slugify("Payslip")).toBe("payslip");
		expect(slugify("Invoice number")).toBe("invoice-number");
	});
});

describe("formatDateEnGb", () => {
	test("formats a YYYY-MM-DD date as en-GB", () => {
		expect(formatDateEnGb("2026-10-08")).toBe("8 Oct 2026");
	});

	test("pads nothing: single-digit days have no leading zero", () => {
		expect(formatDateEnGb("2027-06-05")).toBe("5 Jun 2027");
	});

	test("returns the input unchanged when it cannot be parsed", () => {
		expect(formatDateEnGb("not-a-date")).toBe("not-a-date");
	});
});
