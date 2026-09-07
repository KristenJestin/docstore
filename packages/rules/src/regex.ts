import { MAX_REGEX_LENGTH } from "@docstore/shared/extraction";

/**
 * Defensive construction of regular expressions.
 *
 * Patterns come from user configuration: a pattern that is too long or
 * syntactically wrong must never bring the pipeline down. JavaScript has no
 * execution timeout on `RegExp` — the length limit is the only safeguard
 * available (SPEC §3).
 */
export function safeRegex(pattern: string, flags = "i"): RegExp | null {
	if (pattern.length > MAX_REGEX_LENGTH) return null;
	try {
		return new RegExp(pattern, flags);
	} catch {
		return null;
	}
}

/**
 * Same, but without the `g` flag: repeated `exec` calls on a global pattern
 * depend on `lastIndex`, which makes extractions non-deterministic from one
 * line to the next.
 */
export function safeMatchRegex(pattern: string, flags = "i"): RegExp | null {
	return safeRegex(pattern, flags.replace(/g/g, ""));
}
