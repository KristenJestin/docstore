import { describe, expect, test } from "bun:test";
import { UnsupportedMediaError } from "./errors";
import {
	extensionForMimeOrUndefined,
	fileExtension,
	normalizeMime,
	resolveAllowedMime,
	titleFromFilename,
} from "./media";

describe("media", () => {
	test("normalizes the mime", () => {
		expect(normalizeMime("APPLICATION/PDF; charset=binary")).toBe(
			"application/pdf",
		);
	});

	test("accepts the allowed types and their aliases", () => {
		expect(resolveAllowedMime("application/pdf", "a.pdf")).toBe(
			"application/pdf",
		);
		expect(resolveAllowedMime("image/jpg", "a.jpg")).toBe("image/jpeg");
		expect(resolveAllowedMime("image/tif", "a.tif")).toBe("image/tiff");
		expect(resolveAllowedMime("image/webp", "a.webp")).toBe("image/webp");
	});

	test("falls back to the extension when the mime is generic", () => {
		expect(resolveAllowedMime("application/octet-stream", "scan.PDF")).toBe(
			"application/pdf",
		);
		expect(resolveAllowedMime("", "photo.jpeg")).toBe("image/jpeg");
	});

	test("rejects the other types", () => {
		expect(() => resolveAllowedMime("text/plain", "notes.txt")).toThrow(
			UnsupportedMediaError,
		);
		expect(() =>
			resolveAllowedMime("application/octet-stream", "archive.zip"),
		).toThrow(UnsupportedMediaError);
	});

	test("storage extension", () => {
		expect(extensionForMimeOrUndefined("application/pdf")).toBe("pdf");
		expect(extensionForMimeOrUndefined("image/jpg")).toBe("jpg");
		expect(extensionForMimeOrUndefined("text/plain")).toBeUndefined();
	});

	test("default title is the file name without extension", () => {
		expect(titleFromFilename("Invoice 2024.pdf")).toBe("Invoice 2024");
		expect(titleFromFilename("C:\\scans\\edf.pdf")).toBe("edf");
		expect(titleFromFilename("no-extension")).toBe("no-extension");
		expect(titleFromFilename(".gitignore")).toBe(".gitignore");
	});

	test("extension of a file name", () => {
		expect(fileExtension("a/b/c.PNG")).toBe("png");
		expect(fileExtension("none")).toBe("");
	});
});
