import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ExternalToolError,
	type ResolvedTools,
	runTool,
	runToolText,
} from "./tools";
import type { OcrLayout, OcrPage, OcrResult, OcrWord } from "./types";

/** The coordinate system of a PDF text layer is in points (1/72"). */
export const PDF_POINTS_DPI = 72;

export interface PdfPageInfo {
	/** Page number, starting at 1. */
	number: number;
	/** Width in points. */
	width: number;
	/** Height in points. */
	height: number;
	/** Declared rotation, in degrees. */
	rotation: number;
}

export interface PdfInfo {
	pageCount: number;
	pages: PdfPageInfo[];
	title?: string;
	encrypted: boolean;
}

function parseKeyValues(output: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const line of output.split(/\r?\n/)) {
		const index = line.indexOf(":");
		if (index <= 0) continue;
		map.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
	}
	return map;
}

const PAGE_SIZE_RE = /^Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/;
const PAGE_ROT_RE = /^Page\s+(\d+)\s+rot:\s+(-?\d+)/;

/** PDF metadata through `pdfinfo`: page count and dimensions. */
export async function pdfInfo(
	tools: ResolvedTools,
	path: string,
): Promise<PdfInfo> {
	const summary = await runToolText([tools.pdfinfo, path]);
	const values = parseKeyValues(summary);

	const pageCount = Number.parseInt(values.get("Pages") ?? "", 10);
	if (!Number.isFinite(pageCount) || pageCount <= 0) {
		throw new ExternalToolError(
			[tools.pdfinfo, path],
			0,
			summary,
			"unreadable page count",
		);
	}

	const detail = await runToolText([
		tools.pdfinfo,
		"-f",
		"1",
		"-l",
		String(pageCount),
		path,
	]);

	const sizes = new Map<number, { width: number; height: number }>();
	const rotations = new Map<number, number>();
	for (const line of detail.split(/\r?\n/)) {
		const size = PAGE_SIZE_RE.exec(line);
		if (size?.[1] && size[2] && size[3]) {
			sizes.set(Number.parseInt(size[1], 10), {
				width: Number.parseFloat(size[2]),
				height: Number.parseFloat(size[3]),
			});
			continue;
		}
		const rot = PAGE_ROT_RE.exec(line);
		if (rot?.[1] && rot[2]) {
			rotations.set(Number.parseInt(rot[1], 10), Number.parseInt(rot[2], 10));
		}
	}

	const pages: PdfPageInfo[] = [];
	for (let number = 1; number <= pageCount; number++) {
		const size = sizes.get(number) ?? { width: 0, height: 0 };
		pages.push({
			number,
			width: size.width,
			height: size.height,
			rotation: rotations.get(number) ?? 0,
		});
	}

	const title = values.get("Title");
	return {
		pageCount,
		pages,
		title: title && title.length > 0 ? title : undefined,
		encrypted: (values.get("Encrypted") ?? "no") !== "no",
	};
}

const XML_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

function decodeXml(value: string): string {
	return value.replace(
		/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
		(match, entity: string) => {
			if (entity.startsWith("#x") || entity.startsWith("#X")) {
				return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
			}
			if (entity.startsWith("#")) {
				return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
			}
			return XML_ENTITIES[entity] ?? match;
		},
	);
}

const PAGE_TAG_RE = /<page\b[^>]*>([\s\S]*?)<\/page>/g;
const WORD_TAG_RE = /<word\b([^>]*)>([\s\S]*?)<\/word>/g;

function attribute(attributes: string, name: string): number | undefined {
	const match = new RegExp(`${name}="([-\\d.eE]+)"`).exec(attributes);
	return match?.[1] === undefined ? undefined : Number.parseFloat(match[1]);
}

/**
 * Parses the XHTML produced by `pdftotext -bbox-layout` into an `OcrLayout`.
 * Exported so it can be tested without the external binary.
 */
export function parseBboxLayout(xhtml: string): OcrLayout {
	const pages: OcrPage[] = [];

	PAGE_TAG_RE.lastIndex = 0;
	let pageMatch = PAGE_TAG_RE.exec(xhtml);
	while (pageMatch !== null) {
		const openTag = /<page\b[^>]*>/.exec(pageMatch[0])?.[0] ?? "";
		const body = pageMatch[1] ?? "";
		const words: OcrWord[] = [];

		WORD_TAG_RE.lastIndex = 0;
		let wordMatch = WORD_TAG_RE.exec(body);
		while (wordMatch !== null) {
			const attrs = wordMatch[1] ?? "";
			const text = decodeXml(wordMatch[2] ?? "").trim();
			const x0 = attribute(attrs, "xMin");
			const y0 = attribute(attrs, "yMin");
			const x1 = attribute(attrs, "xMax");
			const y1 = attribute(attrs, "yMax");
			if (
				text.length > 0 &&
				x0 !== undefined &&
				y0 !== undefined &&
				x1 !== undefined &&
				y1 !== undefined
			) {
				words.push({ text, x0, y0, x1, y1, conf: 100 });
			}
			wordMatch = WORD_TAG_RE.exec(body);
		}

		pages.push({
			width: attribute(openTag, "width") ?? 0,
			height: attribute(openTag, "height") ?? 0,
			dpi: PDF_POINTS_DPI,
			words,
		});
		pageMatch = PAGE_TAG_RE.exec(xhtml);
	}

	return { pages };
}

/**
 * Extracts the text layer of a PDF.
 *
 * Two `pdftotext` calls: `-layout` for the readable text (its reading order is
 * better than in the XHTML) and `-bbox-layout` for the word coordinates.
 */
export async function pdfTextLayer(
	tools: ResolvedTools,
	path: string,
): Promise<OcrResult> {
	const [text, xhtml] = await Promise.all([
		runToolText([tools.pdftotext, "-layout", "-enc", "UTF-8", path, "-"]),
		runToolText([tools.pdftotext, "-bbox-layout", "-enc", "UTF-8", path, "-"]),
	]);

	return {
		text: text.replace(/\r\n/g, "\n").replace(/\f/g, "\n").trimEnd(),
		layout: parseBboxLayout(xhtml),
		source: "text-layer",
	};
}

/** Minimum average number of alphanumeric characters per page. */
export const MIN_ALNUM_PER_PAGE = 20;

/**
 * Heuristic: the text layer is usable when it holds on average at least
 * `MIN_ALNUM_PER_PAGE` alphanumeric characters per page. Scanned PDFs without
 * OCR have no text at all, and partially OCRed ones have far too little.
 */
export function hasUsableTextLayer(
	result: Pick<OcrResult, "text" | "layout">,
): boolean {
	const pageCount = Math.max(1, result.layout.pages.length);
	const alnum = result.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
	return alnum / pageCount >= MIN_ALNUM_PER_PAGE;
}

export interface RenderPageOptions {
	/** Render resolution, 300 by default. */
	dpi?: number;
	/** Grayscale rendering (faster and good enough for OCR). */
	grayscale?: boolean;
}

/** Renders a PDF page to PNG through `pdftoppm`. */
export async function renderPdfPage(
	tools: ResolvedTools,
	path: string,
	page: number,
	options: RenderPageOptions = {},
): Promise<Uint8Array> {
	const dpi = options.dpi ?? 300;
	const workDir = await mkdtemp(join(tmpdir(), "docstore-ocr-"));
	const prefix = join(workDir, "page");
	try {
		await runTool([
			tools.pdftoppm,
			"-r",
			String(dpi),
			"-f",
			String(page),
			"-l",
			String(page),
			"-png",
			...(options.grayscale === false ? [] : ["-gray"]),
			"-singlefile",
			path,
			prefix,
		]);
		return new Uint8Array(await readFile(`${prefix}.png`));
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}
