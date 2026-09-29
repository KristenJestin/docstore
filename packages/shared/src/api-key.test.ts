import { describe, expect, test } from "bun:test";
import {
	callerHasScope,
	maskSensitiveContent,
	mayReadSensitive,
	SENSITIVE_PLACEHOLDER,
} from "./api-key";

describe("callerHasScope", () => {
	test("a browser session keeps every right", () => {
		expect(callerHasScope(null, "read")).toBe(true);
		expect(callerHasScope(undefined, "sensitive")).toBe(true);
	});

	test("an API key needs the scope, and admin implies it", () => {
		expect(callerHasScope({ scopes: ["write"] }, "read")).toBe(false);
		expect(callerHasScope({ scopes: ["read"] }, "read")).toBe(true);
		expect(callerHasScope({ scopes: ["admin"] }, "read")).toBe(true);
	});
});

describe("mayReadSensitive", () => {
	test("a browser session may read sensitive content", () => {
		expect(mayReadSensitive(null)).toBe(true);
	});

	test("a key with read only may not", () => {
		expect(mayReadSensitive({ scopes: ["read"] })).toBe(false);
	});

	test("a key with read + sensitive, or admin, may", () => {
		expect(mayReadSensitive({ scopes: ["read", "sensitive"] })).toBe(true);
		expect(mayReadSensitive({ scopes: ["admin"] })).toBe(true);
	});
});

describe("maskSensitiveContent", () => {
	const sensitive = { id: "doc_1", sensitive: true, content: "IBAN FR76" };
	const plain = { id: "doc_2", sensitive: false, content: "Invoice" };

	test("masks the content of a sensitive document for a key without sensitive", () => {
		expect(maskSensitiveContent(sensitive, { scopes: ["read"] })).toEqual({
			id: "doc_1",
			sensitive: true,
			content: SENSITIVE_PLACEHOLDER,
			masked: true,
		});
	});

	test("leaves a non-sensitive document untouched", () => {
		expect(maskSensitiveContent(plain, { scopes: ["read"] })).toEqual({
			...plain,
			masked: false,
		});
	});

	test("leaves the content to a session or a key with sensitive", () => {
		expect(maskSensitiveContent(sensitive, null).content).toBe("IBAN FR76");
		expect(
			maskSensitiveContent(sensitive, { scopes: ["read", "sensitive"] })
				.content,
		).toBe("IBAN FR76");
	});

	test("an empty content stays null rather than turning into the placeholder", () => {
		expect(
			maskSensitiveContent(
				{ sensitive: true, content: null },
				{ scopes: ["read"] },
			),
		).toEqual({ sensitive: true, content: null, masked: true });
	});
});
