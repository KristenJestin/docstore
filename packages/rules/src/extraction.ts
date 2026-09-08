import type { OcrLayout } from "@docstore/shared/document";
import type {
	ExtractionResult,
	ExtractionStrategy,
	PostprocessStep,
} from "@docstore/shared/extraction";
import type { LayoutLineDetail, LayoutWord } from "./layout";
import { averageConfidence, buildLines, buildPageLines, toBox } from "./layout";
import { applyPostprocess } from "./postprocess";
import { safeMatchRegex } from "./regex";

/**
 * Execution of extraction strategies (SPEC §4). A pure function: the text and
 * the OCR layer come in as input, nothing is read from the database.
 *
 * Patterns run with exactly the flags the rule carries. Nothing adds `i` on
 * the author's behalf: `NET À PAYER` is a heading, and matching it against
 * "net à payer" in a sentence lands the wrong line.
 */

export interface ExtractionInput {
	/** Concatenated text of the document (text layer or OCR). */
	text: string;
	/** Simplified hOCR layer; absent for a document without positioned words. */
	layout?: OcrLayout | null;
}

/** Confidence of a `regex` extraction: no bbox, hence no OCR measurement. */
export const REGEX_CONFIDENCE = 0.8;

const EMPTY_RESULT: ExtractionResult = {
	raw: null,
	value: null,
	confidence: 0,
};

type Segment = { words: LayoutWord[]; text: string; offsets: number[] };

function composeSegment(words: LayoutWord[]): Segment {
	const offsets: number[] = [];
	let text = "";
	for (const word of words) {
		if (text.length > 0) text += " ";
		offsets.push(text.length);
		text += word.text;
	}
	return { words, text, offsets };
}

/** Words of a segment whose text overlaps the `[start, end)` range. */
function wordsInRange(
	segment: Segment,
	start: number,
	end: number,
): LayoutWord[] {
	return segment.words.filter((word, index) => {
		const from = segment.offsets[index] ?? 0;
		const to = from + word.text.length;
		return from < end && to > start;
	});
}

function finish(
	raw: string | null,
	words: LayoutWord[] | null,
	confidence: number,
	postprocess: readonly PostprocessStep[],
): ExtractionResult {
	if (raw === null || raw.trim().length === 0) return EMPTY_RESULT;
	const { value, precision } = applyPostprocess(raw, postprocess);
	const result: ExtractionResult = {
		raw,
		value,
		confidence: value === null ? 0 : confidence,
	};
	if (words && words.length > 0) result.matchedWords = words.map(toBox);
	if (precision) result.precision = precision;
	return result;
}

function runRegex(
	strategy: Extract<ExtractionStrategy, { kind: "regex" }>,
	input: ExtractionInput,
	postprocess: readonly PostprocessStep[],
): ExtractionResult {
	const regex = safeMatchRegex(strategy.pattern, strategy.flags ?? "");
	if (!regex) return EMPTY_RESULT;
	const match = regex.exec(input.text);
	if (!match) return EMPTY_RESULT;
	const group = strategy.group ?? 1;
	const raw = match[group] ?? match[0] ?? null;
	return finish(raw, null, REGEX_CONFIDENCE, postprocess);
}

/** Applies `valuePattern` to the candidate text and narrows the words kept. */
function narrowToValue(
	segment: Segment,
	valuePattern: string | undefined,
	flags: string | undefined,
): { raw: string; words: LayoutWord[] } | null {
	const text = segment.text;
	if (!valuePattern) {
		const trimmed = text.trim();
		return trimmed.length > 0 ? { raw: trimmed, words: segment.words } : null;
	}
	const regex = safeMatchRegex(valuePattern, flags ?? "");
	if (!regex) return null;
	const match = regex.exec(text);
	if (!match) return null;
	const raw = match[1] ?? match[0];
	if (!raw || raw.trim().length === 0) return null;
	const start = match.index + (match[1] ? match[0].indexOf(match[1]) : 0);
	return {
		raw: raw.trim(),
		words: wordsInRange(segment, start, start + raw.length),
	};
}

function runAnchor(
	strategy: Extract<ExtractionStrategy, { kind: "anchor" }>,
	input: ExtractionInput,
	postprocess: readonly PostprocessStep[],
): ExtractionResult {
	if (!input.layout) return EMPTY_RESULT;
	const labelRegex = safeMatchRegex(strategy.label, strategy.flags ?? "");
	if (!labelRegex) return EMPTY_RESULT;

	const lines = buildLines(input.layout);

	for (const [index, line] of lines.entries()) {
		const match = labelRegex.exec(line.text);
		if (!match) continue;

		const labelStart = match.index;
		const labelEnd = match.index + match[0].length;
		const lineSegment: Segment = {
			words: line.words,
			text: line.text,
			offsets: line.offsets,
		};
		const labelWords = wordsInRange(lineSegment, labelStart, labelEnd);
		const labelX0 = Math.min(...labelWords.map((word) => word.x0));
		const labelX1 = Math.max(...labelWords.map((word) => word.x1));

		const segment = candidateSegment(
			strategy,
			lines,
			index,
			line,
			labelEnd,
			labelX0,
			labelX1,
		);
		if (!segment || segment.words.length === 0) continue;

		const narrowed = narrowToValue(
			segment,
			strategy.valuePattern,
			strategy.flags,
		);
		if (!narrowed) continue;

		return finish(
			narrowed.raw,
			narrowed.words,
			averageConfidence(
				narrowed.words.length > 0 ? narrowed.words : segment.words,
			),
			postprocess,
		);
	}

	return EMPTY_RESULT;
}

function candidateSegment(
	strategy: Extract<ExtractionStrategy, { kind: "anchor" }>,
	lines: LayoutLineDetail[],
	index: number,
	line: LayoutLineDetail,
	labelEnd: number,
	labelX0: number,
	labelX1: number,
): Segment | null {
	const lineSegment: Segment = {
		words: line.words,
		text: line.text,
		offsets: line.offsets,
	};

	if (strategy.position === "sameLine") {
		const after = line.words.filter((_word, position) => {
			const offset = lineSegment.offsets[position] ?? 0;
			return offset >= labelEnd;
		});
		return composeSegment(after);
	}

	if (strategy.position === "right") {
		const max = strategy.maxDistancePx;
		const right = line.words.filter(
			(word) =>
				word.x0 >= labelX1 && (max === undefined || word.x0 - labelX1 <= max),
		);
		return composeSegment(right);
	}

	// `nextLine` and `below` look at the following lines of the same page.
	const next = lines[index + 1];
	if (!next || next.page !== line.page) return null;

	if (strategy.position === "nextLine") {
		return composeSegment(next.words);
	}

	const max = strategy.maxDistancePx;
	if (max !== undefined && next.y0 - line.y1 > max) return null;
	const below = next.words.filter(
		(word) => word.x0 <= labelX1 && word.x1 >= labelX0,
	);
	return composeSegment(below);
}

function runZone(
	strategy: Extract<ExtractionStrategy, { kind: "zone" }>,
	input: ExtractionInput,
	postprocess: readonly PostprocessStep[],
): ExtractionResult {
	const pageIndex = (strategy.page ?? 1) - 1;
	const page = input.layout?.pages[pageIndex];
	if (!page) return EMPTY_RESULT;

	const left = Math.min(strategy.x0, strategy.x1) * page.width;
	const right = Math.max(strategy.x0, strategy.x1) * page.width;
	const top = Math.min(strategy.y0, strategy.y1) * page.height;
	const bottom = Math.max(strategy.y0, strategy.y1) * page.height;

	const inside = page.words.filter((word) => {
		const x = (word.x0 + word.x1) / 2;
		const y = (word.y0 + word.y1) / 2;
		return x >= left && x <= right && y >= top && y <= bottom;
	});
	if (inside.length === 0) return EMPTY_RESULT;

	// Reading order: rebuild the lines of the retained subset.
	const lines = buildPageLines({ ...page, words: inside }, pageIndex);
	const words = lines.flatMap((line) => line.words);
	const raw = lines
		.map((line) => line.text)
		.join(" ")
		.trim();

	return finish(raw, words, averageConfidence(words), postprocess);
}

/** Runs an extraction strategy and its postprocessing chain. */
export function runExtraction(
	strategy: ExtractionStrategy,
	postprocess: readonly PostprocessStep[],
	input: ExtractionInput,
): ExtractionResult {
	switch (strategy.kind) {
		case "regex":
			return runRegex(strategy, input, postprocess);
		case "anchor":
			return runAnchor(strategy, input, postprocess);
		default:
			return runZone(strategy, input, postprocess);
	}
}
