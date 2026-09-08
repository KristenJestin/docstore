import { describe, expect, test } from "bun:test";
import {
	detectDates,
	detectIssueDate,
	detectPeriods,
	detectReadingPeriod,
	detectYearPeriod,
	INFERRED_DATE_CONFIDENCE,
	LABELLED_DATE_CONFIDENCE,
	monthFromName,
	parseFrenchDate,
	parseFrenchMonth,
	pickDocumentDate,
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

describe("detectReadingPeriod — water and energy bills", () => {
	test("two readings bound the consumption, whatever their order", () => {
		const text = [
			"Facture d'eau — consommation",
			"Relevé du 12/03/2026 : index 1 284 m³",
			"Relevé précédent 10/09/2025 : index 1 191 m³",
		].join("\n");
		expect(detectReadingPeriod(text)).toMatchObject({
			start: "2025-09-10",
			end: "2026-03-12",
		});
		expect(detectPeriods(text)[0]).toMatchObject({
			start: "2025-09-10",
			end: "2026-03-12",
		});
	});

	test("the earlier reading first changes nothing", () => {
		const text =
			"Relevé précédent du 10/09/2025\nRelevé actuel du 12 mars 2026";
		expect(detectReadingPeriod(text)).toMatchObject({
			start: "2025-09-10",
			end: "2026-03-12",
		});
	});

	test("reads the index wording of an energy bill", () => {
		const text = [
			"Électricité — votre consommation",
			"Ancien index : 10/09/2025 — 4 812 kWh",
			"Nouvel index : 12/03/2026 — 6 044 kWh",
		].join("\n");
		expect(detectReadingPeriod(text)).toMatchObject({
			start: "2025-09-10",
			end: "2026-03-12",
		});
	});

	test("a single reading is a date, not a period", () => {
		expect(
			detectReadingPeriod("Relevé du 12/03/2026 : index 1 284"),
		).toBeNull();
		expect(
			detectReadingPeriod("Relevé du 12/03/2026\nRelevé le 12/03/2026"),
		).toBeNull();
	});

	test("an explicit du … au … wins over the readings", () => {
		const text = [
			"Facture d'eau du 01/01/2026 au 31/03/2026",
			"Relevé du 12/03/2026",
			"Relevé précédent 10/09/2025",
		].join("\n");
		expect(detectPeriods(text)[0]).toMatchObject({
			start: "2026-01-01",
			end: "2026-03-31",
		});
	});

	test("a text without readings proposes nothing", () => {
		expect(detectReadingPeriod("Facture du 12/03/2026, total 42,00 €")).toBe(
			null,
		);
	});
});

describe("detectYearPeriod — yearly documents", () => {
	test.each([
		["Avis d'impôt — année 2025", "2025"],
		["Impôt sur les revenus 2025", "2025"],
		["Établi au titre de l'année 2025", "2025"],
		["Statement for tax year 2025", "2025"],
		["Exercice 2025 — récapitulatif annuel", "2025"],
		["Revenus de 2025", "2025"],
	])("reads %p", (text, year) => {
		expect(detectYearPeriod(text)).toMatchObject({
			start: `${year}-01-01`,
			end: `${year}-12-31`,
		});
		expect(detectPeriods(text)[0]).toMatchObject({
			start: `${year}-01-01`,
			end: `${year}-12-31`,
		});
	});

	test("a bare four-digit number is not a year statement", () => {
		expect(detectYearPeriod("Montant total : 2025 €")).toBeNull();
		expect(detectYearPeriod("Index 2025 kWh")).toBeNull();
	});

	test("an explicit period wins over the year named in the text", () => {
		const text = "Bulletin de paie du 01/08/2025 au 31/08/2025 — année 2025";
		expect(detectPeriods(text)[0]).toMatchObject({
			start: "2025-08-01",
			end: "2025-08-31",
		});
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

describe("pickDocumentDate", () => {
	const pick = (text: string, period?: { start: string; end: string }) =>
		pickDocumentDate({
			text,
			detectedDates: detectDates(text),
			periodStart: period?.start ?? null,
			periodEnd: period?.end ?? null,
		});

	test("a labelled date is trusted, not guessed", () => {
		const text = "Bulletin du 01/08/2026 au 31/08/2026 — payé le 05/09/2026";
		expect(
			pick(text, { start: "2026-08-01", end: "2026-08-31" }),
		).toMatchObject({
			source: "labelled",
			confidence: LABELLED_DATE_CONFIDENCE,
			candidate: { date: "2026-09-05" },
		});
	});

	test("a date read off the covered period is trusted too", () => {
		// Every date of the text is a bound of the period: the document date can
		// only be the period's own, which the text states explicitly.
		const text = "Relevé du 01/08/2026 au 31/08/2026";
		expect(
			pick(text, { start: "2026-08-01", end: "2026-08-31" }),
		).toMatchObject({
			source: "period",
			confidence: LABELLED_DATE_CONFIDENCE,
			candidate: { date: "2026-08-01" },
		});
	});

	test("the bare first date of the text stays a guess", () => {
		expect(pick("Facture 12/09/2026 — total 30,00")).toMatchObject({
			source: "inferred",
			confidence: INFERRED_DATE_CONFIDENCE,
			candidate: { date: "2026-09-12" },
		});
	});

	test("a date outside the period bounds is still only inferred", () => {
		const text = "Période du 01/08/2026 au 31/08/2026\nÉdition 12/09/2026";
		expect(
			pick(text, { start: "2026-08-01", end: "2026-08-31" }),
		).toMatchObject({
			source: "inferred",
			confidence: INFERRED_DATE_CONFIDENCE,
			candidate: { date: "2026-09-12" },
		});
	});

	test("nothing to read means nothing to propose", () => {
		expect(pick("No date at all in this text.")).toBeNull();
	});

	test("a yearly document is dated by its year, with year precision", () => {
		const text =
			"Avis d'impôt sur les revenus 2025\nMontant à payer : 1 240,00 €";
		expect(
			pick(text, { start: "2025-01-01", end: "2025-12-31" }),
		).toMatchObject({
			source: "period",
			confidence: LABELLED_DATE_CONFIDENCE,
			candidate: { date: "2025-01-01", precision: "year" },
		});
	});

	test("the year statement loses to a labelled date", () => {
		const text = "Attestation au titre de l'année 2025 — établie le 12/02/2026";
		expect(
			pick(text, { start: "2025-01-01", end: "2025-12-31" }),
		).toMatchObject({
			source: "labelled",
			candidate: { date: "2026-02-12", precision: "day" },
		});
	});

	test("a document whose period is not that year keeps its own date", () => {
		const text = "Bulletin de paie du 01/08/2025 au 31/08/2025 — année 2025";
		expect(
			pick(text, { start: "2025-08-01", end: "2025-08-31" }),
		).toMatchObject({
			source: "period",
			candidate: { date: "2025-08-01", precision: "day" },
		});
	});
});
