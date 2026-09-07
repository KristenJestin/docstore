import { mkdir, open, rename, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	InvalidStorageKeyError,
	type StorageDriver,
	type StorageInput,
	StorageNotFoundError,
} from "./driver";

export interface FsStorageDriverOptions {
	/** Bucket root on disk. Created on the fly if missing. */
	rootDir: string;
}

/**
 * Validates a storage key.
 *
 * A key is a sequence of segments separated by `/`, for example
 * `documents/<docId>/<fileId>.pdf`. Absolute paths, backslashes, `.`/`..`
 * segments and null bytes are rejected.
 */
export function assertValidKey(key: string): string {
	if (key.length === 0) {
		throw new InvalidStorageKeyError(key, "empty key");
	}
	if (key.includes("\0")) {
		throw new InvalidStorageKeyError(key, "null byte");
	}
	if (key.includes("\\")) {
		throw new InvalidStorageKeyError(key, "backslash not allowed");
	}
	if (key.startsWith("/") || isAbsolute(key) || /^[A-Za-z]:/.test(key)) {
		throw new InvalidStorageKeyError(key, "absolute path");
	}
	if (key.endsWith("/")) {
		throw new InvalidStorageKeyError(key, "ends with a separator");
	}
	for (const segment of key.split("/")) {
		if (segment.length === 0) {
			throw new InvalidStorageKeyError(key, "empty segment");
		}
		if (segment === "." || segment === "..") {
			throw new InvalidStorageKeyError(key, "directory traversal");
		}
	}
	return key;
}

/**
 * Writes a stream to a file and returns the number of bytes written.
 *
 * Written manually rather than through `Bun.write(path, new Response(stream))`:
 * that form hangs indefinitely on Bun 1.3 / Windows.
 */
async function writeStreamToFile(
	path: string,
	stream: ReadableStream<Uint8Array>,
): Promise<number> {
	const handle = await open(path, "w");
	const reader = stream.getReader();
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value && value.byteLength > 0) {
				await handle.write(value);
				size += value.byteLength;
			}
		}
	} catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	} finally {
		reader.releaseLock();
		await handle.close();
	}
	return size;
}

/** Local filesystem storage driver (default, see SPEC §1). */
export class FsStorageDriver implements StorageDriver {
	readonly rootDir: string;

	constructor(options: FsStorageDriverOptions) {
		this.rootDir = resolve(options.rootDir);
	}

	/** Absolute path matching a key, after validation. */
	pathFor(key: string): string {
		assertValidKey(key);
		const full = resolve(join(this.rootDir, key));
		const rel = relative(this.rootDir, full);
		if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) {
			throw new InvalidStorageKeyError(key, "escapes the storage root");
		}
		if (rel.split(sep).some((segment) => segment === "..")) {
			throw new InvalidStorageKeyError(key, "escapes the storage root");
		}
		return full;
	}

	async put(key: string, data: StorageInput): Promise<{ size: number }> {
		const target = this.pathFor(key);
		await mkdir(dirname(target), { recursive: true });
		const tmp = `${target}.${crypto.randomUUID()}.tmp`;
		try {
			const size =
				data instanceof ReadableStream
					? await writeStreamToFile(tmp, data)
					: await Bun.write(tmp, data);
			await rename(tmp, target);
			return { size };
		} catch (error) {
			await rm(tmp, { force: true });
			throw error;
		}
	}

	async get(key: string): Promise<Blob> {
		const file = Bun.file(this.pathFor(key));
		if (!(await file.exists())) {
			throw new StorageNotFoundError(key);
		}
		return file;
	}

	stream(key: string): ReadableStream<Uint8Array> {
		return Bun.file(this.pathFor(key)).stream();
	}

	async exists(key: string): Promise<boolean> {
		return await Bun.file(this.pathFor(key)).exists();
	}

	async delete(key: string): Promise<void> {
		const target = this.pathFor(key);
		try {
			await unlink(target);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
	}
}
