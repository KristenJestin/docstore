import {
	ExternalToolError,
	type ResolvedTools,
	runToolText,
	tesseractEnv,
} from "./tools";
import { DEFAULT_LANGUAGES, type OcrPage, type OcrWord } from "./types";

/** TSV level corresponding to a word. */
const LEVEL_WORD = 5;
/** TSV level corresponding to the whole page. */
const LEVEL_PAGE = 1;

const TSV_HEADER =
	"level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

interface TsvRow {
	level: number;
	block: number;
	par: number;
	line: number;
	left: number;
	top: number;
	width: number;
	height: number;
	conf: number;
	text: string;
}

function parseRow(line: string): TsvRow | undefined {
	const cells = line.split("\t");
	if (cells.length < 12) return undefined;
	const num = (index: number): number => Number.parseFloat(cells[index] ?? "");
	const level = num(0);
	if (!Number.isFinite(level)) return undefined;
	return {
		level,
		block: num(2),
		par: num(3),
		line: num(4),
		left: num(6),
		top: num(7),
		width: num(8),
		height: num(9),
		conf: num(10),
		// Extra columns are rare but possible when the text itself contains a
		// tab: glue everything back together.
		text: cells.slice(11).join("\t").replace(/\r$/, ""),
	};
}

export interface TesseractPageResult {
	page: OcrPage;
	text: string;
}

/**
 * Parses the Tesseract TSV output into a layout page and its reconstructed
 * text (words separated by a space, lines by a line break, paragraphs by a
 * blank line). Exported so it can be tested without the binary.
 */
export function parseTesseractTsv(
	tsv: string,
	dpi: number,
): TesseractPageResult {
	const words: OcrWord[] = [];
	let width = 0;
	let height = 0;

	const paragraphs: string[] = [];
	let currentLines: string[] = [];
	let currentWords: string[] = [];
	let currentKey: string | undefined;
	let currentLine: number | undefined;

	const flushLine = (): void => {
		if (currentWords.length > 0) currentLines.push(currentWords.join(" "));
		currentWords = [];
	};
	const flushParagraph = (): void => {
		flushLine();
		if (currentLines.length > 0) paragraphs.push(currentLines.join("\n"));
		currentLines = [];
	};

	for (const raw of tsv.split(/\r?\n/)) {
		if (raw.length === 0 || raw.startsWith("level\t")) continue;
		const row = parseRow(raw);
		if (!row) continue;

		if (row.level === LEVEL_PAGE) {
			width = row.width;
			height = row.height;
			continue;
		}
		if (row.level !== LEVEL_WORD) continue;

		const text = row.text.trim();
		if (text.length === 0) continue;

		words.push({
			text,
			x0: row.left,
			y0: row.top,
			x1: row.left + row.width,
			y1: row.top + row.height,
			conf: Number.isFinite(row.conf) ? row.conf : 0,
		});

		const key = `${row.block}/${row.par}`;
		if (currentKey !== undefined && key !== currentKey) {
			flushParagraph();
			currentLine = undefined;
		}
		currentKey = key;
		if (currentLine !== undefined && row.line !== currentLine) flushLine();
		currentLine = row.line;
		currentWords.push(text);
	}
	flushParagraph();

	return {
		page: { width, height, dpi, words },
		text: paragraphs.join("\n\n"),
	};
}

export interface TesseractOptions {
	languages?: string[];
	/** Page segmentation mode, 3 (auto) by default. */
	psm?: number;
	/** Resolution of the source image, reported in the layout. */
	dpi?: number;
	timeoutMs?: number;
}

/**
 * Runs Tesseract on an image and returns the layout and the text.
 *
 * The TSV is requested through `-c tessedit_create_tsv=1` rather than the
 * `tsv` config file: that file lives in `<tessdata>/configs/`, which is absent
 * when `TESSDATA_PREFIX` points at a directory holding only the
 * `*.traineddata` files (the case on our dev machine). Tesseract then silently
 * ignores the config name and falls back to plain text.
 */
export async function tesseractOcr(
	tools: ResolvedTools,
	imagePath: string,
	options: TesseractOptions = {},
): Promise<TesseractPageResult> {
	const languages = options.languages ?? [...DEFAULT_LANGUAGES];
	const command = [
		tools.tesseract,
		imagePath,
		"stdout",
		"-l",
		languages.join("+"),
		"--psm",
		String(options.psm ?? 3),
		"-c",
		"tessedit_create_tsv=1",
	];

	const tsv = await runToolText(command, {
		env: tesseractEnv(tools),
		timeoutMs: options.timeoutMs,
	});

	if (!tsv.startsWith(TSV_HEADER)) {
		throw new ExternalToolError(
			command,
			0,
			tsv.slice(0, 500),
			"unexpected TSV output",
		);
	}

	return parseTesseractTsv(tsv, options.dpi ?? 0);
}
