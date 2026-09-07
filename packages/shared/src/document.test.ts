import { describe, expect, test } from "bun:test";
import {
	documentPartyRoleSchema,
	documentStatusSchema,
	listDocumentsInput,
	ocrLayoutSchema,
	updateDocumentInput,
} from "./document";

describe("document enums", () => {
	test("known statuses", () => {
		expect(documentStatusSchema.parse("review")).toBe("review");
		expect(documentStatusSchema.safeParse("done").success).toBe(false);
	});

	test("known roles", () => {
		expect(documentPartyRoleSchema.parse("issuer")).toBe("issuer");
		expect(documentPartyRoleSchema.safeParse("author").success).toBe(false);
	});
});

describe("updateDocumentInput", () => {
	test("an empty patch is valid", () => {
		expect(updateDocumentInput.parse({})).toEqual({});
	});

	test("dates use the YYYY-MM-DD format", () => {
		expect(
			updateDocumentInput.parse({ documentDate: "2025-12-01" }).documentDate,
		).toBe("2025-12-01");
		expect(
			updateDocumentInput.safeParse({ documentDate: "01/12/2025" }).success,
		).toBe(false);
	});

	test("dates can be reset to null", () => {
		expect(
			updateDocumentInput.parse({ validUntil: null }).validUntil,
		).toBeNull();
	});

	test("asn must be a positive integer", () => {
		expect(updateDocumentInput.safeParse({ asn: 0 }).success).toBe(false);
		expect(updateDocumentInput.safeParse({ asn: 1.5 }).success).toBe(false);
		expect(updateDocumentInput.parse({ asn: 42 }).asn).toBe(42);
	});
});

describe("listDocumentsInput", () => {
	test("default values", () => {
		expect(listDocumentsInput.parse({})).toEqual({
			deleted: "exclude",
			page: 1,
			pageSize: 25,
			sort: "documentDate:desc",
		});
	});

	test("pageSize is capped at 100", () => {
		expect(listDocumentsInput.safeParse({ pageSize: 100 }).success).toBe(true);
		expect(listDocumentsInput.safeParse({ pageSize: 101 }).success).toBe(false);
	});

	test("an unknown sort is rejected", () => {
		expect(listDocumentsInput.safeParse({ sort: "asn:desc" }).success).toBe(
			false,
		);
	});
});

describe("ocrLayoutSchema", () => {
	test("validates a page with words", () => {
		const layout = ocrLayoutSchema.parse({
			pages: [
				{
					width: 2480,
					height: 3508,
					words: [
						{ text: "Facture", x0: 10, y0: 20, x1: 90, y1: 40, conf: 0.98 },
					],
				},
			],
		});
		expect(layout.pages[0]?.words[0]?.text).toBe("Facture");
	});

	test("rejects a non-numeric bbox", () => {
		const invalid = {
			pages: [
				{
					width: 100,
					height: 100,
					words: [{ text: "x", x0: "10", y0: 0, x1: 1, y1: 1, conf: 1 }],
				},
			],
		};
		expect(ocrLayoutSchema.safeParse(invalid).success).toBe(false);
	});
});
