import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { UnsupportedMediaError } from "../src/provider";
import { renderThumbnail } from "../src/thumbnail";
import { testTools } from "./tools";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const TEXT_LAYER_PDF = join(FIXTURES, "text-layer.pdf");
const SCANNED_PNG = join(FIXTURES, "scanned.png");

const TIMEOUT = 120_000;

describe("renderThumbnail", () => {
	test(
		"PDF -> PNG 400 px wide",
		async () => {
			const png = await renderThumbnail(
				testTools,
				{ path: TEXT_LAYER_PDF, mime: "application/pdf" },
				{ width: 400 },
			);
			const meta = await sharp(png).metadata();
			expect(meta.format).toBe("png");
			expect(meta.width).toBe(400);
			expect(meta.height).toBeGreaterThan(400);
		},
		TIMEOUT,
	);

	test(
		"image -> PNG 400 px wide",
		async () => {
			const png = await renderThumbnail(
				testTools,
				{ path: SCANNED_PNG, mime: "image/png" },
				{ width: 400 },
			);
			const meta = await sharp(png).metadata();
			expect(meta.format).toBe("png");
			expect(meta.width).toBe(400);
		},
		TIMEOUT,
	);

	test("unsupported type", async () => {
		await expect(
			renderThumbnail(testTools, {
				path: "/tmp/x.zip",
				mime: "application/zip",
			}),
		).rejects.toThrow(UnsupportedMediaError);
	});
});
