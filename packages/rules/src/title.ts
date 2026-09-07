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
 *
 * A format can carry its own language after a pipe — `{period:MMMM yyyy|fr-FR}`
 * — which overrides the content language for that token alone.
 */

import type { ContentLocale } from "@docstore/shared/common";
import { CONTENT_LOCALES, UI_LOCALE } from "@docstore/shared/common";

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

/**
 * A format can end with `|<locale>` (`MMMM yyyy|fr-FR`) to pin the language of
 * that token alone. An unknown language is not a locale at all: the pipe is
 * then kept as part of the format, which falls back like any other unknown one.
 */
function splitFormat(raw?: string): {
	format?: string;
	locale?: ContentLocale;
} {
	if (!raw) return {};
	const pipe = raw.lastIndexOf("|");
	if (pipe < 0) return { format: raw };
	const candidate = raw
		.slice(pipe + 1)
		.trim()
		.toLowerCase();
	const locale = CONTENT_LOCALES.find(
		(known) => known.toLowerCase() === candidate,
	);
	if (!locale) return { format: raw };
	const format = raw.slice(0, pipe).trim();
	return { format: format.length > 0 ? format : undefined, locale };
}

/**
 * Renders a `YYYY-MM-DD` date under a known format, or `null` when the format
 * is not one we know. Shared by `{date}` and `{period}`, so a month is spelled
 * the same way whichever token asked for it.
 */
function renderFormat(
	date: string,
	format: string,
	locale: ContentLocale,
): string | null {
	const year = date.slice(0, 4);
	const index = Number(date.slice(5, 7)) - 1;
	const month = MONTH_NAMES[locale][index] ?? "";
	const shortMonth = SHORT_MONTH_NAMES[locale][index] ?? "";
	switch (format.trim().toLowerCase()) {
		case "mmmm yyyy":
			return month && year ? `${month} ${year}` : "";
		case "mmmm":
			return month;
		case "mmm yyyy":
			return shortMonth && year ? `${shortMonth} ${year}` : "";
		case "mmm":
			return shortMonth;
		case "yyyy-mm-dd":
			return date;
		case "yyyy-mm":
			return date.slice(0, 7);
		case "yyyy":
			return year;
		default:
			return null;
	}
}

/** `{date}`: the document date, trimmed or spelled out. */
function formatDate(
	date: string,
	locale: ContentLocale,
	format?: string,
): string {
	if (!format) return date;
	return renderFormat(date, format, locale) ?? date;
}

function formatPeriod(start?: string | null, end?: string | null): string {
	if (start && end) {
		return start.slice(0, 7) === end.slice(0, 7)
			? start.slice(0, 7)
			: `${start} to ${end}`;
	}
	return start ?? end ?? "";
}

/**
 * Month names per content language, so `{period:MMMM yyyy}` reads "March 2026"
 * or "mars 2026". Spelled out rather than taken from `Intl` so a template
 * renders the same whatever ICU data the runtime ships, and so the short forms
 * carry no trailing dot: they end up in file names.
 *
 * French months are lower case, which is the correct French spelling.
 */
const MONTH_NAMES: Record<ContentLocale, readonly string[]> = {
	"en-GB": [
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
	],
	"fr-FR": [
		"janvier",
		"février",
		"mars",
		"avril",
		"mai",
		"juin",
		"juillet",
		"août",
		"septembre",
		"octobre",
		"novembre",
		"décembre",
	],
};

/** Short month names, for `{period:MMM}`. */
const SHORT_MONTH_NAMES: Record<ContentLocale, readonly string[]> = {
	"en-GB": [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	],
	"fr-FR": [
		"janv",
		"févr",
		"mars",
		"avr",
		"mai",
		"juin",
		"juil",
		"août",
		"sept",
		"oct",
		"nov",
		"déc",
	],
};

/**
 * `{period}` without a format is the period key of the recurrence when the
 * caller knows it (`2026-H1`), otherwise the covered range. A format reads the
 * first day of the period: `MMMM yyyy` → "March 2026" / "mars 2026",
 * `MMM` → "Mar" / "mars", `yyyy-MM` → "2026-03".
 */
function renderPeriod(
	context: TitleTemplateContext,
	locale: ContentLocale,
	format?: string,
): string {
	const fallback =
		context.periodKey ?? formatPeriod(context.periodStart, context.periodEnd);
	if (!format) return fallback;
	const start = context.periodStart;
	if (!start) return "";
	return renderFormat(start, format, locale) ?? fallback;
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

/**
 * Replaces known placeholders; unknown ones are left as-is.
 *
 * `locale` is the **content** language (`content.locale`): it only shows in the
 * month names of `{date:MMMM}` and `{period:MMMM}`. A token that carries its
 * own language (`{period:MMMM yyyy|fr-FR}`) overrides it. It defaults to the
 * interface locale so that a caller rendering a preview for the screens — not a
 * stored title — does not have to reach for the settings.
 */
export function renderTitleTemplate(
	template: string,
	context: TitleTemplateContext,
	locale: ContentLocale = UI_LOCALE,
): string {
	const rendered = template.replace(
		PLACEHOLDER_RE,
		(whole, rawName: string, rawFormat?: string) => {
			// `MMMM yyyy|fr-FR`: the token says which language it wants.
			const { format, locale: pinned } = splitFormat(rawFormat);
			const spoken = pinned ?? locale;
			switch (rawName.toLowerCase()) {
				case "date":
					return context.date ? formatDate(context.date, spoken, format) : "";
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
					return renderPeriod(context, spoken, format);
				default:
					return whole;
			}
		},
	);
	return tidy(rendered);
}
