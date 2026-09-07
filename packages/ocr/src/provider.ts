import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import {
	hasUsableTextLayer,
	pdfInfo,
	pdfTextLayer,
	renderPdfPage,
} from "./pdf";
import { tesseractOcr } from "./tesseract";
import type { ResolvedTools } from "./tools";
import {
	DEFAULT_LANGUAGES,
	type OcrInput,
	type OcrOptions,
	type OcrPage,
	type OcrProvider,
	type OcrResult,
} from "./types";

const PDF_MIMES = new Set(["application/pdf", "application/x-pdf"]);
const IMAGE_MIMES = new Set([
	"image/png",
	"image/jpeg",
	"image/jpg",
	"image/pjpeg",
	"image/webp",
	"image/tiff",
	"image/tif",
	"image/bmp",
]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const IMAGE_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".webp",
	".tif",
	".tiff",
	".bmp",
]);

/** Content type not supported by the provider. */
export class UnsupportedMediaError extends Error {
	constructor(mime: string, path: string) {
		super(
			`Unsupported type for text extraction: "${mime}" (${path}). Expected a PDF or an image (png, jpeg, webp, tiff, bmp).`,
		);
		this.name = "UnsupportedMediaError";
	}
}

function normalizeMime(mime: string): string {
	return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

/** `pdf`, `image` or `undefined` if not supported. */
export function classifyInput(input: OcrInput): "pdf" | "image" | undefined {
	const mime = normalizeMime(input.mime);
	if (PDF_MIMES.has(mime)) return "pdf";
	if (IMAGE_MIMES.has(mime)) return "image";

	// Fall back on the extension: some intake sources (mail, watched folder)
	// provide `application/octet-stream`.
	const ext = extname(input.path).toLowerCase();
	if (PDF_EXTENSIONS.has(ext)) return "pdf";
	if (IMAGE_EXTENSIONS.has(ext)) return "image";
	return undefined;
}

/** Declared density of an image, 72 dpi by default. */
async function imageDensity(path: string): Promise<number> {
	try {
		const sharp = (await import("sharp")).default;
		const density = (await sharp(path).metadata()).density;
		return density && density > 0 ? density : 72;
	} catch {
		return 72;
	}
}

export interface DefaultOcrProviderOptions {
	/** Render resolution of the PDF pages before OCR (300 by default). */
	dpi?: number;
	/** Default Tesseract languages. */
	languages?: string[];
	/** Timeout per external binary call. */
	timeoutMs?: number;
}

/**
 * Default implementation (SPEC §1): the `pdftotext` text layer when it is
 * usable, otherwise a page-by-page render followed by Tesseract. Images go
 * straight through Tesseract.
 */
export class DefaultOcrProvider implements OcrProvider {
	private readonly tools: ResolvedTools;
	private readonly dpi: number;
	private readonly languages: string[];
	private readonly timeoutMs: number | undefined;

	constructor(tools: ResolvedTools, options: DefaultOcrProviderOptions = {}) {
		this.tools = tools;
		this.dpi = options.dpi ?? 300;
		this.languages = options.languages ?? [...DEFAULT_LANGUAGES];
		this.timeoutMs = options.timeoutMs;
	}

	async extract(input: OcrInput, opts: OcrOptions = {}): Promise<OcrResult> {
		const kind = classifyInput(input);
		const languages = opts.languages ?? this.languages;

		if (kind === "pdf") return await this.extractPdf(input.path, languages);
		if (kind === "image") return await this.extractImage(input.path, languages);
		throw new UnsupportedMediaError(input.mime, input.path);
	}

	private async extractPdf(
		path: string,
		languages: string[],
	): Promise<OcrResult> {
		const textLayer = await pdfTextLayer(this.tools, path);
		if (hasUsableTextLayer(textLayer)) return textLayer;

		const info = await pdfInfo(this.tools, path);
		const pages: OcrPage[] = [];
		const texts: string[] = [];

		const workDir = await mkdtemp(join(tmpdir(), "docstore-ocr-pages-"));
		try {
			for (let number = 1; number <= info.pageCount; number++) {
				const png = await renderPdfPage(this.tools, path, number, {
					dpi: this.dpi,
				});
				const imagePath = join(workDir, `page-${number}.png`);
				await writeFile(imagePath, png);
				const result = await tesseractOcr(this.tools, imagePath, {
					languages,
					dpi: this.dpi,
					timeoutMs: this.timeoutMs,
				});
				pages.push(result.page);
				texts.push(result.text);
				await rm(imagePath, { force: true });
			}
		} finally {
			await rm(workDir, { recursive: true, force: true });
		}

		return {
			text: texts.join("\n\n").trimEnd(),
			layout: { pages },
			source: "ocr",
		};
	}

	private async extractImage(
		path: string,
		languages: string[],
	): Promise<OcrResult> {
		const result = await tesseractOcr(this.tools, path, {
			languages,
			// The density declared in the image (72 when absent) is the reference
			// used to convert the bounding boxes into physical units.
			dpi: await imageDensity(path),
			timeoutMs: this.timeoutMs,
		});
		return {
			text: result.text.trimEnd(),
			layout: { pages: [result.page] },
			source: "ocr",
		};
	}
}
