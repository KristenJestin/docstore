import { describe, expect, test } from "bun:test";
import { sha256, sha256Subtle, sha256Sync } from "./hash";

// Known test vector: SHA-256("abc").
const ABC_SHA256 =
	"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const EMPTY_SHA256 =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("sha256", () => {
	test("known hash for a string", async () => {
		expect(await sha256("abc")).toBe(ABC_SHA256);
	});

	test("known hash for a Uint8Array", async () => {
		expect(await sha256(new TextEncoder().encode("abc"))).toBe(ABC_SHA256);
	});

	test("known hash for a Blob", async () => {
		expect(await sha256(new Blob(["a", "b", "c"]))).toBe(ABC_SHA256);
	});

	test("known hash for a ReadableStream", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder();
				controller.enqueue(encoder.encode("a"));
				controller.enqueue(encoder.encode("bc"));
				controller.close();
			},
		});
		expect(await sha256(stream)).toBe(ABC_SHA256);
	});

	test("hash of empty input", async () => {
		expect(await sha256(new Uint8Array())).toBe(EMPTY_SHA256);
	});

	test("sync and subtle variants agree", async () => {
		const bytes = new TextEncoder().encode("abc");
		expect(sha256Sync(bytes)).toBe(ABC_SHA256);
		expect(await sha256Subtle(bytes)).toBe(ABC_SHA256);
	});
});
