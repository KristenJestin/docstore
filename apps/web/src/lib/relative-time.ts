const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const ABSOLUTE = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

/** "12 Oct 2025, 14:03": the full instant, for tooltips. */
export function formatInstant(value: Date): string {
	return ABSOLUTE.format(value);
}

/**
 * "just now", "4 minutes ago", "3 hours ago", "yesterday", "5 days ago";
 * beyond a month, the date itself.
 */
export function formatRelativeTime(
	value: Date,
	now: Date = new Date(),
): string {
	const seconds = Math.round((value.getTime() - now.getTime()) / 1000);
	const abs = Math.abs(seconds);
	if (abs < 45) return "just now";
	if (abs < 60 * 60) return RELATIVE.format(Math.round(seconds / 60), "minute");
	if (abs < 60 * 60 * 24) {
		return RELATIVE.format(Math.round(seconds / 3600), "hour");
	}
	if (abs < 60 * 60 * 24 * 30) {
		return RELATIVE.format(Math.round(seconds / 86_400), "day");
	}
	return formatInstant(value);
}
