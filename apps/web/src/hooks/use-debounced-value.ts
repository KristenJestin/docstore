import { useEffect, useState } from "react";

/** Default delay, the same 300 ms the document filters already use. */
const DEFAULT_DELAY_MS = 300;

/**
 * Value that only follows its source once it has stopped changing, so a
 * keystroke does not fire one request per character.
 */
export function useDebouncedValue<T>(
	value: T,
	delayMs: number = DEFAULT_DELAY_MS,
): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);

	return debounced;
}
