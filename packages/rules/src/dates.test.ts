import { describe, expect, test } from "bun:test";
import {
	detectDates,
	detectIssueDate,
	detectPeriods,
	monthFromName,
	parseFrenchDate,
	parseFrenchMonth,
} from "./dates";

describe("parseFrenchDate", () => {
	test("numeric formats", () => {
		expect(parseFrenchDate("12/10/2025")).toEqual({
			date: "2025-10-12",
			precision: "day",
		});
		expect(parseFrenchDate("01-03-2024")).toEqual({
			date: "2024-03-01",
			precision: "day",
		});
		expect(parseFrenchDate("5.7.99")).toEqual({
			date: "1999-07-05",
			precision: "day",
		});
	});

	test("ISO format", () => {
		expect(parseFrenchDate("2025-10-12")?.date).toBe("2025-10-12");
	});

	test("months spelled out and abbreviated", () => {
		expect(parseFrenchDate("12 octobre 2025")?.date).toBe("2025-10-12");
		expect(parseFrenchDate("12 oct. 2025")?.date).toBe("2025-10-12");
		expect(parseFrenchDate("1er mars 2024")?.date).toBe("2024-03-01");
		expect(parseFrenchDate("8 Février 2023")?.date).toBe("2023-02-08");
		expect(parseFrenchDate("15 août 2022")?.date).toBe("2022-08-15");
	});

	test("rejects an impossible date", () => {
		expect(parseFrenchDate("31/02/2025")).toBeNull();
		expect(parseFrenchDate("12 brumaire 2025")).toBeNull();
		expect(parseFrenchDate("pas une date")).toBeNull();
	});
});

describe("parseFrenchMonth", () => {
	test("literal, numeric and ISO month", () => {
		expect(parseFrenchMonth("Décembre 2025")).toEqual({
			date: "2025-12-01",
			precision: "month",
		});
		expect(parseFrenchMonth("déc. 2025")?.date).toBe("2025-12-01");
		expect(parseFrenchMonth("12/2025")?.date).toBe("2025-12-01");
		expect(parseFrenchMonth("2025-12")?.date).toBe("2025-12-01");
	});

	test("a full date is brought back to the first of the month", () => {
		expect(parseFrenchMonth("12/10/2025")?.date).toBe("2025-10-01");
	});

	test("rejects an unknown month", () => {
		expect(parseFrenchMonth("Brumaire 2025")).toBeNull();
		expect(parseFrenchMonth("13/2025")).toBeNull();
	});

	test("monthFromName ignores accents, case and trailing dot", () => {
		expect(monthFromName("Février")).toBe(2);
		expect(monthFromName("FEVR.")).toBe(2);
		expect(monthFromName("septembre")).toBe(9);
		expect(monthFromName("truc")).toBeNull();
	});
});

describe("detectDates", () => {
	test("reports dates in order of appearance", () => {
		const found = detectDates(
			"Facture du 12 octobre 2025, échéance 30/11/2025.",
		);
		expect(found.map((item) => item.date)).toEqual([
			"2025-10-12",
			"2025-11-30",
		]);
		expect(found[0]?.raw).toBe("12 octobre 2025");
		expect(found[0]?.index).toBe(11);
	});

	test("a day-precision date is not detected again as a month", () => {
		const found = detectDates("Émis le 12 octobre 2025");
		expect(found).toHaveLength(1);
		expect(found[0]?.precision).toBe("day");
	});

	test("detects a standalone month", () => {
		const found = detectDates("Bulletin de paie — Décembre 2025");
		expect(found[0]).toMatchObject({ date: "2025-12-01", precision: "month" });
	});

	test("ignores a text with no date", () => {
		expect(detectDates("Aucune information temporelle")).toEqual([]);
	});
});

describe("detectPeriods", () => {
	test("detects a 'du ... au ...' period", () => {
		const found = detectPeriods(
			"Période du 1er janvier 2025 au 31/01/2025 incluse",
		);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ start: "2025-01-01", end: "2025-01-31" });
	});

	test("accepts jusqu'au as an alternative to au", () => {
		const found = detectPeriods("Valable du 01/02/2025 jusqu'au 28/02/2025");
		expect(found[0]?.end).toBe("2025-02-28");
	});

	test("ignores a malformed period", () => {
		expect(detectPeriods("du début au milieu")).toEqual([]);
	});
});

describe("detectPeriods — payslips", () => {
	test('reads "du 01/08/2026 au 31/08/2026"', () => {
		const [period] = detectPeriods(
			"Bulletin de paie du 01/08/2026 au 31/08/2026",
		);
		expect(period).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
	});

	test('reads "période du 1er août 2026 au 31 août 2026"', () => {
		const [period] = detectPeriods(
			"Période du 1er août 2026 au 31 août 2026 — net à payer",
		);
		expect(period).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
	});

	test('reads the English "period from … to …"', () => {
		const [period] = detectPeriods("Pay period from 2026-08-01 to 2026-08-31");
		expect(period).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
	});

	test("ignores bounds in the wrong order", () => {
		expect(detectPeriods("du 31/08/2026 au 01/08/2026")).toEqual([]);
	});
});

describe("detectIssueDate", () => {
	test.each([
		["Payé le 05/09/2026", "2026-09-05"],
		["Date de paiement : 05/09/2026", "2026-09-05"],
		["Établi le 5 septembre 2026", "2026-09-05"],
		["Date d'émission 2026-09-05", "2026-09-05"],
		["Émis le 05.09.2026", "2026-09-05"],
		["Issued on 05/09/2026", "2026-09-05"],
		["Payment date: 05/09/2026", "2026-09-05"],
	])("reads %p", (text, expected) => {
		expect(detectIssueDate(text)?.date).toBe(expected);
	});

	test("prefers the labelled date over the start of the period", () => {
		const text =
			"Bulletin de paie du 01/08/2026 au 31/08/2026 — payé le 05/09/2026";
		expect(detectDates(text)[0]?.date).toBe("2026-08-01");
		expect(detectIssueDate(text)?.date).toBe("2026-09-05");
	});

	test("returns nothing when no label is present", () => {
		expect(detectIssueDate("Facture du 05/09/2026")).toBeNull();
	});
});
