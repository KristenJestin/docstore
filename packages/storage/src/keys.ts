import { InvalidStorageKeyError } from "./driver";

/** Top-level prefixes used in the bucket. */
export const DOCUMENTS_PREFIX = "documents";
export const THUMBNAILS_PREFIX = "thumbnails";

const ID_RE = /^[A-Za-z0-9._-]+$/;
const EXT_RE = /^[A-Za-z0-9]+$/;

function assertId(value: string, label: string): string {
	if (!ID_RE.test(value) || value === "." || value === "..") {
		throw new InvalidStorageKeyError(value, `invalid ${label}`);
	}
	return value;
}

/** Normalizes an extension: no leading dot, lowercase. */
export function normalizeExtension(ext: string): string {
	const cleaned = ext.startsWith(".") ? ext.slice(1) : ext;
	const lowered = cleaned.toLowerCase();
	if (!EXT_RE.test(lowered)) {
		throw new InvalidStorageKeyError(ext, "invalid extension");
	}
	return lowered;
}

/** `documents/<docId>/<fileId>.<ext>` */
export function documentFileKey(
	docId: string,
	fileId: string,
	ext: string,
): string {
	assertId(docId, "docId");
	assertId(fileId, "fileId");
	return `${DOCUMENTS_PREFIX}/${docId}/${fileId}.${normalizeExtension(ext)}`;
}

/** `thumbnails/<docId>/<fileId>.png` */
export function thumbnailKey(docId: string, fileId: string): string {
	assertId(docId, "docId");
	assertId(fileId, "fileId");
	return `${THUMBNAILS_PREFIX}/${docId}/${fileId}.png`;
}
