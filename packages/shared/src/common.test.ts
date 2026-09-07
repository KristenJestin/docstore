import { describe, expect, test } from "bun:test";
import { formatContentDate, formatDateEnGb, slugify } from "./common";

describe("slugify", () => {
	test("removes accents, lowercases and hyphenates", () => {
		expect(slugify("Payslip")).toBe("payslip");
		expect(slugify("Invoice number")).toBe("invoice-number");
	});
});

describe("formatContentDate", () => {
	test("writes the date in the content language", () => {
		expect(formatContentDate("2026-10-08", "en-GB")).toBe("8 Oct 2026");
		expect(formatContentDate("2026-10-08", "fr-FR")).toBe("8 oct. 2026");
	});

	test("a month spelled the same in both still reads naturally", () => {
		expect(formatContentDate("2027-06-30", "en-GB")).toBe("30 Jun 2027");
		expect(formatContentDate("2027-06-30", "fr-FR")).toBe("30 juin 2027");
	});

	test("returns the input unchanged when it cannot be parsed", () => {
		expect(formatContentDate("not-a-date", "fr-FR")).toBe("not-a-date");
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
