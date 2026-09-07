import { describe, expect, test } from "bun:test";
import { InvalidStorageKeyError } from "./driver";
import { documentFileKey, normalizeExtension, thumbnailKey } from "./keys";

describe("keys", () => {
	test("documentFileKey builds the expected key", () => {
		expect(documentFileKey("doc1", "file1", "pdf")).toBe(
			"documents/doc1/file1.pdf",
		);
	});

	test("documentFileKey normalizes the extension", () => {
		expect(documentFileKey("doc1", "file1", ".PDF")).toBe(
			"documents/doc1/file1.pdf",
		);
	});

	test("thumbnailKey is always png", () => {
		expect(thumbnailKey("doc1", "file1")).toBe("thumbnails/doc1/file1.png");
	});

	test("rejects identifiers containing a separator or ..", () => {
		expect(() => documentFileKey("../etc", "file1", "pdf")).toThrow(
			InvalidStorageKeyError,
		);
		expect(() => documentFileKey("doc1", "a/b", "pdf")).toThrow(
			InvalidStorageKeyError,
		);
		expect(() => thumbnailKey("..", "file1")).toThrow(InvalidStorageKeyError);
	});

	test("rejects an invalid extension", () => {
		expect(() => normalizeExtension("p/df")).toThrow(InvalidStorageKeyError);
		expect(() => normalizeExtension("")).toThrow(InvalidStorageKeyError);
	});
});
