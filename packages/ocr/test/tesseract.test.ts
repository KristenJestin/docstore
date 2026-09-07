import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTesseractTsv, tesseractOcr } from "../src/tesseract";
import { testTools } from "./tools";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const SCANNED_PNG = join(FIXTURES, "scanned.png");

const TIMEOUT = 240_000;

const HEADER =
	"level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

describe("parseTesseractTsv", () => {
	test("reconstructs words, bounding boxes and text", () => {
		const tsv = [
			HEADER,
			"1\t1\t0\t0\t0\t0\t0\t0\t1654\t2339\t-1\t",
			"5\t1\t1\t1\t1\t1\t10\t20\t100\t30\t95.5\tFACTURE",
			"5\t1\t1\t1\t1\t2\t120\t20\t40\t30\t90\tN°",
			"5\t1\t1\t1\t2\t1\t10\t60\t50\t30\t80\tNet",
			"5\t1\t2\t1\t1\t1\t10\t200\t60\t30\t70\tTotal",
			"5\t1\t2\t1\t1\t2\t80\t200\t10\t30\t-1\t  ",
		].join("\n");

		const { page, text } = parseTesseractTsv(tsv, 200);

		expect(page.width).toBe(1654);
		expect(page.height).toBe(2339);
		expect(page.dpi).toBe(200);
		expect(page.words).toEqual([
			{ text: "FACTURE", x0: 10, y0: 20, x1: 110, y1: 50, conf: 95.5 },
			{ text: "N°", x0: 120, y0: 20, x1: 160, y1: 50, conf: 90 },
			{ text: "Net", x0: 10, y0: 60, x1: 60, y1: 90, conf: 80 },
			{ text: "Total", x0: 10, y0: 200, x1: 70, y1: 230, conf: 70 },
		]);
		expect(text).toBe("FACTURE N°\nNet\n\nTotal");
	});

	test("supports Windows line endings", () => {
		const tsv = [
			HEADER,
			"1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t",
			"5\t1\t1\t1\t1\t1\t1\t2\t3\t4\t99\tOK",
		].join("\r\n");
		expect(parseTesseractTsv(tsv, 72).text).toBe("OK");
	});
});

describe("tesseractOcr", () => {
	test(
		"OCRs scanned.png",
		async () => {
			const { page, text } = await tesseractOcr(testTools, SCANNED_PNG, {
				languages: ["fra", "eng"],
				dpi: 200,
			});

			expect(text.toLowerCase()).toContain("facture");
			expect(page.width).toBeGreaterThan(0);
			expect(page.height).toBeGreaterThan(0);
			expect(page.words.length).toBeGreaterThan(10);
			expect(page.words[0]?.conf).toBeGreaterThan(0);
		},
		TIMEOUT,
	);
});
