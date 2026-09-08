import {
	ARCHIVE_MIME_ALIASES,
	ARCHIVE_RATIO_FLOOR_BYTES,
	ARCHIVE_SKIP_MESSAGES,
	type ArchiveSkippedEntry,
	type ArchiveSkipReason,
	MAX_ARCHIVE_DEPTH,
	MAX_ARCHIVE_ENTRIES,
	MAX_ARCHIVE_EXPANDED_BYTES,
	MAX_ARCHIVE_RATIO,
} from "@docstore/shared/archive";
import { unzipSync } from "fflate";
import { ArchiveError } from "./errors";
import {
	type AllowedMime,
	fileExtension,
	normalizeMime,
	sniffMime,
} from "./media";

/**
 * ZIP expansion (SPEC §5, `docs/ingestion.md` "Archives").
 *
 * Nothing here touches the database: the module reads bytes and hands back
 * files, so the guards can be unit-tested without a pipeline. `intake.ts` owns
 * what becomes a document.
 */

/* ------------------------------------------------------------------ */
/* Recognition                                                          */
/* ------------------------------------------------------------------ */

/** `PK\x03\x04` — a local file header, the first thing in a non-empty ZIP. */
const LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
/** `PK\x05\x06` — an empty archive is only its end-of-central-directory. */
const EMPTY_HEADER = [0x50, 0x4b, 0x05, 0x06];
/** `PK\x07\x08` — first segment of a spanned archive. */
const SPANNED_HEADER = [0x50, 0x4b, 0x07, 0x08];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
	return (
		bytes.length >= signature.length &&
		signature.every((byte, index) => bytes[index] === byte)
	);
}

/** True when the leading bytes are those of a ZIP container. */
export function sniffArchive(head: Uint8Array): boolean {
	return (
		startsWith(head, LOCAL_HEADER) ||
		startsWith(head, EMPTY_HEADER) ||
		startsWith(head, SPANNED_HEADER)
	);
}

/**
 * True when the caller announced an archive (declared type or `.zip`).
 *
 * The content still decides what is actually done — this only tells the entry
 * doors to let the file through their "PDF or image" pre-check.
 */
export function declaresArchive(mime: string, filename: string): boolean {
	const normalized = normalizeMime(mime);
	return (
		(ARCHIVE_MIME_ALIASES as readonly string[]).includes(normalized) ||
		fileExtension(filename) === "zip"
	);
}

/* ------------------------------------------------------------------ */
/* Central directory                                                    */
/* ------------------------------------------------------------------ */

/**
 * What one row of the central directory says about an entry.
 *
 * fflate reads the directory too, but its filter callback never exposes the
 * general purpose flag, and that flag is the only reliable way to tell a
 * password-protected archive from a corrupt one. Reading the directory here
 * also means the guards are checked before a single byte is inflated.
 */
export interface ArchiveEntryHeader {
	name: string;
	/** General purpose bit flag; bit 0 = encrypted. */
	flags: number;
	compressedSize: number;
	uncompressedSize: number;
	directory: boolean;
}

const EOCD_SIGNATURE = 0x0605_4b50;
const CENTRAL_SIGNATURE = 0x0201_4b50;
/** The end-of-central-directory is 22 bytes plus a comment of 64 KB at most. */
const MAX_EOCD_SEARCH = 22 + 0xffff;

function u16(data: Uint8Array, offset: number): number {
	return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function u32(data: Uint8Array, offset: number): number {
	return (
		((data[offset] ?? 0) |
			((data[offset + 1] ?? 0) << 8) |
			((data[offset + 2] ?? 0) << 16) |
			((data[offset + 3] ?? 0) << 24)) >>>
		0
	);
}

/** Offset of the end-of-central-directory record, scanning backwards. */
function findEndOfCentralDirectory(data: Uint8Array): number {
	const floor = Math.max(0, data.length - MAX_EOCD_SEARCH);
	for (let offset = data.length - 22; offset >= floor; offset--) {
		if (u32(data, offset) === EOCD_SIGNATURE) return offset;
	}
	return -1;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

/**
 * Entries declared by the central directory.
 *
 * Throws `ArchiveError` when the file is not a readable ZIP: a truncated
 * upload and a renamed `.zip` both land here, and both are the caller's
 * problem rather than a server error.
 */
export function readArchiveEntries(data: Uint8Array): ArchiveEntryHeader[] {
	const eocd = findEndOfCentralDirectory(data);
	if (eocd < 0) {
		throw new ArchiveError(
			"This ZIP archive is unreadable: its central directory is missing or the file is truncated.",
		);
	}
	const count = u16(data, eocd + 10);
	let offset = u32(data, eocd + 16);
	const entries: ArchiveEntryHeader[] = [];

	for (let index = 0; index < count; index++) {
		if (offset + 46 > data.length || u32(data, offset) !== CENTRAL_SIGNATURE) {
			throw new ArchiveError(
				"This ZIP archive is unreadable: its central directory is corrupt.",
			);
		}
		const flags = u16(data, offset + 8);
		const compressedSize = u32(data, offset + 20);
		const uncompressedSize = u32(data, offset + 24);
		const nameLength = u16(data, offset + 28);
		const extraLength = u16(data, offset + 30);
		const commentLength = u16(data, offset + 32);
		const name = decoder.decode(
			data.subarray(offset + 46, offset + 46 + nameLength),
		);
		entries.push({
			name,
			flags,
			compressedSize,
			uncompressedSize,
			directory: name.endsWith("/"),
		});
		offset += 46 + nameLength + extraLength + commentLength;
	}

	return entries;
}

/* ------------------------------------------------------------------ */
/* Junk filter                                                          */
/* ------------------------------------------------------------------ */

/** File names an archiver leaves behind and that no one ever wants. */
const JUNK_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

/** Folders holding resource forks and other archiver bookkeeping. */
const JUNK_PREFIXES = ["__macosx/"];

/** Last segment of a ZIP path, which always uses forward slashes. */
export function entryBasename(entry: string): string {
	return entry.split("/").pop() ?? entry;
}

/**
 * True for the debris of an archiver: `__MACOSX/`, `.DS_Store`, `Thumbs.db`
 * and anything hidden. A hidden file inside a ZIP is never the document
 * someone meant to send.
 */
export function isJunkEntry(entry: string): boolean {
	const lower = entry.toLowerCase();
	if (JUNK_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
	if (lower.includes(`/${JUNK_PREFIXES[0]}`)) return true;
	const base = entryBasename(entry);
	if (base.length === 0) return true;
	if (base.startsWith(".")) return true;
	return JUNK_NAMES.has(base.toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Expansion                                                            */
/* ------------------------------------------------------------------ */

/** One file pulled out of an archive, ready for the normal intake. */
export interface ArchiveFile {
	/** Path inside the archive; `nested.zip!invoice.pdf` when it was nested. */
	entry: string;
	data: Uint8Array;
	mime: AllowedMime;
}

export interface ExpandArchiveResult {
	files: ArchiveFile[];
	skipped: ArchiveSkippedEntry[];
}

export interface ExpandArchiveOptions {
	maxEntries?: number;
	maxBytes?: number;
	maxRatio?: number;
	/** Levels of nesting still allowed below this archive. */
	depth?: number;
}

interface ExpandBudget {
	entries: number;
	bytes: number;
	maxEntries: number;
	maxBytes: number;
	maxRatio: number;
}

function skip(entry: string, reason: ArchiveSkipReason): ArchiveSkippedEntry {
	return { entry, reason, message: ARCHIVE_SKIP_MESSAGES[reason] };
}

/** Guards read off the central directory, before anything is inflated. */
function checkGuards(
	entries: ArchiveEntryHeader[],
	budget: ExpandBudget,
): void {
	if (entries.some((entry) => (entry.flags & 0x1) !== 0)) {
		throw new ArchiveError(
			"This ZIP archive is password-protected: unlock it before uploading it.",
		);
	}

	const files = entries.filter((entry) => !entry.directory);
	if (budget.entries + files.length > budget.maxEntries) {
		throw new ArchiveError(
			`This ZIP archive holds too many files (${budget.maxEntries} at most).`,
		);
	}

	let uncompressed = 0;
	let compressed = 0;
	for (const entry of files) {
		uncompressed += entry.uncompressedSize;
		compressed += entry.compressedSize;
	}
	if (budget.bytes + uncompressed > budget.maxBytes) {
		throw new ArchiveError(
			`This ZIP archive expands to more than ${Math.round(budget.maxBytes / 1024 / 1024)} MB.`,
		);
	}
	const ratio = uncompressed / Math.max(compressed, 1);
	if (uncompressed > ARCHIVE_RATIO_FLOOR_BYTES && ratio > budget.maxRatio) {
		throw new ArchiveError(
			`This ZIP archive expands ${Math.round(ratio)} times its own size, which no set of documents does. It was refused.`,
		);
	}
}

/** Inflates the entries `wanted` keeps, translating any fflate failure. */
function inflate(
	data: Uint8Array,
	wanted: Set<string>,
): Record<string, Uint8Array> {
	try {
		return unzipSync(data, { filter: (file) => wanted.has(file.name) });
	} catch (error) {
		throw new ArchiveError(
			`This ZIP archive could not be read: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function expandInto(
	data: Uint8Array,
	prefix: string,
	depth: number,
	budget: ExpandBudget,
	result: ExpandArchiveResult,
): void {
	const headers = readArchiveEntries(data);
	checkGuards(headers, budget);

	const wanted = new Set<string>();
	for (const header of headers) {
		if (header.directory) continue;
		budget.entries += 1;
		budget.bytes += header.uncompressedSize;
		const entry = `${prefix}${header.name}`;
		if (isJunkEntry(header.name)) {
			result.skipped.push(skip(entry, "junk"));
			continue;
		}
		if (header.uncompressedSize === 0) {
			result.skipped.push(skip(entry, "empty"));
			continue;
		}
		wanted.add(header.name);
	}

	if (wanted.size === 0) return;
	const inflated = inflate(data, wanted);

	for (const header of headers) {
		if (!wanted.has(header.name)) continue;
		const entry = `${prefix}${header.name}`;
		const content = inflated[header.name];
		if (!content || content.byteLength === 0) {
			result.skipped.push(skip(entry, "empty"));
			continue;
		}

		if (sniffArchive(content)) {
			if (depth <= 0) {
				result.skipped.push(skip(entry, "nested"));
				continue;
			}
			expandInto(content, `${entry}!`, depth - 1, budget, result);
			continue;
		}

		const mime = sniffMime(content);
		if (!mime) {
			result.skipped.push(skip(entry, "unsupported"));
			continue;
		}
		result.files.push({ entry, data: content, mime });
	}
}

/**
 * Expands an archive into the files the pipeline accepts.
 *
 * Everything else is reported in `skipped` rather than refused: a ZIP holding
 * eight invoices and a `notes.txt` must import the eight invoices. Only what
 * threatens the server — too many entries, too much expanded data, an absurd
 * compression ratio, an encrypted or corrupt container — raises
 * `ArchiveError`, which the callers turn into a `BAD_REQUEST`.
 */
export function expandArchive(
	data: Uint8Array,
	options: ExpandArchiveOptions = {},
): ExpandArchiveResult {
	const result: ExpandArchiveResult = { files: [], skipped: [] };
	expandInto(
		data,
		"",
		options.depth ?? MAX_ARCHIVE_DEPTH,
		{
			entries: 0,
			bytes: 0,
			maxEntries: options.maxEntries ?? MAX_ARCHIVE_ENTRIES,
			maxBytes: options.maxBytes ?? MAX_ARCHIVE_EXPANDED_BYTES,
			maxRatio: options.maxRatio ?? MAX_ARCHIVE_RATIO,
		},
		result,
	);
	return result;
}

/**
 * Text stored as the `content` of a kept archive: one entry path per line.
 *
 * That is what makes a `keep` archive findable — the full-text index covers
 * `content`, so searching a file name reaches the ZIP holding it.
 */
export function archiveContent(entries: ArchiveEntryHeader[]): string {
	return entries
		.filter((entry) => !entry.directory && !isJunkEntry(entry.name))
		.map((entry) => entry.name)
		.join("\n");
}
