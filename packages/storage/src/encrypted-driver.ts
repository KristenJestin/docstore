import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import type { StorageDriver, StorageInput } from "./driver";

/**
 * Encryption at rest for sensitive documents (SPEC §2 "Document", §8
 * iteration 7).
 *
 * `EncryptedStorageDriver` wraps any `StorageDriver`: `put` encrypts, `get` and
 * `stream` decrypt, `exists` and `delete` pass straight through. The wrapper
 * owns no storage of its own — the same key holds the encrypted object, so a
 * document can be re-keyed in place (see `setSensitive` in
 * `@docstore/ingestion`).
 *
 * Object layout:
 *
 * ```text
 * "DSE1" (4 bytes) | iv (12 bytes) | GCM tag (16 bytes) | ciphertext
 * ```
 *
 * The data key is derived per object with HKDF-SHA256 from the master key,
 * using the storage key as `info`: two objects never share a key, and a
 * ciphertext copied under another key no longer decrypts.
 *
 * Reading an object that does **not** start with the magic header returns it
 * unchanged. That is what makes migration possible: files written before the
 * document was flagged sensitive stay readable through this driver.
 *
 * v1 limitation: `stream` buffers the whole object in memory before decrypting
 * (AES-GCM only authenticates once the tag has been read). Documents are capped
 * at 20 MB (`UPLOAD_LINK_MAX_FILE_BYTES`, MCP `upload_document`), so the cost is
 * bounded. Streaming decryption would require a chunked format.
 */

/** Magic header identifying an object written by this driver. */
export const ENCRYPTION_MAGIC = "DSE1";

const MAGIC_BYTES = new TextEncoder().encode(ENCRYPTION_MAGIC);
const MAGIC_LENGTH = MAGIC_BYTES.length;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC_LENGTH + IV_LENGTH + TAG_LENGTH;
const ALGORITHM = "aes-256-gcm";
const DATA_KEY_LENGTH = 32;

/** HKDF salt for the per-object data keys. */
const HKDF_SALT = "docstore-storage-object";

/** Minimum length of the master key. */
export const MASTER_KEY_MIN_LENGTH = 32;

/** The object could not be decrypted (wrong key, truncated or tampered). */
export class StorageDecryptionError extends Error {
	readonly key: string;

	constructor(key: string, reason: string) {
		super(`Could not decrypt "${key}" (${reason}).`);
		this.name = "StorageDecryptionError";
		this.key = key;
	}
}

export interface EncryptedStorageDriverOptions {
	/** Master key, 32 bytes minimum (see `deriveStorageMasterKey`). */
	masterKey: Uint8Array;
}

/** True when the buffer starts with the `DSE1` header. */
export function isEncryptedPayload(bytes: Uint8Array): boolean {
	if (bytes.byteLength < MAGIC_LENGTH) return false;
	for (let index = 0; index < MAGIC_LENGTH; index += 1) {
		if (bytes[index] !== MAGIC_BYTES[index]) return false;
	}
	return true;
}

function toBuffer(bytes: Uint8Array): Buffer {
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Reads any `StorageInput` fully into memory (see the v1 limitation above). */
async function toBytes(data: StorageInput): Promise<Uint8Array> {
	if (data instanceof Uint8Array) return data;
	if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
	return new Uint8Array(await new Response(data).arrayBuffer());
}

export class EncryptedStorageDriver implements StorageDriver {
	readonly inner: StorageDriver;
	private readonly masterKey: Buffer;

	constructor(inner: StorageDriver, options: EncryptedStorageDriverOptions) {
		if (options.masterKey.byteLength < MASTER_KEY_MIN_LENGTH) {
			throw new Error(
				`The storage master key must be at least ${MASTER_KEY_MIN_LENGTH} bytes.`,
			);
		}
		this.inner = inner;
		this.masterKey = toBuffer(options.masterKey);
	}

	/** Per-object key: HKDF-SHA256(masterKey, salt, info = storage key). */
	private dataKey(key: string): Buffer {
		return Buffer.from(
			hkdfSync("sha256", this.masterKey, HKDF_SALT, key, DATA_KEY_LENGTH),
		);
	}

	/** `DSE1 | iv | tag | ciphertext` for the given plaintext. */
	encryptBytes(key: string, plaintext: Uint8Array): Uint8Array {
		const iv = randomBytes(IV_LENGTH);
		const cipher = createCipheriv(ALGORITHM, this.dataKey(key), iv);
		const ciphertext = Buffer.concat([
			cipher.update(toBuffer(plaintext)),
			cipher.final(),
		]);
		return new Uint8Array(
			Buffer.concat([
				Buffer.from(MAGIC_BYTES),
				iv,
				cipher.getAuthTag(),
				ciphertext,
			]),
		);
	}

	/** Reverse of `encryptBytes`; a payload without the header is returned as-is. */
	decryptBytes(key: string, payload: Uint8Array): Uint8Array {
		if (!isEncryptedPayload(payload)) return payload;
		if (payload.byteLength < HEADER_LENGTH) {
			throw new StorageDecryptionError(key, "truncated header");
		}
		const buffer = toBuffer(payload);
		const iv = buffer.subarray(MAGIC_LENGTH, MAGIC_LENGTH + IV_LENGTH);
		const tag = buffer.subarray(MAGIC_LENGTH + IV_LENGTH, HEADER_LENGTH);
		const ciphertext = buffer.subarray(HEADER_LENGTH);
		try {
			const decipher = createDecipheriv(ALGORITHM, this.dataKey(key), iv);
			decipher.setAuthTag(tag);
			return new Uint8Array(
				Buffer.concat([decipher.update(ciphertext), decipher.final()]),
			);
		} catch {
			throw new StorageDecryptionError(key, "wrong key or tampered content");
		}
	}

	async put(key: string, data: StorageInput): Promise<{ size: number }> {
		const plaintext = await toBytes(data);
		await this.inner.put(key, this.encryptBytes(key, plaintext));
		// The announced size is the plaintext one: callers store it in
		// `document_file.size` and serve it as `Content-Length`.
		return { size: plaintext.byteLength };
	}

	async get(key: string): Promise<Blob> {
		const blob = await this.inner.get(key);
		const payload = new Uint8Array(await blob.arrayBuffer());
		const plaintext = this.decryptBytes(key, payload);
		// Detached copy of the bytes: `Uint8Array<ArrayBufferLike>` is not a
		// `BlobPart` under the DOM lib, and the buffer must not be shared.
		const buffer = plaintext.buffer.slice(
			plaintext.byteOffset,
			plaintext.byteOffset + plaintext.byteLength,
		) as ArrayBuffer;
		return new Blob([buffer]);
	}

	stream(key: string): ReadableStream<Uint8Array> {
		// Buffered: AES-GCM only authenticates once the whole object is read.
		const driver = this;
		return new ReadableStream<Uint8Array>({
			async start(controller) {
				try {
					const blob = await driver.get(key);
					controller.enqueue(new Uint8Array(await blob.arrayBuffer()));
					controller.close();
				} catch (error) {
					controller.error(error);
				}
			},
		});
	}

	exists(key: string): Promise<boolean> {
		return this.inner.exists(key);
	}

	delete(key: string): Promise<void> {
		return this.inner.delete(key);
	}
}

/**
 * Master key derived from the application secret (`APP_SECRET`).
 *
 * HKDF-SHA256, salt `docstore-storage`: the storage key is separate from the
 * one that protects stored secrets (`crypto.service`), so the two uses never
 * share key material.
 *
 * Rotating `APP_SECRET` is **not** supported in v1: the existing objects would
 * become unreadable (see `docs/security.md`).
 */
export function deriveStorageMasterKey(
	secret: string,
	salt = "docstore-storage",
): Uint8Array {
	return new Uint8Array(
		hkdfSync("sha256", secret, salt, "storage-master-key", DATA_KEY_LENGTH),
	);
}

/** Constant-time comparison, used by the tests and by the share-link tokens. */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	return timingSafeEqual(toBuffer(a), toBuffer(b));
}
