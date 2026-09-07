import { describe, expect, test } from "bun:test";
import {
	detectIdentifiers,
	isValidIban,
	isValidSiren,
	isValidSiret,
	isValidVatFr,
	luhnValid,
	normalizePhoneFr,
} from "./identifiers";

describe("validation", () => {
	test("valid and invalid SIREN", () => {
		expect(isValidSiren("900000019")).toBe(true);
		expect(isValidSiren("900 000 019")).toBe(true);
		expect(isValidSiren("900000018")).toBe(false);
		expect(isValidSiren("90000001")).toBe(false);
		expect(isValidSiren("000000000")).toBe(false);
	});

	test("valid and invalid SIRET", () => {
		expect(isValidSiret("90000001900027")).toBe(true);
		expect(isValidSiret("900 000 019 00027")).toBe(true);
		expect(isValidSiret("90000001900028")).toBe(false);
		expect(isValidSiret("900000019000")).toBe(false);
	});

	test("La Poste SIRET: digit sum is a multiple of 5", () => {
		expect(isValidSiret("35600000000001")).toBe(true);
		expect(isValidSiret("35600000000002")).toBe(false);
	});

	test("IBAN validated by modulo 97, spaces tolerated", () => {
		expect(isValidIban("FR7630006000011234567890189")).toBe(true);
		expect(isValidIban("FR76 3000 6000 0112 3456 7890 189")).toBe(true);
		expect(isValidIban("DE89370400440532013000")).toBe(true);
		expect(isValidIban("FR7630006000011234567890188")).toBe(false);
		expect(isValidIban("FR76")).toBe(false);
	});

	test("French VAT: key computed from the SIREN", () => {
		expect(isValidVatFr("FR25900000019")).toBe(true);
		expect(isValidVatFr("FR 25 900 000 019")).toBe(true);
		expect(isValidVatFr("FR26900000019")).toBe(false);
		// Invalid SIREN: the key alone is not enough.
		expect(isValidVatFr("FR25900000018")).toBe(false);
	});

	test("Luhn", () => {
		expect(luhnValid("79927398713")).toBe(true);
		expect(luhnValid("79927398710")).toBe(false);
		expect(luhnValid("12a")).toBe(false);
	});

	test("normalization of French phone numbers", () => {
		expect(normalizePhoneFr("01 23 45 67 89")).toBe("+33123456789");
		expect(normalizePhoneFr("+33 1 23 45 67 89")).toBe("+33123456789");
		expect(normalizePhoneFr("0033123456789")).toBe("+33123456789");
		expect(normalizePhoneFr("00 23 45 67 89")).toBeNull();
	});
});

describe("detectIdentifiers", () => {
	test("spots a SIRET and its SIREN, uppercase and without spaces", () => {
		const found = detectIdentifiers("SIRET 900 000 019 00027 — société");
		expect(found.find((item) => item.kind === "siret")?.value).toBe(
			"90000001900027",
		);
		expect(found.find((item) => item.kind === "siren")?.value).toBe(
			"900000019",
		);
	});

	test("ignores a nine-digit number that is not a SIREN", () => {
		const found = detectIdentifiers("Référence client 123 456 780");
		expect(found.filter((item) => item.kind === "siren")).toHaveLength(0);
	});

	test("spots an IBAN written in blocks of four", () => {
		const found = detectIdentifiers(
			"Coordonnées : IBAN FR76 3000 6000 0112 3456 7890 189",
		);
		expect(found.find((item) => item.kind === "iban")?.value).toBe(
			"FR7630006000011234567890189",
		);
	});

	test("ignores an IBAN whose check key is wrong", () => {
		const found = detectIdentifiers("IBAN FR76 3000 6000 0112 3456 7890 188");
		expect(found.filter((item) => item.kind === "iban")).toHaveLength(0);
	});

	test("spots the intra-community VAT number and the associated SIREN", () => {
		const found = detectIdentifiers("TVA FR 25 900 000 019");
		expect(found.find((item) => item.kind === "vat")?.value).toBe(
			"FR25900000019",
		);
		expect(found.some((item) => item.kind === "siren")).toBe(true);
	});

	test("spots emails and domains, lowercased", () => {
		const found = detectIdentifiers(
			"Contact : Compta@Nordwind.example — https://www.Nordwind.example/factures",
		);
		expect(found.find((item) => item.kind === "email")?.value).toBe(
			"compta@nordwind.example",
		);
		expect(
			found.filter((item) => item.kind === "domain").map((item) => item.value),
		).toEqual(["nordwind.example"]);
	});

	test("spots a normalized French phone number", () => {
		const found = detectIdentifiers("Tél. 01 23 45 67 89");
		expect(found.find((item) => item.kind === "phone")?.value).toBe(
			"+33123456789",
		);
	});

	test("deduplicates and keeps the original position", () => {
		const text = "SIREN 900 000 019, encore 900000019";
		const found = detectIdentifiers(text);
		const sirens = found.filter((item) => item.kind === "siren");
		expect(sirens).toHaveLength(1);
		expect(sirens[0]?.index).toBe(text.indexOf("900 000 019"));
		expect(sirens[0]?.raw).toBe("900 000 019");
	});

	test("a text without any identifier returns nothing", () => {
		expect(detectIdentifiers("Bonjour, ceci est un courrier.")).toEqual([]);
	});
});
