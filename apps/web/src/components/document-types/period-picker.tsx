import type { Periodicity } from "@docstore/shared/recurrence";
import { YearGrid } from "@docstore/ui/components/calendar";
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
	ToggleGroup,
	ToggleGroupItem,
} from "@docstore/ui/components/toggle-group";
import { cn } from "@docstore/ui/lib/utils";
import { ArrowRightIcon, CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
	DatePicker,
	dateToIso,
	formatDateValue,
	isoToDate,
} from "@/components/date-picker";

/**
 * Period field of a recurrence: the control follows the periodicity — a day
 * picker snapped to the Monday (weekly), a month grid ("Sep 2026"), a year plus
 * a segmented quarter ("Q3 2026") or a year list ("2026"). The stored value
 * stays the first day of the period, the format the API expects.
 */

/** Zero-based first month of each quarter. */
const QUARTER_MONTHS = [0, 3, 6, 9] as const;

const QUARTERS = [1, 2, 3, 4] as const;

/** `YYYY-MM-DD` → `{ year, month }`, or `null` when the period is empty. */
function partsOf(value: string | null): { year: number; month: number } | null {
	const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value ?? "");
	if (!match) {
		return null;
	}
	return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

/** First day of the period holding a `YYYY-MM-DD` date, for a periodicity. */
export function toPeriodStart(iso: string, periodicity: Periodicity): string {
	if (periodicity === "weekly") {
		// Back to the Monday of that week; `getDay()` is Sunday-based.
		const date = isoToDate(iso) ?? new Date();
		date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
		return dateToIso(date);
	}
	const year = Number(iso.slice(0, 4));
	const month = Number(iso.slice(5, 7)) - 1;
	const first =
		periodicity === "yearly"
			? 0
			: periodicity === "quarterly"
				? Math.floor(month / 3) * 3
				: month;
	return `${year}-${String(first + 1).padStart(2, "0")}-01`;
}

/** First day of the quarter `quarter` of `year`, in `YYYY-MM-DD`. */
function quarterStart(year: number, quarter: number): string {
	const month = QUARTER_MONTHS[quarter - 1] ?? 0;
	return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** 1 to 4 — quarter holding the period, or `null`. */
export function quarterOf(value: string | null): number | null {
	const parts = partsOf(value);
	return parts ? Math.floor(parts.month / 3) + 1 : null;
}

/** "Sep 2026", "Q3 2026" or "2026". */
export function formatPeriod(
	value: string | null,
	periodicity: Periodicity,
): string {
	const parts = partsOf(value);
	if (!parts) {
		return "";
	}
	if (periodicity === "quarterly") {
		return `Q${Math.floor(parts.month / 3) + 1} ${parts.year}`;
	}
	if (periodicity === "weekly") {
		return formatDateValue(value, "day");
	}
	return formatDateValue(value, periodicity === "yearly" ? "year" : "month");
}

/** Bounds of the period, e.g. "Jul 2026" and "Sep 2026" for a quarter. */
export function periodRangeLabel(
	value: string | null,
	periodicity: Periodicity,
): { from: string; to: string } | null {
	const parts = partsOf(value);
	if (!parts) {
		return null;
	}
	if (periodicity === "weekly") {
		const start = isoToDate(value);
		if (!start) {
			return null;
		}
		const end = new Date(start);
		end.setDate(end.getDate() + 6);
		return {
			from: formatDateValue(value, "day"),
			to: formatDateValue(dateToIso(end), "day"),
		};
	}
	const span =
		periodicity === "yearly" ? 12 : periodicity === "quarterly" ? 3 : 1;
	const start = new Date(parts.year, parts.month, 1);
	const end = new Date(parts.year, parts.month + span - 1, 1);
	const format = new Intl.DateTimeFormat("en-GB", {
		month: "short",
		year: "numeric",
	});
	return { from: format.format(start), to: format.format(end) };
}

export interface PeriodPickerProps {
	/** First day of the period (`YYYY-MM-DD`), or `null`. */
	value: string | null;
	onValueChange: (value: string | null) => void;
	periodicity: Periodicity;
	label?: string;
	id?: string;
	className?: string;
}

export function PeriodPicker({
	value,
	onValueChange,
	periodicity,
	label = "Period",
	id,
	className,
}: PeriodPickerProps) {
	if (periodicity === "quarterly") {
		return (
			<QuarterPicker
				id={id}
				label={label}
				value={value}
				onValueChange={onValueChange}
				className={className}
			/>
		);
	}
	return (
		<DatePicker
			id={id}
			label={label}
			value={value}
			precision={
				periodicity === "yearly"
					? "year"
					: periodicity === "weekly"
						? "day"
						: "month"
			}
			onValueChange={(next) =>
				onValueChange(next === null ? null : toPeriodStart(next, periodicity))
			}
			className={className}
		/>
	);
}

/** Year field plus the four quarters as a segmented control. */
function QuarterPicker({
	value,
	onValueChange,
	label,
	id,
	className,
}: {
	value: string | null;
	onValueChange: (value: string | null) => void;
	label: string;
	id?: string;
	className?: string;
}) {
	const parts = partsOf(value);
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(() => (parts ? String(parts.year) : ""));

	// Keyed on the raw value: `partsOf` builds a new object on every render.
	useEffect(() => {
		const next = partsOf(value);
		setDraft(next ? String(next.year) : "");
	}, [value]);

	const quarter = quarterOf(value);

	const applyYear = (raw: string) => {
		const year = Number(raw.trim());
		if (!/^\d{4}$/.test(raw.trim())) {
			setDraft(parts ? String(parts.year) : "");
			return;
		}
		onValueChange(quarterStart(year, quarter ?? 1));
	};

	return (
		<div className={cn("flex items-center gap-2", className)}>
			<InputGroup className="w-24 shrink-0">
				<InputGroupInput
					id={id}
					aria-label={`${label} year`}
					inputMode="numeric"
					autoComplete="off"
					placeholder="2026"
					className="font-mono tabular-nums"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={(event) => applyYear(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							applyYear(draft);
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
									aria-label={`Open the year list of ${label.toLowerCase()}`}
								/>
							}
						>
							<CalendarIcon />
						</PopoverTrigger>
						<PopoverContent align="start" className="w-auto">
							<YearGrid
								label={`${label} year`}
								value={parts?.year ?? null}
								onSelect={(year) => {
									setOpen(false);
									onValueChange(quarterStart(year, quarter ?? 1));
								}}
							/>
						</PopoverContent>
					</Popover>
				</InputGroupAddon>
			</InputGroup>

			<ToggleGroup
				spacing={0}
				variant="outline"
				size="sm"
				aria-label={`${label} quarter`}
				value={quarter ? [`Q${quarter}`] : []}
				onValueChange={(next: string[]) => {
					const picked = next.at(-1);
					if (!picked) {
						return;
					}
					const year = parts?.year ?? new Date().getFullYear();
					onValueChange(quarterStart(year, Number(picked.slice(1))));
				}}
			>
				{QUARTERS.map((item) => (
					<ToggleGroupItem
						key={item}
						value={`Q${item}`}
						aria-label={`Quarter ${item}`}
						className="font-mono tabular-nums"
					>
						Q{item}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</div>
	);
}

export interface PeriodHintProps {
	value: string | null;
	periodicity: Periodicity;
	/** Sentence opener, e.g. "Starts". */
	prefix?: string;
	fallback?: string;
}

/** "Covers Jul 2026 → Sep 2026" under the field. */
export function PeriodHint({
	value,
	periodicity,
	prefix = "Covers",
	fallback = "No period selected.",
}: PeriodHintProps) {
	const range = periodRangeLabel(value, periodicity);
	if (!range) {
		return <>{fallback}</>;
	}
	return (
		<span className="inline-flex items-center gap-1">
			{prefix} <span className="font-mono">{range.from}</span>
			{range.from === range.to ? null : (
				<>
					<ArrowRightIcon aria-hidden className="size-3" />
					<span className="font-mono">{range.to}</span>
				</>
			)}
			<span className="text-muted-foreground">
				({formatPeriod(value, periodicity)})
			</span>
		</span>
	);
}
