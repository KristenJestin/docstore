/**
 * Title templates (SPEC §3, `set_title` action).
 *
 * `{date:YYYY-MM} - {issuer} - {category}` -> "2025-12 - Nordwind Digital -
 * Payslip". A placeholder whose value is missing becomes an empty string, then
 * the orphaned separators are cleaned up.
 */

export interface TitleTemplateContext {
	/** Document date, `YYYY-MM-DD`. */
	date?: string | null;
	issuer?: string | null;
	subject?: string | null;
	category?: string | null;
	title?: string | null;
	filename?: string | null;
	/** File extension, without the leading dot (`"pdf"`). */
	ext?: string | null;
	periodStart?: string | null;
	periodEnd?: string | null;
}

const PLACEHOLDER_RE = /\{([a-z]+)(?::([^}]+))?\}/gi;

/** Placeholders `renderTitleTemplate` knows how to fill. */
export const TITLE_TEMPLATE_PLACEHOLDERS = [
	"date",
	"issuer",
	"subject",
	"category",
	"title",
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
				case "filename":
					return context.filename ?? "";
				case "ext":
					return context.ext ?? "";
				case "period":
					return formatPeriod(context.periodStart, context.periodEnd);
				default:
					return whole;
			}
		},
	);
	return tidy(rendered);
}
