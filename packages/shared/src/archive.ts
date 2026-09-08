import { z } from "zod";

/**
 * ZIP archives at intake (SPEC §5).
 *
 * A ZIP is not a document: it is a container, and what to do with it is a
 * household decision rather than a per-file one. The `intake.archives` setting
 * holds that decision, and every door (upload, upload link, watched folder,
 * mailbox, MCP) may override it for one call.
 */

/**
 * - `extract`: the archive is expanded and only its entries become documents.
 * - `keep`: the archive itself becomes one document, searchable by the list of
 *   the paths it holds; nothing is expanded.
 * - `both`: the two at once, with a `related_to` relation from the archive to
 *   every document pulled out of it.
 */
export const ARCHIVE_MODES = ["extract", "keep", "both"] as const;
export const archiveModeSchema = z.enum(ARCHIVE_MODES);
export type ArchiveMode = z.infer<typeof archiveModeSchema>;

export const DEFAULT_ARCHIVE_MODE: ArchiveMode = "extract";

/** Canonical type of an archive, stored on `document_file.mime`. */
export const ARCHIVE_MIME = "application/zip";

/** Declared types met in the wild for a `.zip`. */
export const ARCHIVE_MIME_ALIASES = [
	ARCHIVE_MIME,
	"application/x-zip",
	"application/x-zip-compressed",
	"application/zip-compressed",
	"multipart/x-zip",
] as const;

/** Storage extension of a kept archive. */
export const ARCHIVE_EXTENSION = "zip";

/* ------------------------------------------------------------------ */
/* Expansion guards                                                     */
/* ------------------------------------------------------------------ */

/** Entries expanded at most, nested archives included. */
export const MAX_ARCHIVE_ENTRIES = 200;

/** Total uncompressed size accepted, nested archives included. */
export const MAX_ARCHIVE_EXPANDED_BYTES = 500 * 1024 * 1024;

/**
 * Compression ratio beyond which the archive is refused: a 42 KB file that
 * expands to 4 GB is a zip bomb, not a batch of invoices.
 */
export const MAX_ARCHIVE_RATIO = 100;

/**
 * The ratio only means something once there is something to expand: a 2 KB
 * text file compressing 300:1 is not an attack.
 */
export const ARCHIVE_RATIO_FLOOR_BYTES = 1024 * 1024;

/** Levels of nesting expanded: the archive itself, then one more. */
export const MAX_ARCHIVE_DEPTH = 1;

/** Separator between the archive name and the path of an entry inside it. */
export const ARCHIVE_ENTRY_SEPARATOR = "!";

/** `invoices.zip` + `2026/edf.pdf` → `invoices.zip!2026/edf.pdf`. */
export function archiveEntryRef(archive: string, entry: string): string {
	return `${archive}${ARCHIVE_ENTRY_SEPARATOR}${entry}`;
}

/* ------------------------------------------------------------------ */
/* Result of an expansion                                               */
/* ------------------------------------------------------------------ */

/** Why an entry produced no document. */
export const ARCHIVE_SKIP_REASONS = [
	"junk",
	"unsupported",
	"nested",
	"empty",
] as const;
export const archiveSkipReasonSchema = z.enum(ARCHIVE_SKIP_REASONS);
export type ArchiveSkipReason = z.infer<typeof archiveSkipReasonSchema>;

export const ARCHIVE_SKIP_MESSAGES: Record<ArchiveSkipReason, string> = {
	junk: "Archive metadata, not a document.",
	unsupported: "Not a PDF or an image.",
	nested: "Nested archives are only expanded one level deep.",
	empty: "Empty entry.",
};

export const archiveSkippedEntrySchema = z.object({
	/** Path inside the archive. */
	entry: z.string(),
	reason: archiveSkipReasonSchema,
	message: z.string(),
});
export type ArchiveSkippedEntry = z.infer<typeof archiveSkippedEntrySchema>;

/**
 * One document pulled out of an archive.
 *
 * The entry path travels with the identifier: the upload tracker shows one
 * child row per entry, and a bare list of ids could not be labelled.
 */
export const archiveExtractedEntrySchema = z.object({
	entry: z.string(),
	documentId: z.string(),
});
export type ArchiveExtractedEntry = z.infer<typeof archiveExtractedEntrySchema>;

/** An entry whose content is already stored (same SHA-256). */
export const archiveDuplicateEntrySchema = z.object({
	entry: z.string(),
	duplicateOf: z.string(),
	/** `true` when the document holding that content sits in the trash. */
	trashed: z.boolean(),
});
export type ArchiveDuplicateEntry = z.infer<typeof archiveDuplicateEntrySchema>;

export const archiveResultSchema = z.object({
	/** Name of the archive as it was uploaded. */
	filename: z.string(),
	mode: archiveModeSchema,
	extracted: z.array(archiveExtractedEntrySchema),
	duplicates: z.array(archiveDuplicateEntrySchema),
	skipped: z.array(archiveSkippedEntrySchema),
	/** Document holding the archive itself (`keep` and `both`). */
	archiveDocumentId: z.string().nullable(),
});
export type ArchiveResult = z.infer<typeof archiveResultSchema>;

/** Wording of the three modes, shared by the settings screen and the tracker. */
export const ARCHIVE_MODE_LABELS: Record<ArchiveMode, string> = {
	extract: "Extract",
	keep: "Keep",
	both: "Both",
};

export const ARCHIVE_MODE_HINTS: Record<ArchiveMode, string> = {
	extract: "Each file inside the archive becomes a document.",
	keep: "The archive is stored as one document, listing what it holds.",
	both: "The archive and its files, linked to each other.",
};
