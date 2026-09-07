import { describe, expect, test } from "bun:test";
import {
	MissingToolError,
	resolveExecutable,
	resolveTools,
} from "../src/tools";
import { testToolOptions, testTools } from "./tools";

describe("resolveTools", () => {
	test("resolves the binaries of the machine", () => {
		expect(testTools.tesseract).toBeString();
		expect(testTools.pdftotext).toBeString();
		expect(testTools.pdftoppm).toBeString();
		expect(testTools.pdfinfo).toBeString();
	});

	test("a bogus tesseract path gives an explicit error", () => {
		expect(() =>
			resolveTools({ ...testToolOptions, tesseractPath: "/n/existe/pas/tess" }),
		).toThrow(MissingToolError);

		try {
			resolveTools({ ...testToolOptions, tesseractPath: "/n/existe/pas/tess" });
			throw new Error("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(MissingToolError);
			expect((error as MissingToolError).tool).toBe("tesseract");
			expect((error as Error).message).toContain("not found");
			expect((error as Error).message).toContain("tess");
		}
	});

	test("a bogus poppler directory gives an explicit error", () => {
		expect(() =>
			resolveTools({
				...testToolOptions,
				popplerPath: "/n/existe/pas/poppler",
			}),
		).toThrow(MissingToolError);
	});

	test("a bogus tessdataPrefix gives an explicit error", () => {
		expect(() =>
			resolveTools({
				...testToolOptions,
				tessdataPrefix: "/n/existe/pas/data",
			}),
		).toThrow(MissingToolError);
	});

	test("a binary unknown to the PATH gives an explicit error", () => {
		expect(() => resolveExecutable("binaire-docstore-inexistant")).toThrow(
			MissingToolError,
		);
	});
});
