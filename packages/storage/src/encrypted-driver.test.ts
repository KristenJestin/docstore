import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	deriveStorageMasterKey,
	ENCRYPTION_MAGIC,
	EncryptedStorageDriver,
	isEncryptedPayload,
	StorageDecryptionError,
} from "./encrypted-driver";
import { FsStorageDriver } from "./fs-driver";
import { documentFileKey } from "./keys";

let rootDir: string;
let plain: FsStorageDriver;
let driver: EncryptedStorageDriver;

const MASTER_KEY = deriveStorageMasterKey("secret-secret-secret-secret-1234");
const OTHER_KEY = deriveStorageMasterKey("another-another-another-anot-5678");

const KEY = documentFileKey("doc1", "file1", "pdf");
const CONTENT = "top secret payslip";

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "docstore-encrypted-"));
	plain = new FsStorageDriver({ rootDir });
	driver = new EncryptedStorageDriver(plain, { masterKey: MASTER_KEY });
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

async function rawBytes(key: string): Promise<Uint8Array> {
	return new Uint8Array(await (await plain.get(key)).arrayBuffer());
}

describe("EncryptedStorageDriver", () => {
	test("round-trip: put encrypts, get and stream decrypt", async () => {
		const data = new TextEncoder().encode(CONTENT);
		const { size } = await driver.put(KEY, data);
		// The announced size is the plaintext one.
		expect(size).toBe(data.byteLength);

		const stored = await rawBytes(KEY);
		expect(new TextDecoder().decode(stored.subarray(0, 4))).toBe(
			ENCRYPTION_MAGIC,
		);
		expect(isEncryptedPayload(stored)).toBe(true);
		// Header (4 + 12 + 16) plus the ciphertext, same length as the plaintext.
		expect(stored.byteLength).toBe(32 + data.byteLength);
		expect(new TextDecoder().decode(stored)).not.toContain(CONTENT);

		expect(await (await driver.get(KEY)).text()).toBe(CONTENT);
		expect(await new Response(driver.stream(KEY)).text()).toBe(CONTENT);
	});

	test("put accepts a Blob and a ReadableStream", async () => {
		await driver.put(KEY, new Blob([CONTENT]));
		expect(await (await driver.get(KEY)).text()).toBe(CONTENT);

		const streamKey = documentFileKey("doc1", "file2", "pdf");
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

	test("two objects with the same content produce different ciphertexts", async () => {
		const other = documentFileKey("doc2", "file1", "pdf");
		await driver.put(KEY, new TextEncoder().encode(CONTENT));
		await driver.put(other, new TextEncoder().encode(CONTENT));
		expect(await rawBytes(KEY)).not.toEqual(await rawBytes(other));
	});

	test("a wrong master key fails", async () => {
		await driver.put(KEY, new TextEncoder().encode(CONTENT));
		const wrong = new EncryptedStorageDriver(plain, { masterKey: OTHER_KEY });
		let caught: unknown;
		try {
			await wrong.get(KEY);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(StorageDecryptionError);
	});

	test("an object copied under another key no longer decrypts", async () => {
		await driver.put(KEY, new TextEncoder().encode(CONTENT));
		const moved = documentFileKey("doc9", "file9", "pdf");
		await plain.put(moved, await rawBytes(KEY));

		let caught: unknown;
		try {
			await driver.get(moved);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(StorageDecryptionError);
	});

	test("tampered ciphertext fails the GCM tag check", async () => {
		await driver.put(KEY, new TextEncoder().encode(CONTENT));
		const stored = await rawBytes(KEY);
		// Flip one bit of the ciphertext (past the 32-byte header).
		const tampered = new Uint8Array(stored);
		const last = tampered.length - 1;
		tampered[last] = (tampered[last] ?? 0) ^ 0x01;
		await plain.put(KEY, tampered);

		let caught: unknown;
		try {
			await driver.get(KEY);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(StorageDecryptionError);
	});

	test("a truncated object fails", async () => {
		await driver.put(KEY, new TextEncoder().encode(CONTENT));
		const stored = await rawBytes(KEY);
		await plain.put(KEY, stored.subarray(0, 10));

		let caught: unknown;
		try {
			await driver.get(KEY);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(StorageDecryptionError);
	});

	test("a non-encrypted object is passed through unchanged (migration)", async () => {
		await plain.put(KEY, new TextEncoder().encode("legacy plaintext"));
		expect(isEncryptedPayload(await rawBytes(KEY))).toBe(false);
		expect(await (await driver.get(KEY)).text()).toBe("legacy plaintext");
		expect(await new Response(driver.stream(KEY)).text()).toBe(
			"legacy plaintext",
		);
	});

	test("exists and delete pass through to the wrapped driver", async () => {
		expect(await driver.exists(KEY)).toBe(false);
		await driver.put(KEY, new TextEncoder().encode(CONTENT));
		expect(await driver.exists(KEY)).toBe(true);
		expect(await plain.exists(KEY)).toBe(true);
		await driver.delete(KEY);
		expect(await plain.exists(KEY)).toBe(false);
		// Idempotent, like the wrapped driver.
		await driver.delete(KEY);
	});

	test("deriveStorageMasterKey is deterministic and salt-dependent", () => {
		expect(deriveStorageMasterKey("abc")).toEqual(
			deriveStorageMasterKey("abc"),
		);
		expect(deriveStorageMasterKey("abc")).not.toEqual(
			deriveStorageMasterKey("abd"),
		);
		expect(deriveStorageMasterKey("abc")).not.toEqual(
			deriveStorageMasterKey("abc", "other-salt"),
		);
		expect(deriveStorageMasterKey("abc").byteLength).toBe(32);
	});

	test("a master key that is too short is refused", () => {
		expect(
			() =>
				new EncryptedStorageDriver(plain, { masterKey: new Uint8Array(16) }),
		).toThrow();
	});
});
