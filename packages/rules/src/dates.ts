import type { DatePrecision, DateSource } from "@docstore/shared/document";

/**
 * Recognition of French dates.
 *
 * Used in two places: the `date_fr` / `month_fr` postprocessing of extraction
 * rules (SPEC §4) and the automatic suggestion of `documentDate` and `period`
 * at ingestion time (SPEC §5, `analyze` step).
 */

export interface DateCandidate {
	/** Normalized date `YYYY-MM-DD` (first day of the month when precision is `month`). */
	date: string;
	precision: DatePrecision;
	/** Original text. */
	raw: string;
	/** Position of the first character in the source text. */
	index: number;
}

export interface PeriodCandidate {
	start: string;
	end: string;
	raw: string;
	index: number;
}

const MONTHS_BY_NAME: Record<string, number> = {
	janvier: 1,
	janv: 1,
	jan: 1,
	fevrier: 2,
	fevr: 2,
	fev: 2,
	mars: 3,
	avril: 4,
	avr: 4,
	mai: 5,
	juin: 6,
	juillet: 7,
	juil: 7,
	jul: 7,
	aout: 8,
	septembre: 9,
	sept: 9,
	sep: 9,
	octobre: 10,
	oct: 10,
	novembre: 11,
	nov: 11,
	decembre: 12,
	dec: 12,
};

/** Lowercase, without accents or trailing dot: "Déc." -> "dec". */
function normalizeWord(value: string): string {
	return value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/\.+$/, "")
		.trim();
}

export function monthFromName(value: string): number | null {
	return MONTHS_BY_NAME[normalizeWord(value)] ?? null;
}

function pad(value: number, size: number): string {
	return String(value).padStart(size, "0");
}

/** Two-digit years: 00-68 -> 2000-2068, 69-99 -> 1969-1999. */
function expandYear(value: string): number {
	const year = Number(value);
	if (value.length === 4) return year;
	return year <= 68 ? 2000 + year : 1900 + year;
}

function isRealDate(year: number, month: number, day: number): boolean {
	if (month < 1 || month > 12 || day < 1 || day > 31) return false;
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

export function formatDate(year: number, month: number, day: number): string {
	return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Fragments reused to compose the period patterns. */
const NUMERIC_DATE = String.raw`\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}`;
const ISO_DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const LITERAL_DATE = String.raw`\d{1,2}(?:er)?\s+[A-Za-zÀ-ÿ]{3,10}\.?\s+\d{4}`;
const ANY_DATE = `${LITERAL_DATE}|${ISO_DATE}|${NUMERIC_DATE}`;

const ISO_RE = new RegExp(String.raw`\b${ISO_DATE}\b`, "g");
const NUMERIC_RE = new RegExp(String.raw`\b${NUMERIC_DATE}\b`, "g");
const LITERAL_RE = new RegExp(String.raw`\b${LITERAL_DATE}\b`, "gi");
const LITERAL_MONTH_RE = /\b([A-Za-zÀ-ÿ]{3,10})\.?\s+(\d{4})\b/gi;
const NUMERIC_MONTH_RE = /\b(0?[1-9]|1[0-2])[/.-](\d{4})\b/g;
const ISO_MONTH_RE = /\b(\d{4})-(0?[1-9]|1[0-2])\b/g;

/**
 * Parses a standalone date. Recognized formats: `DD/MM/YYYY` (and `.`, `-`),
 * `YYYY-MM-DD`, `12 octobre 2025`, `12 oct. 2025`, `1er mars 2024`.
 */
export function parseFrenchDate(
	value: string,
): { date: string; precision: DatePrecision } | null {
	const text = value.trim();

	const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (iso?.[1] && iso[2] && iso[3]) {
		const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
		if (!isRealDate(year, month, day)) return null;
		return { date: formatDate(year, month, day), precision: "day" };
	}

	const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
	if (numeric?.[1] && numeric[2] && numeric[3]) {
		const day = Number(numeric[1]);
		const month = Number(numeric[2]);
		const year = expandYear(numeric[3]);
		if (!isRealDate(year, month, day)) return null;
		return { date: formatDate(year, month, day), precision: "day" };
	}

	const literal = /^(\d{1,2})(?:er)?\s+([A-Za-zÀ-ÿ]{3,10})\.?\s+(\d{4})$/i.exec(
		text,
	);
	if (literal?.[1] && literal[2] && literal[3]) {
		const month = monthFromName(literal[2]);
		if (month === null) return null;
		const day = Number(literal[1]);
		const year = Number(literal[3]);
		if (!isRealDate(year, month, day)) return null;
		return { date: formatDate(year, month, day), precision: "day" };
	}

	return null;
}

/**
 * Parses a standalone month: "Décembre 2025", "déc. 2025", "12/2025",
 * "2025-12". Returns the first day of the month with `month` precision.
 */
export function parseFrenchMonth(
	value: string,
): { date: string; precision: DatePrecision } | null {
	const text = value.trim();

	const literal = /^([A-Za-zÀ-ÿ]{3,10})\.?\s+(\d{4})$/i.exec(text);
	if (literal?.[1] && literal[2]) {
		const month = monthFromName(literal[1]);
		if (month !== null) {
			return {
				date: formatDate(Number(literal[2]), month, 1),
				precision: "month",
			};
		}
	}

	const numeric = /^(0?[1-9]|1[0-2])[/.-](\d{4})$/.exec(text);
	if (numeric?.[1] && numeric[2]) {
		return {
			date: formatDate(Number(numeric[2]), Number(numeric[1]), 1),
			precision: "month",
		};
	}

	const iso = /^(\d{4})-(0?[1-9]|1[0-2])$/.exec(text);
	if (iso?.[1] && iso[2]) {
		return {
			date: formatDate(Number(iso[1]), Number(iso[2]), 1),
			precision: "month",
		};
	}

	// A full date is still a valid month, brought back to the first of the month.
	const full = parseFrenchDate(text);
	if (full) {
		return { date: `${full.date.slice(0, 7)}-01`, precision: "month" };
	}
	return null;
}

type Span = { start: number; end: number };

function collides(spans: Span[], start: number, end: number): boolean {
	return spans.some((span) => start < span.end && end > span.start);
}

/**
 * All dates in the text, in order of appearance. Day precision wins:
 * "12 octobre 2025" is not also reported as "octobre 2025".
 */
export function detectDates(text: string): DateCandidate[] {
	const spans: Span[] = [];
	const candidates: DateCandidate[] = [];

	const collect = (
		regex: RegExp,
		parse: (raw: string) => { date: string; precision: DatePrecision } | null,
	): void => {
		for (const match of text.matchAll(regex)) {
			const raw = match[0];
			const index = match.index ?? 0;
			if (collides(spans, index, index + raw.length)) continue;
			const parsed = parse(raw);
			if (!parsed) continue;
			spans.push({ start: index, end: index + raw.length });
			candidates.push({ ...parsed, raw, index });
		}
	};

	collect(LITERAL_RE, parseFrenchDate);
	collect(ISO_RE, parseFrenchDate);
	collect(NUMERIC_RE, parseFrenchDate);
	collect(LITERAL_MONTH_RE, parseFrenchMonth);
	collect(NUMERIC_MONTH_RE, parseFrenchMonth);
	collect(ISO_MONTH_RE, parseFrenchMonth);

	return candidates.sort((a, b) => a.index - b.index);
}

/**
 * Covered period: "du … au …", "période du … au …", "from … to …",
 * "period from … to …". The leading "période"/"period" is optional — the
 * bounds are what identify the pattern.
 */
const PERIOD_RE = new RegExp(
	String.raw`\b(?:du|from)\s+(${ANY_DATE})\s+(?:au|jusqu['’]au|to|through)\s+(${ANY_DATE})`,
	"gi",
);

/** "Période du 1er janvier 2025 au 31/01/2025" -> normalized bounds. */
export function detectExplicitPeriods(text: string): PeriodCandidate[] {
	const periods: PeriodCandidate[] = [];
	for (const match of text.matchAll(PERIOD_RE)) {
		const from = match[1];
		const to = match[2];
		if (!from || !to) continue;
		const start = parseFrenchDate(from);
		const end = parseFrenchDate(to);
		if (!start || !end) continue;
		// "du 31/08 au 01/08" is a mis-read, not a period.
		if (end.date < start.date) continue;
		periods.push({
			start: start.date,
			end: end.date,
			raw: match[0],
			index: match.index ?? 0,
		});
	}
	return periods;
}

/* ------------------------------------------------------------------ */
/* Meter readings                                                       */
/* ------------------------------------------------------------------ */

/** Words qualifying a reading: "relevé précédent", "ancien index"… */
const READING_QUALIFIER = String.raw`(?:pr[ée]c[ée]dent[e]?|ant[ée]rieur[e]?|ancien(?:ne)?|actuel(?:le)?|nouveau|nouvel(?:le)?|dernier|derni[èe]re|initial[e]?|final[e]?|de\s+d[ée]but|de\s+fin|previous|current|last)`;

/** The reading itself, in the two languages the pipeline reads. */
const READING_LABEL = "(?:relev[ée]s?|index|lecture|reading)";

/**
 * A reading and the date it was taken, whichever side the qualifier sits on:
 * "relevé du 12/03/2026", "relevé précédent 10/09/2025", "ancien index :
 * 10/09/2025", "index au 12 mars 2026".
 */
const READING_RE = new RegExp(
	String.raw`(?:${READING_QUALIFIER}\s+)?${READING_LABEL}(?:\s+${READING_QUALIFIER})?\s*:?\s*(?:du\s+|le\s+|au\s+|on\s+|of\s+)?(${ANY_DATE})`,
	"gi",
);

/**
 * Period covered by a water or energy bill, read off its two meter readings.
 *
 * These bills rarely say "du … au …": they print the two readings that bound
 * the consumption, in whichever order the supplier likes ("relevé du
 * 12/03/2026" next to "relevé précédent 10/09/2025"). Two dates is what makes
 * a period, so the earliest and the latest are taken as its bounds — not the
 * order they appear in.
 *
 * `null` with fewer than two distinct reading dates: one reading is a date, not
 * a period.
 */
export function detectReadingPeriod(text: string): PeriodCandidate | null {
	const readings: { date: string; raw: string; index: number }[] = [];
	for (const match of text.matchAll(READING_RE)) {
		const raw = match[1];
		if (!raw) continue;
		const parsed = parseFrenchDate(raw);
		if (!parsed) continue;
		readings.push({
			date: parsed.date,
			raw,
			index: (match.index ?? 0) + match[0].lastIndexOf(raw),
		});
	}

	const dates = [...new Set(readings.map((reading) => reading.date))].sort();
	const start = dates[0];
	const end = dates.at(-1);
	if (!start || !end || start === end) return null;

	return {
		start,
		end,
		raw: `${start} … ${end}`,
		index: Math.min(...readings.map((reading) => reading.index)),
	};
}

/* ------------------------------------------------------------------ */
/* Yearly documents                                                     */
/* ------------------------------------------------------------------ */

/**
 * Statements naming a whole year: "année 2025", "au titre de l'année 2025",
 * "revenus 2025", "exercice 2025", "tax year 2025".
 *
 * The year is required to look like one (`19xx`/`20xx`), so an amount or a
 * meter index never passes for one.
 */
const YEAR_PERIOD_RE =
	/\b(?:ann[ée]e|revenus|exercice|p[ée]riode\s+fiscale|tax\s+year|fiscal\s+year|year)\s*(?:fiscale?\s*)?(?:de\s+|d['’]\s*|:\s*)?((?:19|20)\d{2})\b/gi;

/**
 * The whole year a document covers, when its text names one.
 *
 * A tax notice, an annual statement or a yearly summary carries no "du … au …"
 * and often no date at all: what it says is "au titre de l'année 2025", and
 * that is a period — the whole of 2025.
 */
export function detectYearPeriod(text: string): PeriodCandidate | null {
	for (const match of text.matchAll(YEAR_PERIOD_RE)) {
		const year = match[1];
		if (!year) continue;
		return {
			start: `${year}-01-01`,
			end: `${year}-12-31`,
			raw: match[0],
			index: match.index ?? 0,
		};
	}
	return null;
}

/**
 * Covered period of a document, best statement first.
 *
 * An explicit "du … au …" wins. Failing one, the two meter readings of a
 * utility bill bound the consumption, and a document naming a year covers that
 * year. Only the first of the three that answers is returned: they describe
 * the same thing, and a bill that spells its period out has no need of its
 * readings.
 */
export function detectPeriods(text: string): PeriodCandidate[] {
	const explicit = detectExplicitPeriods(text);
	if (explicit.length > 0) return explicit;

	const reading = detectReadingPeriod(text);
	if (reading) return [reading];

	const yearly = detectYearPeriod(text);
	return yearly ? [yearly] : [];
}

/**
 * Labels introducing the date a document was issued or paid.
 *
 * Accented and unaccented spellings are both matched in place (`[ée]`) rather
 * than by stripping the diacritics: removing them would shift every index and
 * the candidates carry their position in the source text.
 */
const ISSUE_DATE_LABEL = String.raw`(?:pay[ée]e?\s+le|date\s+de\s+paiement|date\s+de\s+r[èe]glement|[ée]tabli[e]?\s+le|date\s+d['’][ée]mission|[ée]mise?\s+le|fait\s+le|paid\s+on|payment\s+date|issued\s+on|issue\s+date|date\s+of\s+issue)`;

const ISSUE_DATE_RE = new RegExp(
	String.raw`${ISSUE_DATE_LABEL}\s*:?\s*(?:le\s+|on\s+)?(${ANY_DATE})`,
	"gi",
);

/**
 * Date the document was issued or paid, when the text says so explicitly.
 *
 * A payslip carries its period ("du 01/08/2026 au 31/08/2026") *and* its
 * payment date: taking the first date of the text would file it on the first
 * day of the period, which is not when the document exists.
 */
export function detectIssueDate(text: string): DateCandidate | null {
	for (const match of text.matchAll(ISSUE_DATE_RE)) {
		const raw = match[1];
		if (!raw) continue;
		const parsed = parseFrenchDate(raw);
		if (!parsed) continue;
		return {
			...parsed,
			raw,
			index: (match.index ?? 0) + match[0].lastIndexOf(raw),
		};
	}
	return null;
}

/**
 * Confidence of a date the text introduces itself ("payé le", "issued on") or
 * that is a bound of the covered period it spells out. Both are read from an
 * explicit statement, not guessed: they sit above the review threshold.
 */
export const LABELLED_DATE_CONFIDENCE = 0.9;

/**
 * Confidence of the bare "first date found in the text": the only case where
 * the pipeline is really guessing, and the only one worth telling the user
 * about.
 */
export const INFERRED_DATE_CONFIDENCE = 0.6;

export interface DocumentDatePick {
	candidate: DateCandidate;
	/** Never `manual`: this function only ever reads the document. */
	source: Exclude<DateSource, "manual">;
	confidence: number;
}

export interface DocumentDateInput {
	/** OCR text of the document. */
	text: string;
	/** Dates already detected in that text, in order of appearance. */
	detectedDates?: readonly DateCandidate[] | undefined;
	/** Covered period of the document, when it has one. */
	periodStart?: string | null | undefined;
	periodEnd?: string | null | undefined;
}

/**
 * Date of a document read off its text, with where it comes from.
 *
 * An explicit label wins over everything. Failing one, a document whose whole
 * period is the year its text names is dated by that year — "au titre de
 * l'année 2025" is the only date a tax notice carries, and pinning it to a
 * printing date would file it under the wrong year. Failing that, the first
 * date that is not a bound of the covered period is taken — those describe the
 * period, not the document — and only that last resort is a guess worth
 * flagging. A date that *is* a bound of a period the document carries is the
 * period's own date, read from a "du … au …" statement: it is trusted like a
 * labelled one.
 */
export function pickDocumentDate(
	input: DocumentDateInput,
): DocumentDatePick | null {
	const labelled = detectIssueDate(input.text);
	if (labelled) {
		return {
			candidate: labelled,
			source: "labelled",
			confidence: LABELLED_DATE_CONFIDENCE,
		};
	}

	// Only when that year really is the document's period: a payslip that
	// happens to mention "année 2025" keeps its own date.
	const yearly = detectYearPeriod(input.text);
	const noPeriod = !input.periodStart && !input.periodEnd;
	if (
		yearly &&
		(noPeriod ||
			(input.periodStart === yearly.start && input.periodEnd === yearly.end))
	) {
		return {
			candidate: {
				date: yearly.start,
				precision: "year",
				raw: yearly.raw,
				index: yearly.index,
			},
			source: "period",
			confidence: LABELLED_DATE_CONFIDENCE,
		};
	}

	const detected = input.detectedDates ?? [];
	const bounds = new Set(
		[input.periodStart, input.periodEnd].filter(
			(value): value is string => typeof value === "string",
		),
	);
	const candidate =
		detected.find((item) => !bounds.has(item.date)) ?? detected[0];
	if (!candidate) return null;

	return bounds.has(candidate.date)
		? {
				candidate,
				source: "period",
				confidence: LABELLED_DATE_CONFIDENCE,
			}
		: {
				candidate,
				source: "inferred",
				confidence: INFERRED_DATE_CONFIDENCE,
			};
}
