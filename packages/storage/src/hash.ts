import type { StorageInput } from "./driver";

function toHex(bytes: Uint8Array): string {
	let out = "";
	for (const byte of bytes) {
		out += byte.toString(16).padStart(2, "0");
	}
	return out;
}

/**
 * SHA-256 as lowercase hexadecimal.
 *
 * Accepts the same inputs as `StorageDriver.put`; streams are consumed
 * incrementally (never fully buffered in memory).
 */
export async function sha256(data: StorageInput | string): Promise<string> {
	const hasher = new Bun.CryptoHasher("sha256");

	if (typeof data === "string" || data instanceof Uint8Array) {
		hasher.update(data);
		return hasher.digest("hex");
	}

	const stream =
		data instanceof ReadableStream
			? data
			: (data.stream() as ReadableStream<Uint8Array>);
	const reader = stream.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) hasher.update(value);
		}
	} finally {
		reader.releaseLock();
	}
	return hasher.digest("hex");
}

/** Synchronous variant for data already held in memory. */
export function sha256Sync(data: Uint8Array | string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(data);
	return hasher.digest("hex");
}

/** SHA-256 through `crypto.subtle` (useful outside Bun, fully buffered in memory). */
export async function sha256Subtle(data: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		data.buffer.slice(
			data.byteOffset,
			data.byteOffset + data.byteLength,
		) as ArrayBuffer,
	);
	return toHex(new Uint8Array(digest));
}
