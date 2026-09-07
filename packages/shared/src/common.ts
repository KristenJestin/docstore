import { z } from "zod";

/**
 * Origin of an automatic or manual assignment (party, tag, category,
 * field…). Lives here (rather than in `document.ts`) so it can be imported by
 * `category.ts` and `tag.ts` without a circular dependency.
 */
export const ASSIGNMENT_SOURCES = ["manual", "rule", "mcp"] as const;
export const assignmentSourceSchema = z.enum(ASSIGNMENT_SOURCES);
export type AssignmentSource = z.infer<typeof assignmentSourceSchema>;

/** Display color: short or long hexadecimal, normalized to lowercase. */
export const hexColorSchema = z
	.string()
	.trim()
	.regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
		message: "Color must be in hexadecimal format (#rrggbb).",
	});

/**
 * Postgres `date` columns travel as `YYYY-MM-DD`.
 *
 * The message is spelled out: Zod's default ("Invalid ISO date") says nothing
 * about the expected shape, and this schema backs every date field of the API.
 */
export const DATE_ONLY_MESSAGE = "Expected a date as YYYY-MM-DD";
export const dateOnlySchema = z.iso.date({ message: DATE_ONLY_MESSAGE });

/** Message shared by every `expiresAt` field. */
export const FUTURE_EXPIRY_MESSAGE = "The expiry date must be in the future.";

/**
 * ISO 8601 instant that has not passed yet.
 *
 * Used by every credential-like object (share link, upload link, API key): an
 * expiry already behind us creates something dead on arrival, which is never
 * what the caller meant.
 */
export const futureDatetimeSchema = z.iso
	.datetime({ offset: true })
	.refine((value) => Date.parse(value) > Date.now(), {
		message: FUTURE_EXPIRY_MESSAGE,
	});

/** URL-safe identifier: lowercase letters, digits and hyphens. */
export const slugSchema = z
	.string()
	.trim()
	.min(1)
	.max(120)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
		message: "Slug can only contain lowercase letters, digits and hyphens.",
	});

/**
 * Lucide icon name in kebab-case (`receipt`, `file-signature`…), stored as-is
 * by categories and document types. Loose on purpose (no `slugSchema`
 * grouping/edge rules): Lucide names are machine-generated, so the only real
 * invariant is the character set.
 */
export const iconNameSchema = z
	.string()
	.trim()
	.min(1)
	.max(60)
	.regex(/^[a-z0-9-]+$/, {
		message:
			"Icon must be a lowercase Lucide icon name (letters, digits and hyphens).",
	});

/**
 * Turns a label into a slug: no accents, lowercase, hyphens.
 *
 * @example slugify("Payslip") // "payslip"
 * @example slugify("Invoice number") // "invoice-number"
 */
export function slugify(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 120)
		.replace(/-+$/g, "");
}

/* ------------------------------------------------------------------ */
/* Content language                                                     */
/* ------------------------------------------------------------------ */

/**
 * Language of the text the application **generates**: titles built from a
 * template, exported file names, dates written inside an export or a reminder
 * payload.
 *
 * It is not the language of the interface, which stays English whatever this
 * says (see AGENTS.md, "Every user-visible string is in English").
 */
export const CONTENT_LOCALES = ["en-GB", "fr-FR"] as const;
export const contentLocaleSchema = z.enum(CONTENT_LOCALES);
export type ContentLocale = z.infer<typeof contentLocaleSchema>;

/**
 * English until told otherwise: the same language as the interface, so a fresh
 * install generates text that matches what it says on screen.
 */
export const DEFAULT_CONTENT_LOCALE: ContentLocale = "en-GB";

/**
 * Locale of everything the user reads *in the application*: the screens, the
 * API messages and the MCP answers. Always English.
 */
export const UI_LOCALE: ContentLocale = "en-GB";

/**
 * Formats a `YYYY-MM-DD` date in the given content language. Returns the input
 * unchanged if it cannot be parsed.
 *
 * @example formatContentDate("2026-10-08", "en-GB") // "8 Oct 2026"
 * @example formatContentDate("2026-10-08", "fr-FR") // "8 oct. 2026"
 */
export function formatContentDate(
	isoDate: string,
	locale: ContentLocale,
): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return isoDate;
	return new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	}).format(date);
}

/**
 * Formats a `YYYY-MM-DD` date as en-GB (`8 Oct 2026`): the interface and every
 * message the application phrases in English.
 *
 * @example formatDateEnGb("2026-10-08") // "8 Oct 2026"
 */
export function formatDateEnGb(isoDate: string): string {
	return formatContentDate(isoDate, UI_LOCALE);
}
