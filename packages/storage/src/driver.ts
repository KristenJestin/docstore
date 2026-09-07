/**
 * File storage contract (see SPEC §1 "File storage").
 *
 * Implementations receive their whole configuration by injection: they never
 * read `process.env`.
 */

/** Data accepted on write. */
export type StorageInput = Uint8Array | ReadableStream<Uint8Array> | Blob;

export interface StorageDriver {
	/** Writes `data` under `key` (overwrite allowed) and returns the written size. */
	put(key: string, data: StorageInput): Promise<{ size: number }>;
	/** Reads the whole object. Rejects with `StorageNotFoundError` if it does not exist. */
	get(key: string): Promise<Blob>;
	/** Lazy read stream. Does not check existence synchronously. */
	stream(key: string): ReadableStream<Uint8Array>;
	exists(key: string): Promise<boolean>;
	/** Deletes the object. Idempotent: does not reject if the key is absent. */
	delete(key: string): Promise<void>;
}

/** Invalid storage key (traversal, absolute path, empty segment...). */
export class InvalidStorageKeyError extends Error {
	readonly key: string;

	constructor(key: string, reason: string) {
		super(`Invalid storage key (${reason}): ${JSON.stringify(key)}`);
		this.name = "InvalidStorageKeyError";
		this.key = key;
	}
}

/** The requested object does not exist. */
export class StorageNotFoundError extends Error {
	readonly key: string;

	constructor(key: string) {
		super(`Object not found in storage: ${key}`);
		this.name = "StorageNotFoundError";
		this.key = key;
	}
}
