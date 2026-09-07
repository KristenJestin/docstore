import type { OcrLayout, OcrPage, OcrWord } from "@docstore/shared/document";
import type { ExtractionBox, LayoutLine } from "@docstore/shared/extraction";

/**
 * Line reconstruction from the OCR layer.
 *
 * Tesseract (like the PDF text layer) only provides words with their box:
 * anchor strategies work on lines, which we rebuild by grouping words whose
 * vertical centers are close to each other.
 */

export interface LayoutWord extends OcrWord {
	/** Page index, 0 for the first one. */
	page: number;
}

export interface LayoutLineDetail {
	page: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	words: LayoutWord[];
	text: string;
	/** Offset of the first character of each word within `text`. */
	offsets: number[];
}

function centerY(word: OcrWord): number {
	return (word.y0 + word.y1) / 2;
}

function height(word: OcrWord): number {
	return Math.max(1, word.y1 - word.y0);
}

/** Assembles a line from words that have already been grouped. */
function makeLine(page: number, words: LayoutWord[]): LayoutLineDetail {
	const sorted = [...words].sort((a, b) => a.x0 - b.x0);
	const offsets: number[] = [];
	let text = "";
	for (const word of sorted) {
		if (text.length > 0) text += " ";
		offsets.push(text.length);
		text += word.text;
	}
	return {
		page,
		x0: Math.min(...sorted.map((word) => word.x0)),
		y0: Math.min(...sorted.map((word) => word.y0)),
		x1: Math.max(...sorted.map((word) => word.x1)),
		y1: Math.max(...sorted.map((word) => word.y1)),
		words: sorted,
		text,
		offsets,
	};
}

/** Groups the words of a page into lines, from top to bottom. */
export function buildPageLines(
	page: OcrPage,
	pageIndex: number,
): LayoutLineDetail[] {
	const words: LayoutWord[] = page.words
		.filter((word) => word.text.trim().length > 0)
		.map((word) => ({ ...word, page: pageIndex }))
		.sort((a, b) => centerY(a) - centerY(b) || a.x0 - b.x0);

	const lines: LayoutLineDetail[] = [];
	let bucket: LayoutWord[] = [];
	let reference = 0;
	let tolerance = 0;

	for (const word of words) {
		const center = centerY(word);
		if (bucket.length === 0) {
			bucket = [word];
			reference = center;
			tolerance = Math.max(2, height(word) * 0.6);
			continue;
		}
		if (Math.abs(center - reference) <= tolerance) {
			bucket.push(word);
			// Rolling average: a slanted line stays grouped.
			reference =
				bucket.reduce((total, item) => total + centerY(item), 0) /
				bucket.length;
			tolerance = Math.max(tolerance, Math.max(2, height(word) * 0.6));
			continue;
		}
		lines.push(makeLine(pageIndex, bucket));
		bucket = [word];
		reference = center;
		tolerance = Math.max(2, height(word) * 0.6);
	}
	if (bucket.length > 0) lines.push(makeLine(pageIndex, bucket));

	return lines;
}

/** All the lines of the document, pages in order. */
export function buildLines(layout: OcrLayout): LayoutLineDetail[] {
	return layout.pages.flatMap((page, index) => buildPageLines(page, index));
}

/** Simplified view returned by `extractionRule.preview`. */
export function toLayoutLines(layout: OcrLayout): LayoutLine[] {
	return buildLines(layout).map((line) => ({
		page: line.page,
		y: line.y0,
		text: line.text,
	}));
}

export function toBox(word: LayoutWord): ExtractionBox {
	return {
		text: word.text,
		x0: word.x0,
		y0: word.y0,
		x1: word.x1,
		y1: word.y1,
		conf: word.conf,
		page: word.page,
	};
}

/**
 * Average OCR confidence of the words used, scaled to 0-1. With no word (regex
 * over the raw text), the caller provides its own value.
 */
export function averageConfidence(words: LayoutWord[]): number {
	if (words.length === 0) return 0;
	const total = words.reduce((sum, word) => sum + word.conf, 0);
	return Math.min(1, Math.max(0, total / words.length / 100));
}
