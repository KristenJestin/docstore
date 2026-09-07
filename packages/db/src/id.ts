import { customAlphabet } from "nanoid";

/** Alphabet without ambiguous characters, URL-safe and double-click friendly. */
const nanoid = customAlphabet("0123456789abcdefghijkmnpqrstuvwxyz", 21);

/**
 * Generates a prefixed application identifier.
 *
 * @example createId("prt_") // "prt_k3f9..."
 */
export function createId(prefix: string): string {
	return `${prefix}${nanoid()}`;
}
