/**
 * Types of the text extraction pipeline (SPEC §5, `extract_text` step).
 *
 * The layout is stored as-is in `document_files.ocr_layout` (JSONB).
 */

/** A word with its bounding box. */
export interface OcrWord {
	text: string;
	/** Left edge, in the page coordinate system (origin at the top left). */
	x0: number;
	/** Top edge. */
	y0: number;
	/** Right edge. */
	x1: number;
	/** Bottom edge. */
	y1: number;
	/** Confidence out of 0-100. Always 100 for a native text layer. */
	conf: number;
}

/**
 * A page.
 *
 * `width`/`height` and the word coordinates are expressed in the same unit:
 * the pixels of the image rendered at `dpi`. For a PDF text layer, the
 * coordinate system is the PDF one (points), so `dpi` is 72.
 */
export interface OcrPage {
	width: number;
	height: number;
	dpi: number;
	words: OcrWord[];
}

export interface OcrLayout {
	pages: OcrPage[];
}

/** Origin of the text: PDF text layer or optical recognition. */
export type OcrSource = "text-layer" | "ocr";

export interface OcrResult {
	text: string;
	layout: OcrLayout;
	source: OcrSource;
}

export interface OcrInput {
	/** Absolute path of the file on disk. */
	path: string;
	/** MIME type (`application/pdf`, `image/png`, ...). */
	mime: string;
}

export interface OcrOptions {
	/** Tesseract language codes, e.g. `["fra", "eng"]`. */
	languages?: string[];
}

/** Extraction contract, to plug in another engine (SPEC §1). */
export interface OcrProvider {
	extract(input: OcrInput, opts?: OcrOptions): Promise<OcrResult>;
}

/** Default languages: French then English. */
export const DEFAULT_LANGUAGES = ["fra", "eng"] as const;

/** Creates an empty page. */
export function emptyPage(width: number, height: number, dpi: number): OcrPage {
	return { width, height, dpi, words: [] };
}
