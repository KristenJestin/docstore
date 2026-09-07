import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	hasUsableTextLayer,
	parseBboxLayout,
	pdfInfo,
	pdfTextLayer,
	renderPdfPage,
} from "../src/pdf";
import { testTools } from "./tools";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const TEXT_LAYER_PDF = join(FIXTURES, "text-layer.pdf");
const SCANNED_PDF = join(FIXTURES, "scanned.pdf");

const TIMEOUT = 120_000;

describe("pdfInfo", () => {
	test(
		"returns 2 pages and their dimensions",
		async () => {
			const info = await pdfInfo(testTools, TEXT_LAYER_PDF);
			expect(info.pageCount).toBe(2);
			expect(info.pages).toHaveLength(2);
			expect(info.encrypted).toBe(false);
			for (const page of info.pages) {
				expect(page.width).toBeGreaterThan(500);
				expect(page.height).toBeGreaterThan(800);
			}
		},
		TIMEOUT,
	);

	test(
		"the scanned PDF also has 2 pages",
		async () => {
			expect((await pdfInfo(testTools, SCANNED_PDF)).pageCount).toBe(2);
		},
		TIMEOUT,
	);
});

describe("pdfTextLayer", () => {
	test(
		"extracts the text and the bounding boxes of text-layer.pdf",
		async () => {
			const result = await pdfTextLayer(testTools, TEXT_LAYER_PDF);
			expect(result.source).toBe("text-layer");
			expect(result.text).toContain("FACTURE");
			expect(result.text).toContain("1 234,56");

			expect(result.layout.pages).toHaveLength(2);
			for (const page of result.layout.pages) {
				expect(page.dpi).toBe(72);
				expect(page.width).toBeGreaterThan(0);
				expect(page.height).toBeGreaterThan(0);
				expect(page.words.length).toBeGreaterThan(5);
				for (const word of page.words) {
					expect(word.text.length).toBeGreaterThan(0);
					expect(word.x1).toBeGreaterThan(word.x0);
					expect(word.y1).toBeGreaterThan(word.y0);
					expect(word.x0).toBeGreaterThanOrEqual(0);
				}
			}

			const first = result.layout.pages[0];
			expect(first?.words.map((w) => w.text)).toContain("FACTURE");
			expect(hasUsableTextLayer(result)).toBe(true);
		},
		TIMEOUT,
	);

	test(
		"scanned.pdf has no usable text layer",
		async () => {
			const result = await pdfTextLayer(testTools, SCANNED_PDF);
			expect(hasUsableTextLayer(result)).toBe(false);
		},
		TIMEOUT,
	);
});

describe("parseBboxLayout", () => {
	test("parses the XHTML and decodes the entities", () => {
		const layout = parseBboxLayout(`<doc>
  <page width="595.28" height="841.89">
    <flow><block><line>
      <word xMin="10" yMin="20" xMax="30" yMax="40">Caf&#233;</word>
      <word xMin="35" yMin="20" xMax="60" yMax="40">R&amp;D</word>
      <word xMin="65" yMin="20" xMax="70" yMax="40">   </word>
    </line></block></flow>
  </page>
</doc>`);

		expect(layout.pages).toHaveLength(1);
		const page = layout.pages[0];
		expect(page?.width).toBeCloseTo(595.28);
		expect(page?.height).toBeCloseTo(841.89);
		expect(page?.words).toEqual([
			{ text: "Café", x0: 10, y0: 20, x1: 30, y1: 40, conf: 100 },
			{ text: "R&D", x0: 35, y0: 20, x1: 60, y1: 40, conf: 100 },
		]);
	});

	test("returns an empty layout for an output without pages", () => {
		expect(parseBboxLayout("<doc></doc>").pages).toEqual([]);
	});
});

describe("hasUsableTextLayer", () => {
	const page = { width: 100, height: 100, dpi: 72, words: [] };

	test("refuses a text that is too short", () => {
		expect(hasUsableTextLayer({ text: "abc", layout: { pages: [page] } })).toBe(
			false,
		);
	});

	test("accepts 20 alphanumeric characters per page", () => {
		expect(
			hasUsableTextLayer({
				text: "a".repeat(40),
				layout: { pages: [page, page] },
			}),
		).toBe(true);
	});
});

describe("renderPdfPage", () => {
	test(
		"renders page 1 as PNG",
		async () => {
			const png = await renderPdfPage(testTools, TEXT_LAYER_PDF, 1, {
				dpi: 100,
			});
			expect(png.byteLength).toBeGreaterThan(1000);
			// PNG signature.
			expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
		},
		TIMEOUT,
	);
});
