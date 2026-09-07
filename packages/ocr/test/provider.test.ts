import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultOcrProvider, UnsupportedMediaError } from "../src/provider";
import { testTools } from "./tools";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const TEXT_LAYER_PDF = join(FIXTURES, "text-layer.pdf");
const SCANNED_PDF = join(FIXTURES, "scanned.pdf");
const SCANNED_PNG = join(FIXTURES, "scanned.png");

const TIMEOUT = 240_000;

// 200 dpi is enough for the fixtures (16 pt text) and cuts the OCR time
// compared with the 300 dpi default.
const provider = new DefaultOcrProvider(testTools, { dpi: 200 });

/** Normalises for assertions tolerant to case and to thin spaces. */
function normalize(text: string): string {
	return text.toLowerCase().replace(/[   ]/g, " ").replace(/\s+/g, " ");
}

describe("DefaultOcrProvider", () => {
	test(
		"text-layer.pdf uses the text layer",
		async () => {
			const result = await provider.extract({
				path: TEXT_LAYER_PDF,
				mime: "application/pdf",
			});

			expect(result.source).toBe("text-layer");
			expect(result.text).toContain("FACTURE");
			expect(result.text).toContain("1 234,56");
			expect(result.layout.pages).toHaveLength(2);
			expect(result.layout.pages[0]?.words.length).toBeGreaterThan(5);
		},
		TIMEOUT,
	);

	test(
		"scanned.pdf goes through OCR",
		async () => {
			const result = await provider.extract({
				path: SCANNED_PDF,
				mime: "application/pdf",
			});

			expect(result.source).toBe("ocr");
			const text = normalize(result.text);
			expect(text).toContain("facture");
			expect(/1 ?234,56/.test(text)).toBe(true);

			expect(result.layout.pages).toHaveLength(2);
			for (const page of result.layout.pages) {
				expect(page.dpi).toBe(200);
				expect(page.width).toBeGreaterThan(0);
				expect(page.height).toBeGreaterThan(0);
				expect(page.words.length).toBeGreaterThan(5);
				for (const word of page.words) {
					expect(word.x1).toBeGreaterThan(word.x0);
					expect(word.y1).toBeGreaterThan(word.y0);
					expect(word.conf).toBeGreaterThan(0);
				}
			}
		},
		TIMEOUT,
	);

	test(
		"scanned.png is OCRed directly",
		async () => {
			const result = await provider.extract({
				path: SCANNED_PNG,
				mime: "image/png",
			});

			expect(result.source).toBe("ocr");
			const text = normalize(result.text);
			expect(text).toContain("facture");
			expect(/1 ?234,56/.test(text)).toBe(true);
			expect(result.layout.pages).toHaveLength(1);
			expect(result.layout.pages[0]?.words.length).toBeGreaterThan(5);
		},
		TIMEOUT,
	);

	test("an unsupported type is rejected", async () => {
		await expect(
			provider.extract({ path: "/tmp/x.zip", mime: "application/zip" }),
		).rejects.toThrow(UnsupportedMediaError);
	});
});
