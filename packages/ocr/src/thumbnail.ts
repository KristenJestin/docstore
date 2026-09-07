import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyInput, UnsupportedMediaError } from "./provider";
import { type ResolvedTools, runTool } from "./tools";
import type { OcrInput } from "./types";

export interface ThumbnailOptions {
	/** Target width in pixels (400 by default). The height follows the ratio. */
	width?: number;
	/** PDF page to render (1 by default). */
	page?: number;
	timeoutMs?: number;
}

/** Default thumbnail width (SPEC §5, `render` step). */
export const DEFAULT_THUMBNAIL_WIDTH = 400;

/**
 * Produces a PNG thumbnail.
 *
 * PDF: `pdftoppm -scale-to-x <width> -scale-to-y -1` (unlike `-scale-to`,
 * which constrains the largest dimension and would not guarantee the requested
 * width). Images: `sharp`.
 */
export async function renderThumbnail(
	tools: ResolvedTools,
	input: OcrInput,
	options: ThumbnailOptions = {},
): Promise<Uint8Array> {
	const width = options.width ?? DEFAULT_THUMBNAIL_WIDTH;
	const kind = classifyInput(input);

	if (kind === "pdf") {
		const page = options.page ?? 1;
		const workDir = await mkdtemp(join(tmpdir(), "docstore-thumb-"));
		const prefix = join(workDir, "thumb");
		try {
			await runTool(
				[
					tools.pdftoppm,
					"-f",
					String(page),
					"-l",
					String(page),
					"-png",
					"-singlefile",
					"-scale-to-x",
					String(width),
					"-scale-to-y",
					"-1",
					input.path,
					prefix,
				],
				{ timeoutMs: options.timeoutMs },
			);
			return new Uint8Array(await readFile(`${prefix}.png`));
		} finally {
			await rm(workDir, { recursive: true, force: true });
		}
	}

	if (kind === "image") {
		const sharp = (await import("sharp")).default;
		const buffer = await sharp(input.path)
			.resize({ width, withoutEnlargement: false })
			.png()
			.toBuffer();
		return new Uint8Array(buffer);
	}

	throw new UnsupportedMediaError(input.mime, input.path);
}
