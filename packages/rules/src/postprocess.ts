import type { DatePrecision } from "@docstore/shared/document";
import type { PostprocessStep } from "@docstore/shared/extraction";
import { parseFrenchDate, parseFrenchMonth } from "./dates";
import { safeRegex } from "./regex";

/**
 * Chainable postprocessing steps for an extracted value (SPEC §4).
 *
 * Each step receives the output of the previous one. As soon as a step fails
 * (unreadable number, invalid date), the value becomes `null` and the chain
 * stops: the caller turns that into a reason for queueing a Review.
 */

export interface PostprocessOutcome {
	value: unknown;
	precision?: DatePrecision;
}

/**
 * "1 234,56 €" -> 1234.56, "1,234.56" -> 1234.56, "1.234" -> 1234.
 *
 * The decimal separator is the last `,` or `.` encountered; a lone dot
 * followed by exactly three digits is treated as a thousands separator, the
 * comma being the French decimal separator.
 */
export function parseFrenchNumber(input: string): number | null {
	const negative = /-\s*\d/.test(input) || /^\s*\(.*\)\s*$/.test(input.trim());
	const cleaned = input.replace(/[^0-9.,]/g, "");
	if (cleaned.length === 0) return null;

	const lastComma = cleaned.lastIndexOf(",");
	const lastDot = cleaned.lastIndexOf(".");
	let decimalPos = -1;
	if (lastComma >= 0 && lastDot >= 0) {
		decimalPos = Math.max(lastComma, lastDot);
	} else if (lastComma >= 0) {
		decimalPos = lastComma;
	} else if (lastDot >= 0) {
		decimalPos = cleaned.length - lastDot - 1 === 3 ? -1 : lastDot;
	}

	const integerPart = (
		decimalPos >= 0 ? cleaned.slice(0, decimalPos) : cleaned
	).replace(/[.,]/g, "");
	const fractionPart = (
		decimalPos >= 0 ? cleaned.slice(decimalPos + 1) : ""
	).replace(/[.,]/g, "");
	if (integerPart.length === 0 && fractionPart.length === 0) return null;

	const value = Number(`${integerPart || "0"}.${fractionPart || "0"}`);
	if (!Number.isFinite(value)) return null;
	return negative ? -value : value;
}

function asText(value: unknown): string {
	if (value === null || value === undefined) return "";
	return typeof value === "string" ? value : String(value);
}

/** Applies the postprocessing chain to the raw extracted value. */
export function applyPostprocess(
	raw: string,
	steps: readonly PostprocessStep[],
): PostprocessOutcome {
	let value: unknown = raw;
	let precision: DatePrecision | undefined;

	for (const step of steps) {
		if (value === null) break;

		if (typeof step === "object") {
			const { pattern, replacement, flags } = step.regex_replace;
			const regex = safeRegex(pattern, flags ?? "g");
			value = regex ? asText(value).replace(regex, replacement) : null;
			continue;
		}

		switch (step) {
			case "trim":
				value = asText(value).trim();
				break;
			case "uppercase":
				value = asText(value).toUpperCase();
				break;
			case "number_fr":
				value = parseFrenchNumber(asText(value));
				break;
			case "date_fr": {
				const parsed = parseFrenchDate(asText(value).trim());
				value = parsed?.date ?? null;
				precision = parsed?.precision;
				break;
			}
			case "month_fr": {
				const parsed = parseFrenchMonth(asText(value).trim());
				value = parsed?.date ?? null;
				precision = parsed?.precision;
				break;
			}
		}
	}

	return { value, precision };
}
