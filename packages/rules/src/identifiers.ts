/**
 * Identifier detection in the text of a document (SPEC §3, pre-pass).
 *
 * Everything is validated (Luhn for SIREN/SIRET, mod 97 for the IBAN and the
 * VAT key) so that no match is proposed on an invoice number that merely looks
 * like a SIREN. `\s` already covers non-breaking spaces.
 */

export const DETECTED_IDENTIFIER_KINDS = [
	"siren",
	"siret",
	"vat",
	"iban",
	"email",
	"domain",
	"phone",
] as const;

export type DetectedIdentifierKind = (typeof DETECTED_IDENTIFIER_KINDS)[number];

export interface DetectedIdentifier {
	kind: DetectedIdentifierKind;
	/** Normalized: no spaces, uppercase (lowercase for email/domain). */
	value: string;
	/** Text as it appears in the document. */
	raw?: string;
	/** Position of the first character in the source text. */
	index?: number;
	/** Matched Party, filled in by the caller after a database lookup. */
	partyId?: string;
}

function digitsOnly(value: string): string {
	return value.replace(/\D/g, "");
}

function stripSeparators(value: string): string {
	return value.replace(/[\s.-]/g, "");
}

/** Luhn algorithm, used by SIREN (9 digits) and SIRET (14). */
export function luhnValid(digits: string): boolean {
	if (!/^\d+$/.test(digits)) return false;
	let sum = 0;
	let double = false;
	for (let index = digits.length - 1; index >= 0; index--) {
		const char = digits[index];
		if (char === undefined) return false;
		let digit = char.charCodeAt(0) - 48;
		if (double) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
		double = !double;
	}
	return sum % 10 === 0;
}

export function isValidSiren(value: string): boolean {
	const digits = digitsOnly(value);
	return digits.length === 9 && digits !== "000000000" && luhnValid(digits);
}

export function isValidSiret(value: string): boolean {
	const digits = digitsOnly(value);
	if (digits.length !== 14) return false;
	// La Poste: SIRET starting with 356000000, whose digit sum is a multiple
	// of 5 instead of following Luhn.
	if (digits.startsWith("356000000")) {
		const sum = [...digits].reduce(
			(total, char) => total + (char.charCodeAt(0) - 48),
			0,
		);
		return sum % 5 === 0;
	}
	return luhnValid(digits);
}

/** French VAT number: `FR` + key (2 characters) + SIREN (9 digits). */
export function isValidVatFr(value: string): boolean {
	const normalized = stripSeparators(value).toUpperCase();
	const match = /^FR([0-9A-HJ-NP-Z]{2})(\d{9})$/.exec(normalized);
	const key = match?.[1];
	const siren = match?.[2];
	if (!key || !siren || !isValidSiren(siren)) return false;
	// Numeric key: (12 + 3 * (SIREN mod 97)) mod 97. Alphabetic keys (older
	// registrations) cannot be checked: we accept them.
	if (/^\d{2}$/.test(key)) {
		return Number(key) === (12 + 3 * (Number(siren) % 97)) % 97;
	}
	return true;
}

/** Standard IBAN validation: rearrange, then modulo 97 must equal 1. */
export function isValidIban(value: string): boolean {
	const normalized = stripSeparators(value).toUpperCase();
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(normalized)) return false;
	const rearranged = normalized.slice(4) + normalized.slice(0, 4);
	let remainder = 0;
	for (const char of rearranged) {
		const code = char.charCodeAt(0);
		const chunk = code >= 65 && code <= 90 ? String(code - 55) : char;
		for (const digit of chunk) {
			remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
		}
	}
	return remainder === 1;
}

/** Normalizes a French phone number to `+33XXXXXXXXX`. */
export function normalizePhoneFr(value: string): string | null {
	const compact = value.replace(/[\s.()-]/g, "");
	const match = /^(?:\+33|0033|0)([1-9]\d{8})$/.exec(compact);
	return match?.[1] ? `+33${match[1]}` : null;
}

type Span = { start: number; end: number };

function overlaps(spans: Span[], start: number, end: number): boolean {
	return spans.some((span) => start < span.end && end > span.start);
}

const SIRET_RE = /\b\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s.]?\d{5}\b/g;
const SIREN_RE = /\b\d{3}[\s.]?\d{3}[\s.]?\d{3}\b/g;
const VAT_RE = /\bFR\s?[0-9A-HJ-NP-Z]{2}\s?\d{3}\s?\d{3}\s?\d{3}\b/gi;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const URL_RE =
	/https?:\/\/([A-Za-z0-9.-]+\.[A-Za-z]{2,})|\b(www\.[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const PHONE_RE = /(?:\+33|0033|\b0)[\s.-]?[1-9](?:[\s.-]?\d{2}){4}\b/g;

/**
 * Extracts every recognizable identifier from a text, deduplicated while
 * preserving the order of appearance.
 */
export function detectIdentifiers(text: string): DetectedIdentifier[] {
	const found: DetectedIdentifier[] = [];
	const seen = new Set<string>();

	const push = (
		kind: DetectedIdentifierKind,
		value: string,
		raw: string,
		index: number,
	): void => {
		const key = `${kind}:${value}`;
		if (seen.has(key)) return;
		seen.add(key);
		found.push({ kind, value, raw, index });
	};

	// SIRET first: their 14 digits contain a SIREN that we do not want to
	// detect again from an arbitrary prefix.
	const siretSpans: Span[] = [];
	for (const match of text.matchAll(SIRET_RE)) {
		const raw = match[0];
		const index = match.index ?? 0;
		if (!isValidSiret(raw)) continue;
		siretSpans.push({ start: index, end: index + raw.length });
		const digits = digitsOnly(raw);
		push("siret", digits, raw, index);
		const siren = digits.slice(0, 9);
		if (isValidSiren(siren)) push("siren", siren, raw, index);
	}

	for (const match of text.matchAll(SIREN_RE)) {
		const raw = match[0];
		const index = match.index ?? 0;
		if (overlaps(siretSpans, index, index + raw.length)) continue;
		if (!isValidSiren(raw)) continue;
		push("siren", digitsOnly(raw), raw, index);
	}

	for (const match of text.matchAll(VAT_RE)) {
		const raw = match[0];
		const index = match.index ?? 0;
		if (!isValidVatFr(raw)) continue;
		const normalized = stripSeparators(raw).toUpperCase();
		push("vat", normalized, raw, index);
		const siren = normalized.slice(4);
		if (isValidSiren(siren)) push("siren", siren, raw, index);
	}

	for (const match of text.matchAll(IBAN_RE)) {
		const raw = match[0];
		const index = match.index ?? 0;
		if (!isValidIban(raw)) continue;
		push("iban", stripSeparators(raw).toUpperCase(), raw, index);
	}

	for (const match of text.matchAll(EMAIL_RE)) {
		const raw = match[0];
		const index = match.index ?? 0;
		const value = raw.toLowerCase();
		push("email", value, raw, index);
		const domain = value.split("@")[1];
		if (domain) push("domain", domain, raw, index);
	}

	for (const match of text.matchAll(URL_RE)) {
		const host = match[1] ?? match[2];
		if (!host) continue;
		push(
			"domain",
			host.toLowerCase().replace(/^www\./, ""),
			match[0],
			match.index ?? 0,
		);
	}

	for (const match of text.matchAll(PHONE_RE)) {
		const raw = match[0];
		const value = normalizePhoneFr(raw);
		if (!value) continue;
		push("phone", value, raw.trim(), match.index ?? 0);
	}

	return found;
}
