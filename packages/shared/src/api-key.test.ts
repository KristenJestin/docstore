import { describe, expect, test } from "bun:test";
import {
	callerHasScope,
	maskSensitiveDocument,
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

describe("maskSensitiveDocument", () => {
	const sensitive = { id: "doc_1", sensitive: true, content: "IBAN FR76" };
	const plain = { id: "doc_2", sensitive: false, content: "Invoice" };

	test("masks the content of a sensitive document for a key without sensitive", () => {
		expect(maskSensitiveDocument(sensitive, { scopes: ["read"] })).toEqual({
			id: "doc_1",
			sensitive: true,
			content: SENSITIVE_PLACEHOLDER,
			masked: true,
		});
	});

	test("leaves a non-sensitive document untouched", () => {
		expect(maskSensitiveDocument(plain, { scopes: ["read"] })).toEqual({
			...plain,
			masked: false,
		});
	});

	test("leaves the content to a session or a key with sensitive", () => {
		expect(maskSensitiveDocument(sensitive, null).content).toBe("IBAN FR76");
		expect(
			maskSensitiveDocument(sensitive, { scopes: ["read", "sensitive"] })
				.content,
		).toBe("IBAN FR76");
	});

	test("an empty content stays null rather than turning into the placeholder", () => {
		expect(
			maskSensitiveDocument(
				{ sensitive: true, content: null },
				{ scopes: ["read"] },
			),
		).toEqual({ sensitive: true, content: null, masked: true });
	});
});

describe("maskSensitiveDocument: field values and notes (issue #22)", () => {
	const payslip = {
		id: "doc_3",
		sensitive: true,
		content: "Net pay 2 345.67",
		notes: "Raise from March",
		fieldValues: [{ fieldId: "fld_net", value: 2345.67 }],
	};

	test("WHEN a read key sees a sensitive document THEN it gets no field values and no notes, masked is true", () => {
		const masked = maskSensitiveDocument(payslip, { scopes: ["read"] });
		expect(masked.fieldValues).toEqual([]);
		expect(masked.notes).toBeNull();
		expect(masked.content).toBe(SENSITIVE_PLACEHOLDER);
		expect(masked.masked).toBe(true);
		expect(masked.id).toBe("doc_3");
	});

	test("WHEN a key with sensitive or a session sees it THEN values and notes are served", () => {
		for (const caller of [null, { scopes: ["read", "sensitive"] as const }]) {
			const served = maskSensitiveDocument(payslip, caller);
			expect(served.fieldValues).toEqual(payslip.fieldValues);
			expect(served.notes).toBe("Raise from March");
			expect(served.masked).toBe(false);
		}
	});

	test("a shape without fieldValues or notes does not grow them", () => {
		const masked = maskSensitiveDocument(
			{ sensitive: true, content: "x" },
			{ scopes: ["read"] },
		);
		expect("fieldValues" in masked).toBe(false);
		expect("notes" in masked).toBe(false);
	});
});
