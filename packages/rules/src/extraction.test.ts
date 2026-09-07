import { describe, expect, test } from "bun:test";
import type { OcrLayout, OcrWord } from "@docstore/shared/document";
import type {
	ExtractionStrategy,
	PostprocessStep,
} from "@docstore/shared/extraction";
import { runExtraction } from "./extraction";
import { buildLines, toLayoutLines } from "./layout";

/**
 * Synthetic layer: one A4 page of 600 x 800 with four lines, among them
 * "NET À PAYER AVANT IMPÔT 2 345,67 €" and an amount below it.
 */
function word(text: string, x0: number, x1: number, y0: number): OcrWord {
	return { text, x0, x1, y0, y1: y0 + 20, conf: 95 };
}

const LAYOUT: OcrLayout = {
	pages: [
		{
			width: 600,
			height: 800,
			words: [
				word("FACTURE", 60, 140, 100),
				word("N°", 145, 165, 100),
				word("2024-001", 170, 250, 100),

				word("NET", 60, 100, 200),
				word("À", 105, 115, 200),
				word("PAYER", 120, 180, 200),
				word("AVANT", 190, 250, 200),
				word("IMPÔT", 255, 310, 200),
				word("2", 400, 410, 200),
				word("345,67", 415, 470, 200),
				word("€", 475, 485, 200),

				word("1", 60, 70, 240),
				word("234,56", 75, 130, 240),
				word("€", 135, 145, 240),

				word("Date", 60, 100, 300),
				word(":", 105, 110, 300),
				word("12", 115, 135, 300),
				word("octobre", 140, 210, 300),
				word("2025", 215, 260, 300),
			],
		},
	],
};

const TEXT = [
	"FACTURE N° 2024-001",
	"NET À PAYER AVANT IMPÔT 2 345,67 €",
	"1 234,56 €",
	"Date : 12 octobre 2025",
].join("\n");

const AMOUNT = String.raw`(\d[\d\s.,]*\d)`;

function run(
	strategy: ExtractionStrategy,
	postprocess: PostprocessStep[] = [],
	layout: OcrLayout | null = LAYOUT,
) {
	return runExtraction(strategy, postprocess, { text: TEXT, layout });
}

describe("line reconstruction", () => {
	test("groups words by line, in reading order", () => {
		const lines = buildLines(LAYOUT);
		expect(lines).toHaveLength(4);
		expect(lines[1]?.text).toBe("NET À PAYER AVANT IMPÔT 2 345,67 €");
		expect(lines[3]?.text).toBe("Date : 12 octobre 2025");
	});

	test("toLayoutLines exposes page, ordinate and text", () => {
		const lines = toLayoutLines(LAYOUT);
		expect(lines[0]).toEqual({ page: 0, y: 100, text: "FACTURE N° 2024-001" });
	});
});

describe("regex strategy", () => {
	test("captures the requested group with a confidence of 0.8", () => {
		const result = run({
			kind: "regex",
			pattern: String.raw`FACTURE N°\s*(\S+)`,
			group: 1,
		});
		expect(result.raw).toBe("2024-001");
		expect(result.value).toBe("2024-001");
		expect(result.confidence).toBe(0.8);
		expect(result.matchedWords).toBeUndefined();
	});

	test("group 0 returns the whole match", () => {
		const result = run({ kind: "regex", pattern: "NET . PAYER", group: 0 });
		expect(result.raw).toBe("NET À PAYER");
	});

	test("no result when the pattern does not match", () => {
		const result = run({ kind: "regex", pattern: "INTROUVABLE", group: 0 });
		expect(result.raw).toBeNull();
		expect(result.confidence).toBe(0);
	});

	test("an invalid pattern does not throw", () => {
		const result = run({ kind: "regex", pattern: "([a-z", group: 0 });
		expect(result.raw).toBeNull();
	});
});

describe("anchor strategy", () => {
	const label = "NET (À|A) PAYER";

	test("sameLine + valuePattern + number_fr", () => {
		const result = run(
			{
				kind: "anchor",
				label,
				position: "sameLine",
				valuePattern: AMOUNT,
			},
			["number_fr"],
		);
		expect(result.raw).toBe("2 345,67");
		expect(result.value).toBe(2345.67);
		expect(result.confidence).toBeCloseTo(0.95, 5);
		expect(result.matchedWords?.map((box) => box.text)).toEqual([
			"2",
			"345,67",
		]);
	});

	test("right keeps the words to the right of the label", () => {
		const result = run(
			{ kind: "anchor", label, position: "right", valuePattern: AMOUNT },
			["number_fr"],
		);
		expect(result.value).toBe(2345.67);
	});

	test("right honours maxDistancePx", () => {
		const result = run(
			{
				kind: "anchor",
				label,
				position: "right",
				maxDistancePx: 100,
				valuePattern: AMOUNT,
			},
			["number_fr"],
		);
		// Only "AVANT IMPÔT" is within range: no amount at all.
		expect(result.raw).toBeNull();
	});

	test("nextLine takes the whole next line", () => {
		const result = run({ kind: "anchor", label, position: "nextLine" });
		expect(result.raw).toBe("1 234,56 €");
	});

	test("below only keeps the words overlapping the label", () => {
		const result = run(
			{ kind: "anchor", label, position: "below", valuePattern: AMOUNT },
			["number_fr"],
		);
		expect(result.value).toBe(1234.56);
	});

	test("below honours the vertical maxDistancePx", () => {
		const result = run({
			kind: "anchor",
			label,
			position: "below",
			maxDistancePx: 5,
		});
		expect(result.raw).toBeNull();
	});

	test("without a layer, the anchor cannot produce anything", () => {
		const result = run(
			{ kind: "anchor", label, position: "sameLine" },
			[],
			null,
		);
		expect(result.raw).toBeNull();
	});

	test("label not found", () => {
		const result = run({
			kind: "anchor",
			label: "TOTAL GÉNÉRAL",
			position: "sameLine",
		});
		expect(result.raw).toBeNull();
	});

	test("confidence follows the OCR confidence of the words used", () => {
		const degraded: OcrLayout = {
			pages: [
				{
					...LAYOUT.pages[0],
					width: 600,
					height: 800,
					words: (LAYOUT.pages[0]?.words ?? []).map((item) =>
						item.text === "345,67" || item.text === "2"
							? { ...item, conf: 50 }
							: item,
					),
				},
			],
		};
		const result = runExtraction(
			{ kind: "anchor", label, position: "sameLine", valuePattern: AMOUNT },
			["number_fr"],
			{ text: TEXT, layout: degraded },
		);
		expect(result.confidence).toBeCloseTo(0.5, 5);
	});
});

describe("zone strategy", () => {
	test("concatenates the words inside the rectangle", () => {
		const result = run(
			{ kind: "zone", page: 1, x0: 0.6, y0: 0.24, x1: 1, y1: 0.28 },
			["number_fr"],
		);
		expect(result.raw).toBe("2 345,67 €");
		expect(result.value).toBe(2345.67);
		expect(result.confidence).toBeCloseTo(0.95, 5);
	});

	test("empty rectangle", () => {
		const result = run({
			kind: "zone",
			page: 1,
			x0: 0,
			y0: 0.9,
			x1: 0.2,
			y1: 0.95,
		});
		expect(result.raw).toBeNull();
	});

	test("non-existent page", () => {
		const result = run({ kind: "zone", page: 4, x0: 0, y0: 0, x1: 1, y1: 1 });
		expect(result.raw).toBeNull();
	});
});

describe("postprocessing", () => {
	test("date_fr on an anchor", () => {
		const result = run(
			{ kind: "anchor", label: "Date\\s*:", position: "sameLine" },
			["trim", "date_fr"],
		);
		expect(result.value).toBe("2025-10-12");
		expect(result.precision).toBe("day");
	});

	test("uppercase and regex_replace chain together", () => {
		const result = run(
			{ kind: "regex", pattern: "FACTURE N°\\s*(\\S+)", group: 1 },
			["uppercase", { regex_replace: { pattern: "-", replacement: "/" } }],
		);
		expect(result.value).toBe("2024/001");
	});

	test("a failing postprocessing step voids the value and the confidence", () => {
		const result = run({ kind: "regex", pattern: "(FACTURE)", group: 1 }, [
			"date_fr",
		]);
		expect(result.raw).toBe("FACTURE");
		expect(result.value).toBeNull();
		expect(result.confidence).toBe(0);
	});
});
