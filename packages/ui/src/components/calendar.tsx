"use client";

import { Button } from "@docstore/ui/components/button";
import { cn } from "@docstore/ui/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";

/**
 * Dependency-free calendar primitives (day grid, month grid, year list) drawn
 * with the theme tokens. They hold no business logic: the caller owns the value
 * and decides what a selection means.
 *
 * Everything is `en-GB` (weeks start on Monday, "15 Mar 2024") to match
 * `docs/DESIGN.md`.
 */

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

const MONTH_SHORT = new Intl.DateTimeFormat("en-GB", { month: "short" });
const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long" });
const FULL_DAY = new Intl.DateTimeFormat("en-GB", {
	weekday: "long",
	day: "numeric",
	month: "long",
	year: "numeric",
});

/** Cells of a day grid: always six weeks, so the popover never jumps. */
const DAY_CELLS = 42;

/** How many years the list of `YearGrid` offers around the anchor. */
const YEAR_SPAN = 12;

export function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, count: number): Date {
	return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function addDays(date: Date, count: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/** Six weeks starting on the Monday on or before the first of the month. */
function dayCells(month: Date): Date[] {
	const first = startOfMonth(month);
	// `getDay()` is Sunday-based; shift it so Monday is 0.
	const offset = (first.getDay() + 6) % 7;
	const start = addDays(first, -offset);
	return Array.from({ length: DAY_CELLS }, (_, index) => addDays(start, index));
}

/** Header shared by the three grids: previous, title, next. */
function CalendarHeader({
	title,
	onPrevious,
	onNext,
	previousLabel,
	nextLabel,
}: {
	title: React.ReactNode;
	onPrevious: () => void;
	onNext: () => void;
	previousLabel: string;
	nextLabel: string;
}) {
	return (
		<div className="flex items-center justify-between gap-1 pb-2">
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={previousLabel}
				onClick={onPrevious}
			>
				<ChevronLeftIcon />
			</Button>
			<span
				aria-live="polite"
				className="font-semibold text-sm tabular-nums tracking-tight"
			>
				{title}
			</span>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={nextLabel}
				onClick={onNext}
			>
				<ChevronRightIcon />
			</Button>
		</div>
	);
}

/** Shared look of a selectable cell (day, month or year). */
const cellClasses =
	"flex cursor-pointer select-none items-center justify-center rounded-md font-mono text-sm tabular-nums outline-none transition-colors duration-200 ease-premium hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-40 aria-selected:bg-primary aria-selected:font-semibold aria-selected:text-primary-foreground aria-selected:hover:bg-primary";

export interface CalendarProps {
	/** Selected day, or `null` when the field is empty. */
	value?: Date | null;
	onSelect?: (date: Date) => void;
	/** Month shown when there is no value. */
	defaultMonth?: Date;
	/** Accessible name of the grid. */
	label?: string;
	className?: string;
}

/**
 * Compact month grid. Arrow keys move the focused day (crossing months), Home
 * and End jump to the first and last day of the week, PageUp / PageDown change
 * the month.
 */
export function Calendar({
	value,
	onSelect,
	defaultMonth,
	label = "Calendar",
	className,
}: CalendarProps) {
	const today = React.useMemo(() => new Date(), []);
	const [month, setMonth] = React.useState(() =>
		startOfMonth(value ?? defaultMonth ?? today),
	);
	const [focused, setFocused] = React.useState<Date>(() => value ?? today);
	const gridRef = React.useRef<HTMLDivElement | null>(null);
	const shouldRestoreFocus = React.useRef(false);

	// Reopening on another value must show that value's month again.
	const valueTime = value ? value.getTime() : null;
	React.useEffect(() => {
		if (valueTime !== null) {
			const next = new Date(valueTime);
			setMonth(startOfMonth(next));
			setFocused(next);
		}
	}, [valueTime]);

	React.useEffect(() => {
		if (!shouldRestoreFocus.current) {
			return;
		}
		shouldRestoreFocus.current = false;
		gridRef.current
			?.querySelector<HTMLButtonElement>('[data-focused="true"]')
			?.focus();
	});

	const moveFocus = (next: Date) => {
		shouldRestoreFocus.current = true;
		setFocused(next);
		setMonth(startOfMonth(next));
	};

	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const steps: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -7,
			ArrowDown: 7,
		};
		const step = steps[event.key];
		if (step !== undefined) {
			event.preventDefault();
			moveFocus(addDays(focused, step));
			return;
		}
		if (event.key === "Home" || event.key === "End") {
			event.preventDefault();
			const weekday = (focused.getDay() + 6) % 7;
			moveFocus(
				addDays(focused, event.key === "Home" ? -weekday : 6 - weekday),
			);
			return;
		}
		if (event.key === "PageUp" || event.key === "PageDown") {
			event.preventDefault();
			const delta = event.key === "PageUp" ? -1 : 1;
			const target = new Date(
				focused.getFullYear(),
				focused.getMonth() + delta,
				focused.getDate(),
			);
			moveFocus(target);
		}
	};

	const cells = dayCells(month);

	return (
		<div className={cn("flex w-fit flex-col", className)}>
			<CalendarHeader
				title={`${MONTH_LONG.format(month)} ${month.getFullYear()}`}
				previousLabel="Previous month"
				nextLabel="Next month"
				onPrevious={() => setMonth(addMonths(month, -1))}
				onNext={() => setMonth(addMonths(month, 1))}
			/>
			<div className="grid grid-cols-7 gap-0.5">
				{WEEKDAY_LABELS.map((weekday) => (
					<span
						key={weekday}
						aria-hidden
						className="flex size-8 items-center justify-center font-mono text-muted-foreground text-xs uppercase"
					>
						{weekday}
					</span>
				))}
			</div>
			<div
				ref={gridRef}
				role="grid"
				aria-label={label}
				onKeyDown={onKeyDown}
				className="mt-0.5 grid grid-cols-7 gap-0.5"
			>
				{cells.map((date) => {
					const outside = date.getMonth() !== month.getMonth();
					const selected = value ? isSameDay(date, value) : false;
					const isFocused = isSameDay(date, focused);
					return (
						<button
							key={date.toISOString()}
							type="button"
							role="gridcell"
							data-focused={isFocused}
							aria-selected={selected}
							aria-current={isSameDay(date, today) ? "date" : undefined}
							aria-label={FULL_DAY.format(date)}
							tabIndex={isFocused ? 0 : -1}
							onClick={() => {
								setFocused(date);
								onSelect?.(date);
							}}
							className={cn(
								cellClasses,
								"size-8",
								outside && "text-muted-foreground/60",
								!selected &&
									isSameDay(date, today) &&
									"ring-1 ring-primary/60 ring-inset",
							)}
						>
							{date.getDate()}
						</button>
					);
				})}
			</div>
		</div>
	);
}

export interface MonthGridProps {
	/** Selected year and zero-based month, or `null`. */
	value?: { year: number; month: number } | null;
	onSelect?: (value: { year: number; month: number }) => void;
	defaultYear?: number;
	label?: string;
	className?: string;
}

/** Twelve-month grid, used by the `month` precision and the period picker. */
export function MonthGrid({
	value,
	onSelect,
	defaultYear,
	label = "Months",
	className,
}: MonthGridProps) {
	const now = new Date();
	const [year, setYear] = React.useState(
		() => value?.year ?? defaultYear ?? now.getFullYear(),
	);

	React.useEffect(() => {
		if (value) {
			setYear(value.year);
		}
	}, [value]);

	return (
		<div className={cn("flex w-fit flex-col", className)}>
			<CalendarHeader
				title={year}
				previousLabel="Previous year"
				nextLabel="Next year"
				onPrevious={() => setYear(year - 1)}
				onNext={() => setYear(year + 1)}
			/>
			<div role="grid" aria-label={label} className="grid grid-cols-3 gap-1">
				{Array.from({ length: 12 }, (_, month) => {
					const selected = value?.year === year && value.month === month;
					const label_ = MONTH_SHORT.format(new Date(year, month, 1));
					return (
						<button
							key={month}
							type="button"
							role="gridcell"
							aria-selected={selected}
							aria-label={`${MONTH_LONG.format(new Date(year, month, 1))} ${year}`}
							onClick={() => onSelect?.({ year, month })}
							className={cn(
								cellClasses,
								"h-8 w-16",
								year === now.getFullYear() &&
									month === now.getMonth() &&
									!selected &&
									"ring-1 ring-primary/60 ring-inset",
							)}
						>
							{label_}
						</button>
					);
				})}
			</div>
		</div>
	);
}

export interface YearGridProps {
	value?: number | null;
	onSelect?: (year: number) => void;
	label?: string;
	className?: string;
}

/** Scrollable list of years, used by the `year` precision. */
export function YearGrid({
	value,
	onSelect,
	label = "Years",
	className,
}: YearGridProps) {
	const now = new Date();
	const [anchor, setAnchor] = React.useState(() => value ?? now.getFullYear());

	React.useEffect(() => {
		if (value !== null && value !== undefined) {
			setAnchor(value);
		}
	}, [value]);

	const first = anchor - Math.floor(YEAR_SPAN / 2);
	const years = Array.from({ length: YEAR_SPAN }, (_, index) => first + index);

	return (
		<div className={cn("flex w-fit flex-col", className)}>
			<CalendarHeader
				title={`${first}–${first + YEAR_SPAN - 1}`}
				previousLabel="Previous years"
				nextLabel="Next years"
				onPrevious={() => setAnchor(anchor - YEAR_SPAN)}
				onNext={() => setAnchor(anchor + YEAR_SPAN)}
			/>
			<div role="grid" aria-label={label} className="grid grid-cols-3 gap-1">
				{years.map((year) => (
					<button
						key={year}
						type="button"
						role="gridcell"
						aria-selected={value === year}
						onClick={() => onSelect?.(year)}
						className={cn(
							cellClasses,
							"h-8 w-16",
							year === now.getFullYear() &&
								value !== year &&
								"ring-1 ring-primary/60 ring-inset",
						)}
					>
						{year}
					</button>
				))}
			</div>
		</div>
	);
}
