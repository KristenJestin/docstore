import { z } from "zod";

/**
 * Recurrence of a document type (SPEC §9).
 *
 * The period computation is **pure** and lives here: the API (timeline, stats)
 * and the ingestion (reminder generation) share exactly the same rules.
 * Every date is a `YYYY-MM-DD` string handled in UTC.
 *
 * This module used to be `series.ts`: document types absorbed Series, but the
 * arithmetic did not change (only `weekly` was added).
 */

export const PERIODICITIES = [
	"weekly",
	"monthly",
	"quarterly",
	"semiannual",
	"yearly",
] as const;
export const periodicitySchema = z.enum(PERIODICITIES);
export type Periodicity = z.infer<typeof periodicitySchema>;

export const PERIODICITY_LABELS: Record<Periodicity, string> = {
	weekly: "weekly",
	monthly: "monthly",
	quarterly: "quarterly",
	semiannual: "semiannual",
	yearly: "yearly",
};

/** Default grace period, in days, after the expected date. */
export const DEFAULT_GRACE_DAYS = 15;

/**
 * Minimum number of distinct periods before a recurrence is proposed, both by
 * `documentType.suggest` and by the `recurringCandidate` review reason. Two
 * documents on two different periods are already a pattern worth showing;
 * nothing is ever created automatically, the user always confirms.
 */
export const SUGGEST_MIN_SAMPLES = 2;

/* ------------------------------------------------------------------ */
/* Date arithmetic (UTC, dependency-free)                               */
/* ------------------------------------------------------------------ */

type YearMonthDay = { year: number; month: number; day: number };

function parseDate(iso: string): YearMonthDay {
	const [year, month, day] = iso.split("-").map(Number);
	if (
		year === undefined ||
		month === undefined ||
		day === undefined ||
		Number.isNaN(year) ||
		Number.isNaN(month) ||
		Number.isNaN(day)
	) {
		throw new Error(`Invalid date "${iso}" (expected format YYYY-MM-DD).`);
	}
	return { year, month, day };
}

/** Builds an ISO date, normalizing overflows (month 13 → year + 1). */
function makeDate(year: number, month: number, day: number): string {
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
	const { year, month, day } = parseDate(iso);
	return makeDate(year, month, day + days);
}

export function addMonths(iso: string, months: number): string {
	const { year, month, day } = parseDate(iso);
	return makeDate(year, month + months, day);
}

/** Number of days from `from` to `to` (negative when `to` is before). */
export function daysBetween(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	return Math.round((b - a) / 86_400_000);
}

/** Number of whole months from `from` to `to` (year and month only). */
export function monthsBetween(from: string, to: string): number {
	const a = parseDate(from);
	const b = parseDate(to);
	return (b.year - a.year) * 12 + (b.month - a.month);
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Today's date in `YYYY-MM-DD` format, in UTC. */
export function todayIso(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/** Day of the week, ISO numbering: 1 = Monday … 7 = Sunday. */
function isoWeekday(iso: string): number {
	const { year, month, day } = parseDate(iso);
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	return weekday === 0 ? 7 : weekday;
}

/** ISO 8601 week number and week-numbering year of a date. */
function isoWeek(iso: string): { year: number; week: number } {
	// The Thursday of the week decides which year the week belongs to.
	const thursday = addDays(iso, 4 - isoWeekday(iso));
	const { year } = parseDate(thursday);
	const firstThursday = makeDate(year, 1, 4);
	const firstMonday = addDays(firstThursday, -(isoWeekday(firstThursday) - 1));
	return { year, week: Math.round(daysBetween(firstMonday, thursday) / 7) + 1 };
}

/* ------------------------------------------------------------------ */
/* Periods                                                              */
/* ------------------------------------------------------------------ */

/** Number of months covered by one period; `0` for `weekly`. */
export function periodLengthInMonths(periodicity: Periodicity): number {
	switch (periodicity) {
		case "weekly":
			return 0;
		case "monthly":
			return 1;
		case "quarterly":
			return 3;
		case "semiannual":
			return 6;
		default:
			return 12;
	}
}

/** First day of the period containing `iso` (Monday for `weekly`). */
export function periodStartOf(periodicity: Periodicity, iso: string): string {
	if (periodicity === "weekly") return addDays(iso, -(isoWeekday(iso) - 1));
	const { year, month } = parseDate(iso);
	switch (periodicity) {
		case "monthly":
			return makeDate(year, month, 1);
		case "quarterly":
			return makeDate(year, Math.floor((month - 1) / 3) * 3 + 1, 1);
		case "semiannual":
			// Two halves a year: 1 January and 1 July.
			return makeDate(year, Math.floor((month - 1) / 6) * 6 + 1, 1);
		default:
			return makeDate(year, 1, 1);
	}
}

/** First day of the period following the one starting at `periodStart`. */
export function nextPeriodStart(
	periodicity: Periodicity,
	periodStart: string,
): string {
	return periodicity === "weekly"
		? addDays(periodStart, 7)
		: addMonths(periodStart, periodLengthInMonths(periodicity));
}

/** Last day of the period starting at `periodStart`. */
export function periodEndOf(
	periodicity: Periodicity,
	periodStart: string,
): string {
	return addDays(nextPeriodStart(periodicity, periodStart), -1);
}

/**
 * Readable key of a period: `2026-W09`, `2026-03`, `2026-Q1`, `2026-H1` or
 * `2026`.
 */
export function periodKeyOf(periodicity: Periodicity, iso: string): string {
	const start = periodStartOf(periodicity, iso);
	if (periodicity === "weekly") {
		const { year, week } = isoWeek(start);
		return `${String(year).padStart(4, "0")}-W${String(week).padStart(2, "0")}`;
	}
	const { year, month } = parseDate(start);
	const yyyy = String(year).padStart(4, "0");
	switch (periodicity) {
		case "monthly":
			return `${yyyy}-${String(month).padStart(2, "0")}`;
		case "quarterly":
			return `${yyyy}-Q${Math.floor((month - 1) / 3) + 1}`;
		case "semiannual":
			return `${yyyy}-H${Math.floor((month - 1) / 6) + 1}`;
		default:
			return yyyy;
	}
}

/**
 * Period starts from `from` to `to` inclusive (bounds snapped to their own
 * period). Returns an empty list when `to` is before `from`.
 */
export function enumeratePeriods(
	periodicity: Periodicity,
	from: string,
	to: string,
): string[] {
	const last = periodStartOf(periodicity, to);
	let current = periodStartOf(periodicity, from);
	const periods: string[] = [];
	// Guard: a recurrence never covers more than 1200 periods.
	while (current <= last && periods.length < 1200) {
		periods.push(current);
		current = nextPeriodStart(periodicity, current);
	}
	return periods;
}

/**
 * Expected arrival date of the document for a period.
 *
 * `expectedDay` is a day of the month applied to the **last month of the
 * period** (clamped to the number of days in that month); for `weekly` it is an
 * ISO weekday (1 = Monday … 7 = Sunday). Without it, the last day of the period
 * is used. The usual lateness is absorbed by `graceDays`.
 */
export function expectedDateOf(
	periodicity: Periodicity,
	periodStart: string,
	expectedDay: number | null,
): string {
	const end = periodEndOf(periodicity, periodStart);
	if (expectedDay === null) return end;
	if (periodicity === "weekly") {
		return addDays(periodStart, Math.min(Math.max(expectedDay, 1), 7) - 1);
	}
	const { year, month } = parseDate(end);
	return makeDate(year, month, Math.min(expectedDay, daysInMonth(year, month)));
}

/** Due date of a period: expected date + grace period. */
export function dueDateOf(
	periodicity: Periodicity,
	periodStart: string,
	expectedDay: number | null,
	graceDays: number,
): string {
	return addDays(
		expectedDateOf(periodicity, periodStart, expectedDay),
		graceDays,
	);
}

/* ------------------------------------------------------------------ */
/* Schemas                                                              */
/* ------------------------------------------------------------------ */

export const PERIOD_STATUSES = ["present", "missing", "pending"] as const;
export const periodStatusSchema = z.enum(PERIOD_STATUSES);
export type PeriodStatus = z.infer<typeof periodStatusSchema>;

export const recurrenceStatsSchema = z.object({
	/** Periods already due or covered (`present` + `missing`). */
	expected: z.int().min(0),
	present: z.int().min(0),
	/** Keys of the missing periods (`2026-03`, `2026-Q1`, `2026-H1`, `2026`). */
	missing: z.array(z.string()),
	/** Last period covered by a document, `null` when there is none. */
	lastPeriod: z.string().nullable(),
});
export type RecurrenceStats = z.infer<typeof recurrenceStatsSchema>;

export const recurrencePeriodSchema = z.object({
	/** Readable key of the period. */
	period: z.string(),
	/** First day of the period (`YYYY-MM-DD`). */
	periodStart: z.string(),
	/** Expected date + `graceDays`. */
	dueDate: z.string(),
	documentId: z.string().nullable(),
	documentTitle: z.string().nullable(),
	status: periodStatusSchema,
});
export type RecurrencePeriod = z.infer<typeof recurrencePeriodSchema>;

/**
 * How a document belongs to a recurring document type: `computed` (type
 * assigned, or issuer + category match), or `forced`/`excluded` through a
 * `document_type_override` row.
 */
export const MEMBERSHIP_KINDS = ["computed", "forced", "excluded"] as const;
export const membershipKindSchema = z.enum(MEMBERSHIP_KINDS);
export type MembershipKind = z.infer<typeof membershipKindSchema>;

/* ------------------------------------------------------------------ */
/* Inference                                                            */
/* ------------------------------------------------------------------ */

function median(values: number[], fallback: number): number {
	if (values.length === 0) return fallback;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] ?? fallback)
		: ((sorted[middle - 1] ?? fallback) + (sorted[middle] ?? fallback)) / 2;
}

/**
 * Periodicity inferred from the median gap **in days** between two successive
 * observed periods: ≤ 10 days → weekly, ≤ 45 → monthly, ≤ 120 → quarterly,
 * ≤ 220 → semiannual (a half-year runs 181 to 184 days), beyond → yearly. An
 * empty list (a single observation) falls back to `monthly`.
 */
export function periodicityFromDayGaps(gaps: number[]): Periodicity {
	const value = median(gaps, 30);
	if (value <= 10) return "weekly";
	if (value <= 45) return "monthly";
	if (value <= 120) return "quarterly";
	if (value <= 220) return "semiannual";
	return "yearly";
}

/**
 * Day gaps between the successive period starts of `periods` (already sorted,
 * `YYYY-MM-DD`).
 */
export function dayGapsBetween(periods: string[]): number[] {
	const gaps: number[] = [];
	for (let index = 1; index < periods.length; index++) {
		const previous = periods[index - 1];
		const current = periods[index];
		if (previous && current) gaps.push(daysBetween(previous, current));
	}
	return gaps;
}
