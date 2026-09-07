import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidStorageKeyError, StorageNotFoundError } from "./driver";
import { FsStorageDriver } from "./fs-driver";
import { sha256 } from "./hash";
import { documentFileKey, thumbnailKey } from "./keys";

let rootDir: string;
let driver: FsStorageDriver;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "docstore-storage-"));
	driver = new FsStorageDriver({ rootDir });
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

const KEY = documentFileKey("doc1", "file1", "pdf");

describe("FsStorageDriver", () => {
	test("put/get/exists/delete on a Uint8Array", async () => {
		expect(await driver.exists(KEY)).toBe(false);

		const data = new TextEncoder().encode("hello");
		const { size } = await driver.put(KEY, data);
		expect(size).toBe(data.byteLength);

		expect(await driver.exists(KEY)).toBe(true);
		const blob = await driver.get(KEY);
		expect(await blob.text()).toBe("hello");

		await driver.delete(KEY);
		expect(await driver.exists(KEY)).toBe(false);
	});

	test("put accepts a Blob and a ReadableStream", async () => {
		await driver.put(KEY, new Blob(["blob-content"]));
		expect(await (await driver.get(KEY)).text()).toBe("blob-content");

		const streamKey = thumbnailKey("doc1", "file1");
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder();
				controller.enqueue(encoder.encode("stream-"));
				controller.enqueue(encoder.encode("content"));
				controller.close();
			},
		});
		const { size } = await driver.put(streamKey, stream);
		expect(size).toBe("stream-content".length);
		expect(await (await driver.get(streamKey)).text()).toBe("stream-content");
	});

	test("stream reads back the written content", async () => {
		await driver.put(KEY, new TextEncoder().encode("streamed"));
		const text = await new Response(driver.stream(KEY)).text();
		expect(text).toBe("streamed");
	});

	test("put creates intermediate directories and overwrites", async () => {
		await driver.put(KEY, new TextEncoder().encode("v1"));
		await driver.put(KEY, new TextEncoder().encode("v2-longer-content"));
		expect(await (await driver.get(KEY)).text()).toBe("v2-longer-content");
	});

	test("no temporary file remains after a write", async () => {
		await driver.put(KEY, new Blob(["x"]));
		const entries = await readdir(join(rootDir, "documents", "doc1"));
		expect(entries).toEqual(["file1.pdf"]);
	});

	test("get on a missing key rejects with StorageNotFoundError", async () => {
		await expect(driver.get(KEY)).rejects.toThrow(StorageNotFoundError);
	});

	test("delete is idempotent", async () => {
		await driver.delete(KEY);
		await driver.delete(KEY);
	});

	test("rejects directory traversal", async () => {
		const outside = join(rootDir, "..", "secret.txt");
		await writeFile(outside, "secret");
		try {
			const bad = [
				"../secret.txt",
				"documents/../../secret.txt",
				"documents/./doc1/file.pdf",
				"documents//file.pdf",
				"documents\\doc1\\file.pdf",
				"",
			];
			for (const key of bad) {
				expect(() => driver.pathFor(key)).toThrow(InvalidStorageKeyError);
				await expect(driver.exists(key)).rejects.toThrow(
					InvalidStorageKeyError,
				);
			}
		} finally {
			await rm(outside, { force: true });
		}
	});

	test("rejects absolute paths", () => {
		for (const key of ["/etc/passwd", "C:/Windows/system.ini"]) {
			expect(() => driver.pathFor(key)).toThrow(InvalidStorageKeyError);
		}
	});

	test("content read back has the same sha256 as the content written", async () => {
		const data = new TextEncoder().encode("abc");
		await driver.put(KEY, data);
		expect(await sha256(driver.stream(KEY))).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});
