import { describe, expect, test } from "bun:test";

import { safeRedirect } from "./auth-redirect";

describe("safeRedirect", () => {
	test("after sign-in the user returns to the page they asked for", () => {
		expect(safeRedirect("/documents?q=tax#top")).toBe("/documents?q=tax#top");
	});

	test("falls back to the dashboard without a value", () => {
		expect(safeRedirect(undefined)).toBe("/");
		expect(safeRedirect("")).toBe("/");
	});

	test("refuses another origin", () => {
		expect(safeRedirect("https://evil.example")).toBe("/");
		expect(safeRedirect("//evil.example")).toBe("/");
		expect(safeRedirect("/\\evil.example")).toBe("/");
		expect(safeRedirect("javascript:alert(1)")).toBe("/");
	});
});
