import type { DatePrecision } from "@docstore/shared/document";
import { DATE_PRECISIONS } from "@docstore/shared/document";
import {
	Calendar,
	MonthGrid,
	YearGrid,
} from "@docstore/ui/components/calendar";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@docstore/ui/components/input-group";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@docstore/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { cn } from "@docstore/ui/lib/utils";
import { CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
	DATE_PRECISION_ICONS,
	DATE_PRECISION_LABELS,
} from "./documents/document-labels";
import { IconLabel, iconLabelItems } from "./icon-label";

/**
 * `DatePicker` — text field in `en-GB` ("15 Mar 2024") backed by a calendar
 * popover, and `DatePrecisionPicker`, the precision-aware variant used
 * everywhere a document date is edited (SPEC §2 "`date_precision`").
 *
 * The value stays the `YYYY-MM-DD` string the API expects; a month is stored on
 * its first day, a year on its first of January.
 */

const DISPLAY_FORMATTERS: Record<DatePrecision, Intl.DateTimeFormat> = {
	day: new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
	}),
	month: new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }),
	year: new Intl.DateTimeFormat("en-GB", { year: "numeric" }),
};

const PLACEHOLDERS: Record<DatePrecision, string> = {
	day: "15 Mar 2024",
	month: "Mar 2024",
	year: "2024",
};

/** Month names accepted when typing, both short and long, lower cased. */
const MONTH_NAMES: string[] = Array.from({ length: 12 }, (_, month) =>
	new Intl.DateTimeFormat("en-GB", { month: "long" })
		.format(new Date(2024, month, 1))
		.toLowerCase(),
);

/** `YYYY-MM-DD` → local `Date` (no time zone shift on the displayed day). */
export function isoToDate(value: string | null | undefined): Date | null {
	if (!value) {
		return null;
	}
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
	if (!match) {
		return null;
	}
	const [, year, month, day] = match;
	return new Date(Number(year), Number(month) - 1, Number(day));
}

/** Local `Date` → `YYYY-MM-DD`. */
export function dateToIso(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** Normalises a date to the first day of its month or year. */
function truncate(iso: string, precision: DatePrecision): string {
	if (precision === "year") {
		return `${iso.slice(0, 4)}-01-01`;
	}
	if (precision === "month") {
		return `${iso.slice(0, 7)}-01`;
	}
	return iso;
}

/** "15 Mar 2024" / "Mar 2024" / "2024" — empty when there is no date. */
export function formatDateValue(
	value: string | null,
	precision: DatePrecision = "day",
): string {
	const date = isoToDate(value);
	return date ? DISPLAY_FORMATTERS[precision].format(date) : "";
}

/** Index of a month typed by name ("mar", "March"), or `null`. */
function monthFromName(name: string): number | null {
	const needle = name.toLowerCase();
	const index = MONTH_NAMES.findIndex(
		(month) => month === needle || month.slice(0, 3) === needle.slice(0, 3),
	);
	return index === -1 ? null : index;
}

/**
 * Reads what the user typed. Accepts the displayed form ("15 Mar 2024"), the
 * ISO form ("2024-03-15") and the en-GB numeric form ("15/03/2024"); a month
 * precision also accepts "Mar 2024" and "03/2024", a year just "2024".
 */
export function parseDateInput(
	raw: string,
	precision: DatePrecision,
): string | null {
	const text = raw.trim();
	if (text.length === 0) {
		return null;
	}

	if (precision === "year") {
		return /^\d{4}$/.test(text) ? `${text}-01-01` : null;
	}

	const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
	if (iso) {
		const [, year, month, day] = iso;
		return build(
			Number(year),
			Number(month) - 1,
			day ? Number(day) : 1,
			precision,
		);
	}

	const named = /^(?:(\d{1,2})\s+)?([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(text);
	if (named) {
		const [, day, name, year] = named;
		const month = monthFromName(name ?? "");
		if (month === null) {
			return null;
		}
		return build(Number(year), month, day ? Number(day) : 1, precision);
	}

	const numeric = /^(\d{1,2})[/.-](?:(\d{1,2})[/.-])?(\d{4})$/.exec(text);
	if (numeric) {
		const [, first, second, year] = numeric;
		// en-GB is day first: "15/03/2024". Without a second group the field is a
		// month ("03/2024").
		const day = second ? Number(first) : 1;
		const month = Number(second ?? first) - 1;
		return build(Number(year), month, day, precision);
	}

	return null;
}

/** Builds a valid `YYYY-MM-DD`, or `null` when the parts make no sense. */
function build(
	year: number,
	month: number,
	day: number,
	precision: DatePrecision,
): string | null {
	if (month < 0 || month > 11 || day < 1 || day > 31 || year < 1000) {
		return null;
	}
	const date = new Date(year, month, day);
	if (date.getMonth() !== month || date.getDate() !== day) {
		return null;
	}
	return truncate(dateToIso(date), precision);
}

export interface DatePickerProps {
	/** Date in `YYYY-MM-DD` form (Postgres `date` column), or `null`. */
	value: string | null;
	onValueChange: (value: string | null) => void;
	/** Granularity of the grid and of the display. Defaults to `day`. */
	precision?: DatePrecision;
	/** Accessible name of the field. */
	label?: string;
	placeholder?: string;
	id?: string;
	disabled?: boolean;
	className?: string;
}

/**
 * Date field: the text stays editable (en-GB shapes are all accepted) and the
 * calendar button opens the grid matching the precision.
 */
export function DatePicker({
	value,
	onValueChange,
	precision = "day",
	label = "Date",
	placeholder,
	id,
	disabled = false,
	className,
}: DatePickerProps) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(() => formatDateValue(value, precision));
	const [invalid, setInvalid] = useState(false);

	// The field is often driven from the outside (another document, a reset):
	// the text follows the value unless the user is mid-edit.
	useEffect(() => {
		setDraft(formatDateValue(value, precision));
		setInvalid(false);
	}, [value, precision]);

	const commit = (raw: string) => {
		if (raw.trim().length === 0) {
			setInvalid(false);
			if (value !== null) {
				onValueChange(null);
			}
			return;
		}
		const parsed = parseDateInput(raw, precision);
		if (parsed === null) {
			setInvalid(true);
			return;
		}
		setInvalid(false);
		setDraft(formatDateValue(parsed, precision));
		if (parsed !== value) {
			onValueChange(parsed);
		}
	};

	const select = (iso: string) => {
		setOpen(false);
		setInvalid(false);
		setDraft(formatDateValue(iso, precision));
		onValueChange(iso);
	};

	const selected = isoToDate(value);

	return (
		<InputGroup className={cn("w-auto", className)}>
			<InputGroupInput
				id={id}
				aria-label={label}
				aria-invalid={invalid || undefined}
				disabled={disabled}
				autoComplete="off"
				placeholder={placeholder ?? PLACEHOLDERS[precision]}
				value={draft}
				className="font-mono tabular-nums"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={(event) => commit(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit(draft);
					}
				}}
			/>
			<InputGroupAddon align="inline-end">
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger
						render={
							<InputGroupButton
								size="icon-sm"
								variant="ghost"
								disabled={disabled}
								aria-label={`Open the calendar of ${label.toLowerCase()}`}
							/>
						}
					>
						<CalendarIcon />
					</PopoverTrigger>
					<PopoverContent align="end" className="w-auto">
						{precision === "day" ? (
							<Calendar
								label={label}
								value={selected}
								onSelect={(date) => select(dateToIso(date))}
							/>
						) : precision === "month" ? (
							<MonthGrid
								label={label}
								value={
									selected
										? {
												year: selected.getFullYear(),
												month: selected.getMonth(),
											}
										: null
								}
								onSelect={({ year, month }) =>
									select(dateToIso(new Date(year, month, 1)))
								}
							/>
						) : (
							<YearGrid
								label={label}
								value={selected ? selected.getFullYear() : null}
								onSelect={(year) => select(`${year}-01-01`)}
							/>
						)}
					</PopoverContent>
				</Popover>
			</InputGroupAddon>
		</InputGroup>
	);
}

/** Items of the precision select: icon + capitalised label. */
const PRECISION_ITEMS = iconLabelItems(
	DATE_PRECISIONS,
	DATE_PRECISION_LABELS,
	DATE_PRECISION_ICONS,
);

export interface DatePrecisionPickerProps {
	value: string | null;
	precision: DatePrecision;
	/**
	 * Called on every date or precision change. The date is normalised to the
	 * first day of the month or year, depending on the precision.
	 */
	onChange: (value: string | null, precision: DatePrecision) => void;
	id?: string;
	label?: string;
	disabled?: boolean;
	className?: string;
}

/**
 * Date plus its precision: the select switches the picker between a day grid,
 * a twelve-month grid and a year list, and re-truncates the current value.
 */
export function DatePrecisionPicker({
	value,
	precision,
	onChange,
	id,
	label = "Document date",
	disabled = false,
	className,
}: DatePrecisionPickerProps) {
	return (
		<div className={cn("flex items-center gap-2", className)}>
			<DatePicker
				id={id}
				label={label}
				value={value}
				precision={precision}
				disabled={disabled}
				className="min-w-0 flex-1"
				onValueChange={(next) => onChange(next, precision)}
			/>
			<Select
				items={PRECISION_ITEMS}
				value={precision}
				disabled={disabled}
				onValueChange={(next) => {
					const nextPrecision = next as DatePrecision;
					onChange(
						value ? truncate(value, nextPrecision) : null,
						nextPrecision,
					);
				}}
			>
				<SelectTrigger aria-label="Date precision" className="w-32 shrink-0">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{DATE_PRECISIONS.map((item) => (
						<SelectItem key={item} value={item}>
							<IconLabel
								icon={DATE_PRECISION_ICONS[item]}
								label={DATE_PRECISION_LABELS[item]}
							/>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
