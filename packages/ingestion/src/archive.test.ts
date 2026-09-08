import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import {
	archiveContent,
	declaresArchive,
	entryBasename,
	expandArchive,
	isJunkEntry,
	readArchiveEntries,
	sniffArchive,
} from "./archive";
import { ArchiveError } from "./errors";
import { FIXTURES, readFixture } from "./test-utils";

const text = (value: string) => new TextEncoder().encode(value);

/** Flips the "encrypted" bit of every central directory record. */
function markEncrypted(zip: Uint8Array): Uint8Array {
	const copy = new Uint8Array(zip);
	for (let offset = 0; offset + 10 < copy.length; offset++) {
		const signature =
			copy[offset] === 0x50 &&
			copy[offset + 1] === 0x4b &&
			copy[offset + 2] === 0x01 &&
			copy[offset + 3] === 0x02;
		if (signature) copy[offset + 8] = (copy[offset + 8] ?? 0) | 0x01;
	}
	return copy;
}

describe("sniffArchive", () => {
	test("recognizes a ZIP and nothing else", async () => {
		expect(sniffArchive(zipSync({ "a.txt": text("a") }))).toBe(true);
		expect(sniffArchive(zipSync({}))).toBe(true);
		expect(sniffArchive(await readFixture(FIXTURES.textLayerPdf))).toBe(false);
		expect(sniffArchive(text("PK"))).toBe(false);
	});
});

describe("declaresArchive", () => {
	test("accepts the declared types and the extension", () => {
		expect(declaresArchive("application/zip", "batch.bin")).toBe(true);
		expect(declaresArchive("application/x-zip-compressed", "batch")).toBe(true);
		expect(declaresArchive("application/octet-stream", "batch.ZIP")).toBe(true);
		expect(declaresArchive("application/pdf", "invoice.pdf")).toBe(false);
	});
});

describe("isJunkEntry", () => {
	test("drops archiver debris and hidden files", () => {
		expect(isJunkEntry("__MACOSX/._invoice.pdf")).toBe(true);
		expect(isJunkEntry("batch/__MACOSX/._x.pdf")).toBe(true);
		expect(isJunkEntry(".DS_Store")).toBe(true);
		expect(isJunkEntry("folder/Thumbs.db")).toBe(true);
		expect(isJunkEntry("folder/.hidden.pdf")).toBe(true);
		expect(isJunkEntry("2026/invoice.pdf")).toBe(false);
	});
});

describe("entryBasename", () => {
	test("keeps the last segment of a ZIP path", () => {
		expect(entryBasename("2026/03/edf.pdf")).toBe("edf.pdf");
		expect(entryBasename("edf.pdf")).toBe("edf.pdf");
	});
});

describe("readArchiveEntries", () => {
	test("reads the central directory", () => {
		const entries = readArchiveEntries(
			zipSync({ "a.txt": text("hello"), "sub/b.txt": text("world") }),
		);
		expect(entries.map((entry) => entry.name).sort()).toEqual([
			"a.txt",
			"sub/b.txt",
		]);
		expect(entries.every((entry) => entry.uncompressedSize === 5)).toBe(true);
	});

	test("refuses something that is not a ZIP", () => {
		expect(() => readArchiveEntries(text("not a zip at all"))).toThrow(
			ArchiveError,
		);
	});
});

describe("expandArchive", () => {
	test("keeps the supported files and reports the rest", async () => {
		const pdf = await readFixture(FIXTURES.textLayerPdf);
		const png = await readFixture(FIXTURES.scannedPng);
		const zip = zipSync({
			"invoice.pdf": pdf,
			"scan.png": png,
			"notes.txt": text("nothing to see"),
			"__MACOSX/._invoice.pdf": text("resource fork"),
			".DS_Store": text("junk"),
		});

		const result = expandArchive(zip);
		expect(result.files.map((file) => file.entry).sort()).toEqual([
			"invoice.pdf",
			"scan.png",
		]);
		expect(result.files.map((file) => file.mime).sort()).toEqual([
			"application/pdf",
			"image/png",
		]);

		const skipped = new Map(
			result.skipped.map((entry) => [entry.entry, entry.reason]),
		);
		expect(skipped.get("notes.txt")).toBe("unsupported");
		expect(skipped.get("__MACOSX/._invoice.pdf")).toBe("junk");
		expect(skipped.get(".DS_Store")).toBe("junk");
	});

	test("expands a nested archive one level down", async () => {
		const pdf = await readFixture(FIXTURES.textLayerPdf);
		const inner = zipSync({ "inner.pdf": pdf });
		const zip = zipSync({ "outer.pdf": pdf, "nested.zip": inner });

		const result = expandArchive(zip);
		expect(result.files.map((file) => file.entry).sort()).toEqual([
			"nested.zip!inner.pdf",
			"outer.pdf",
		]);
	});

	test("stops at the second level of nesting", async () => {
		const pdf = await readFixture(FIXTURES.textLayerPdf);
		const deepest = zipSync({ "deep.pdf": pdf });
		const middle = zipSync({ "deepest.zip": deepest });
		const zip = zipSync({ "middle.zip": middle });

		const result = expandArchive(zip);
		expect(result.files).toHaveLength(0);
		expect(result.skipped).toEqual([
			{
				entry: "middle.zip!deepest.zip",
				reason: "nested",
				message: "Nested archives are only expanded one level deep.",
			},
		]);
	});

	test("refuses an archive holding too many entries", () => {
		const entries: Record<string, Uint8Array> = {};
		for (let index = 0; index < 12; index++) {
			entries[`file-${index}.txt`] = text(`file ${index}`);
		}
		expect(() => expandArchive(zipSync(entries), { maxEntries: 10 })).toThrow(
			ArchiveError,
		);
	});

	test("refuses an archive that expands beyond the cap", async () => {
		const pdf = await readFixture(FIXTURES.textLayerPdf);
		expect(() =>
			expandArchive(zipSync({ "a.pdf": pdf }), { maxBytes: 10 }),
		).toThrow(ArchiveError);
	});

	test("refuses a zip bomb on its expansion ratio", () => {
		// Four megabytes of zeros: a couple of kilobytes once deflated.
		const zeros = new Uint8Array(4 * 1024 * 1024);
		let thrown: unknown;
		try {
			expandArchive(zipSync({ "bomb.bin": zeros }));
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(ArchiveError);
		expect((thrown as Error).message).toContain("times its own size");
	});

	test("refuses a password-protected archive", () => {
		const zip = markEncrypted(zipSync({ "secret.pdf": text("%PDF-1.4") }));
		let thrown: unknown;
		try {
			expandArchive(zip);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(ArchiveError);
		expect((thrown as Error).message).toContain("password-protected");
	});

	test("refuses a corrupt archive", () => {
		const zip = zipSync({ "a.txt": text("hello") });
		// The end-of-central-directory is the last thing in the file.
		expect(() => expandArchive(zip.subarray(0, zip.length - 8))).toThrow(
			ArchiveError,
		);
	});
});

describe("archiveContent", () => {
	test("lists the entries a kept archive holds", () => {
		const entries = readArchiveEntries(
			zipSync({
				"2026/edf.pdf": text("%PDF-"),
				"__MACOSX/._edf.pdf": text("junk"),
			}),
		);
		expect(archiveContent(entries)).toBe("2026/edf.pdf");
	});
});
