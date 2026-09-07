/**
 * English plural of a counted noun. Zero takes the plural form ("0 documents"),
 * which the `count > 1 ? "s" : ""` shortcut and the "document(s)" placeholder
 * both got wrong.
 */
export function plural(
	count: number,
	singular: string,
	pluralForm?: string,
): string {
	return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

/** `countLabel(0, "document")` → "0 documents", `countLabel(1, …)` → "1 document". */
export function countLabel(
	count: number,
	singular: string,
	pluralForm?: string,
): string {
	return `${count} ${plural(count, singular, pluralForm)}`;
}
