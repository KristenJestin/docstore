/**
 * Title templates (SPEC §3, `set_title` action).
 *
 * `{date:YYYY-MM} - {issuer} - {category}` -> "2025-12 - Nordwind Digital -
 * Payslip". A placeholder whose value is missing becomes an empty string, then
 * the orphaned separators are cleaned up.
 *
 * Document types add `{type}` (the name of the type) and give `{period}` the
 * period key of the recurrence (`2026-03`, `2026-H1`), with `{period:MMMM yyyy}`
 * and `{period:yyyy-MM}` for a readable rendering.
 */

export interface TitleTemplateContext {
	/** Document date, `YYYY-MM-DD`. */
	date?: string | null;
	issuer?: string | null;
	subject?: string | null;
	category?: string | null;
	title?: string | null;
	/** Name of the document type the title is rendered for. */
	type?: string | null;
	filename?: string | null;
	/** File extension, without the leading dot (`"pdf"`). */
	ext?: string | null;
	periodStart?: string | null;
	periodEnd?: string | null;
	/**
	 * Key of the period the document falls into (`2026-03`, `2026-Q1`,
	 * `2026-H1`, `2026`). Only a recurring document type knows it; without it
	 * `{period}` falls back to the covered range.
	 */
	periodKey?: string | null;
}

const PLACEHOLDER_RE = /\{([a-z]+)(?::([^}]+))?\}/gi;

/** Placeholders `renderTitleTemplate` knows how to fill. */
export const TITLE_TEMPLATE_PLACEHOLDERS = [
	"date",
	"issuer",
	"subject",
	"category",
	"title",
	"type",
	"filename",
	"ext",
	"period",
] as const;

/**
 * Placeholders of a template that no context can fill, in the order they
 * appear. Empty when the template is fully renderable.
 *
 * `renderTitleTemplate` leaves an unknown placeholder as-is, which silently
 * produces a filename with a literal `{foo}` in it: callers that can refuse the
 * template (the export) check it first.
 */
export function unknownTemplatePlaceholders(template: string): string[] {
	const known = new Set<string>(TITLE_TEMPLATE_PLACEHOLDERS);
	const unknown: string[] = [];
	for (const match of template.matchAll(PLACEHOLDER_RE)) {
		const name = (match[1] ?? "").toLowerCase();
		if (!known.has(name) && !unknown.includes(name)) unknown.push(name);
	}
	return unknown;
}

function formatDate(date: string, format?: string): string {
	if (!format) return date;
	const upper = format.toUpperCase();
	if (upper === "YYYY") return date.slice(0, 4);
	if (upper === "YYYY-MM") return date.slice(0, 7);
	if (upper === "YYYY-MM-DD") return date;
	return date;
}

function formatPeriod(start?: string | null, end?: string | null): string {
	if (start && end) {
		return start.slice(0, 7) === end.slice(0, 7)
			? start.slice(0, 7)
			: `${start} to ${end}`;
	}
	return start ?? end ?? "";
}

/** en-GB month names, so `{period:MMMM yyyy}` reads "March 2026". */
const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

/**
 * `{period}` without a format is the period key of the recurrence when the
 * caller knows it (`2026-H1`), otherwise the covered range. A format reads the
 * first day of the period: `MMMM yyyy` → "March 2026", `yyyy-MM` → "2026-03".
 */
function renderPeriod(context: TitleTemplateContext, format?: string): string {
	const fallback =
		context.periodKey ?? formatPeriod(context.periodStart, context.periodEnd);
	if (!format) return fallback;
	const start = context.periodStart;
	if (!start) return "";
	const year = start.slice(0, 4);
	const month = MONTH_NAMES[Number(start.slice(5, 7)) - 1] ?? "";
	switch (format.trim().toLowerCase()) {
		case "mmmm yyyy":
			return month && year ? `${month} ${year}` : "";
		case "mmmm":
			return month;
		case "yyyy-mm":
			return start.slice(0, 7);
		case "yyyy":
			return year;
		default:
			return fallback;
	}
}

/** Removes the separators left behind by an empty placeholder. */
function tidy(value: string): string {
	return value
		.replace(/[ \t]+/g, " ")
		.replace(/(?:\s*[-–_/]\s*){2,}/g, " - ")
		.replace(/^[\s\-–_/]+/, "")
		.replace(/[\s\-–_/]+$/, "")
		.trim();
}

/** Replaces known placeholders; unknown ones are left as-is. */
export function renderTitleTemplate(
	template: string,
	context: TitleTemplateContext,
): string {
	const rendered = template.replace(
		PLACEHOLDER_RE,
		(whole, rawName: string, format?: string) => {
			switch (rawName.toLowerCase()) {
				case "date":
					return context.date ? formatDate(context.date, format) : "";
				case "issuer":
					return context.issuer ?? "";
				case "subject":
					return context.subject ?? "";
				case "category":
					return context.category ?? "";
				case "title":
					return context.title ?? "";
				case "type":
					return context.type ?? "";
				case "filename":
					return context.filename ?? "";
				case "ext":
					return context.ext ?? "";
				case "period":
					return renderPeriod(context, format);
				default:
					return whole;
			}
		},
	);
	return tidy(rendered);
}
