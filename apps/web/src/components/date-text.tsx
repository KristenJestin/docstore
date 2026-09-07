import type { DatePrecision } from "@docstore/shared/document";
import { cn } from "@docstore/ui/lib/utils";

const FORMATTERS: Record<DatePrecision, Intl.DateTimeFormat> = {
	day: new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
	}),
	month: new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }),
	year: new Intl.DateTimeFormat("en-GB", { year: "numeric" }),
};

/**
 * Postgres `date` columns arrive as `YYYY-MM-DD`: they are read at noon UTC so
 * that no time zone can shift the displayed day.
 */
export function parseDateValue(value: string | Date): Date | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (dateOnly) {
		return new Date(`${value}T12:00:00Z`);
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "12 Oct 2025" / "Dec 2025" / "2025", depending on the precision. */
export function formatDate(
	value: string | Date,
	precision: DatePrecision = "day",
): string {
	const date = parseDateValue(value);
	if (!date) {
		return "";
	}
	return FORMATTERS[precision].format(date);
}

export interface DateTextProps {
	value: string | Date | null | undefined;
	/** `day` (default), `month` or `year`. */
	precision?: DatePrecision | null;
	/** Text shown when the date is missing. */
	fallback?: string;
	className?: string;
}

/** Date in mono type, formatted according to `datePrecision`. */
export function DateText({
	value,
	precision,
	fallback = "—",
	className,
}: DateTextProps) {
	const date = value ? parseDateValue(value) : null;
	if (!date) {
		return (
			<span
				className={cn("font-mono text-muted-foreground text-xs", className)}
			>
				{fallback}
			</span>
		);
	}
	return (
		<time
			dateTime={date.toISOString()}
			className={cn("font-mono text-muted-foreground text-xs", className)}
		>
			{FORMATTERS[precision ?? "day"].format(date)}
		</time>
	);
}
