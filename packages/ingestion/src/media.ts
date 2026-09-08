import { ARCHIVE_MIME_ALIASES } from "@docstore/shared/archive";
import { UnsupportedMediaError } from "./errors";

/**
 * Types accepted at intake (SPEC §5) and their storage extension.
 */
export const ALLOWED_MIMES = {
	"application/pdf": "pdf",
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/tiff": "tif",
} as const;

export type AllowedMime = keyof typeof ALLOWED_MIMES;

/** Variants met in the wild, mapped back to the canonical type. */
const MIME_ALIASES: Record<string, AllowedMime> = {
	"application/x-pdf": "application/pdf",
	"application/acrobat": "application/pdf",
	"image/jpg": "image/jpeg",
	"image/pjpeg": "image/jpeg",
	"image/tif": "image/tiff",
	"image/x-tiff": "image/tiff",
};

/** Fallback extensions when the mime is generic (`octet-stream`). */
const EXTENSION_MIMES: Record<string, AllowedMime> = {
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	tif: "image/tiff",
	tiff: "image/tiff",
};

/** Lowercased, with parameters (`; charset=…`) stripped. */
export function normalizeMime(mime: string): string {
	return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

/** Extension of a file name, without the dot, lowercased. */
export function fileExtension(filename: string): string {
	const base = filename.split(/[\\/]/).pop() ?? filename;
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** File name without path nor extension, used as the default title. */
export function titleFromFilename(filename: string): string {
	const base = (filename.split(/[\\/]/).pop() ?? filename).trim();
	const dot = base.lastIndexOf(".");
	const stem = dot > 0 ? base.slice(0, dot) : base;
	return stem.trim().length > 0 ? stem.trim() : base;
}

/**
 * Validates the type of an incoming file and returns its canonical mime.
 *
 * If the mime is generic, the file name extension is used as a fallback.
 * Throws `UnsupportedMediaError` otherwise.
 */
export function resolveAllowedMime(
	mime: string,
	filename: string,
): AllowedMime {
	const normalized = normalizeMime(mime);
	if (normalized in ALLOWED_MIMES) return normalized as AllowedMime;

	const alias = MIME_ALIASES[normalized];
	if (alias) return alias;

	if (
		normalized === "" ||
		normalized === "application/octet-stream" ||
		normalized === "binary/octet-stream"
	) {
		const fromExtension = EXTENSION_MIMES[fileExtension(filename)];
		if (fromExtension) return fromExtension;
	}

	throw new UnsupportedMediaError(mime, filename);
}

/** Number of bytes sufficient to recognize every accepted format. */
export const MAGIC_BYTES_LENGTH = 16;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
	if (bytes.length < signature.length) return false;
	return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Recognizes a format from its first bytes.
 *
 * A watched folder receives files without any declared MIME type: the extension
 * sometimes lies, the content never does.
 */
export function sniffMime(bytes: Uint8Array): AllowedMime | undefined {
	// %PDF
	if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return "image/png";
	}
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
	// RIFF....WEBP
	if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		bytes.length >= 12 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "image/webp";
	}
	// TIFF little-endian (II*\0) or big-endian (MM\0*)
	if (
		startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
		startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
	) {
		return "image/tiff";
	}
	return undefined;
}

/**
 * Type of an incoming file: the bytes first, then the extension and the
 * declared type. Throws `UnsupportedMediaError` if nothing matches.
 */
export function resolveIntakeMime(
	head: Uint8Array,
	filename: string,
	declaredMime = "",
): AllowedMime {
	const sniffed = sniffMime(head);
	if (sniffed) return sniffed;
	return resolveAllowedMime(declaredMime, filename);
}

/**
 * Type of an incoming file, decided by its **content** alone.
 *
 * A declared MIME type and a file extension are both caller-supplied: a `.pdf`
 * holding a ZIP (or nothing at all) would otherwise reach the OCR stage and
 * fail there, leaving a broken document behind. The magic bytes are the only
 * thing that cannot lie, so intake refuses anything they do not recognise.
 */
export function resolveContentMime(
	head: Uint8Array,
	filename: string,
	declaredMime = "",
): AllowedMime {
	// The declared type is still checked: a caller announcing `text/plain` is
	// told what is accepted, whatever the bytes turn out to be.
	resolveAllowedMime(declaredMime, filename);
	const sniffed = sniffMime(head);
	if (!sniffed) {
		throw new UnsupportedMediaError(declaredMime, filename);
	}
	return sniffed;
}

/** First bytes of a payload, enough to recognize every accepted format. */
export async function readMagicBytes(
	data: Uint8Array | Blob,
	length: number = MAGIC_BYTES_LENGTH,
): Promise<Uint8Array> {
	if (data instanceof Blob) {
		// `Blob.slice` is not in the DOM lib bundled here; the full read is
		// bounded by the upload cap anyway.
		return new Uint8Array(await data.arrayBuffer()).subarray(0, length);
	}
	return data.subarray(0, length);
}

/**
 * True for a file stored as an archive (`keep` mode).
 *
 * There is no text to extract and no page to render in a ZIP: the pipeline
 * steps check this and step aside, which is what keeps `document.reprocess`
 * from parking an archive in `failed`.
 */
export function isArchiveMime(mime: string): boolean {
	return (ARCHIVE_MIME_ALIASES as readonly string[]).includes(
		normalizeMime(mime),
	);
}

/** Storage extension for an accepted mime. */
export function extensionForMime(mime: AllowedMime): string {
	return ALLOWED_MIMES[mime];
}

/** Same, but lenient: `undefined` if the mime is not in the list. */
export function extensionForMimeOrUndefined(mime: string): string | undefined {
	const normalized = normalizeMime(mime);
	const canonical = (
		normalized in ALLOWED_MIMES ? normalized : MIME_ALIASES[normalized]
	) as AllowedMime | undefined;
	return canonical ? ALLOWED_MIMES[canonical] : undefined;
}
