/**
 * Escapes the `LIKE` metacharacters of a user input before turning it into a
 * `%…%` pattern.
 */
export function likePattern(value: string): string {
	const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
	return `%${escaped}%`;
}

/** Returns the first row of a SQL result, guaranteeing that it is present. */
export function firstOrThrow<T>(rows: readonly T[], message: string): T {
	const row = rows[0];
	if (!row) {
		throw new Error(message);
	}
	return row;
}
