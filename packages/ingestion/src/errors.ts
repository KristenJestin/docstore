/** Typed errors of the ingestion pipeline (SPEC §5). */

/** MIME type rejected at intake (see `ALLOWED_MIMES`). */
export class UnsupportedMediaError extends Error {
	readonly mime: string;
	readonly filename: string;

	constructor(mime: string, filename: string) {
		super(
			`Unsupported file type: "${mime}" (${filename}). Accepted formats: PDF, PNG, JPEG, WebP, TIFF.`,
		);
		this.name = "UnsupportedMediaError";
		this.mime = mime;
		this.filename = filename;
	}
}

/**
 * A ZIP archive that cannot be expanded: corrupt, truncated,
 * password-protected, or built to explode (too many entries, too much
 * expanded data, an absurd compression ratio).
 *
 * Always the caller's problem, never the server's: every door turns it into a
 * `BAD_REQUEST` carrying this message.
 */
export class ArchiveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ArchiveError";
	}
}

/**
 * The content already exists as an original, but attached to a document in the
 * trash: the unique index `document_file_sha256_original_uidx` does not filter
 * on `deleted_at`, so a new upload is impossible until the trash is emptied or
 * the document restored.
 */
export class DuplicateOriginalError extends Error {
	readonly sha256: string;
	readonly documentId: string | undefined;

	constructor(hash: string, documentId?: string) {
		super(
			`This content already exists as an original file${
				documentId ? ` (document ${documentId}, in trash)` : ""
			}. Restore or permanently delete the existing document before importing it again.`,
		);
		this.name = "DuplicateOriginalError";
		this.sha256 = hash;
		this.documentId = documentId;
	}
}

/** The document type referenced by a rule or a caller no longer exists. */
export class DocumentTypeNotFoundError extends Error {
	readonly documentTypeId: string;

	constructor(documentTypeId: string) {
		super(`Document type "${documentTypeId}" not found.`);
		this.name = "DocumentTypeNotFoundError";
		this.documentTypeId = documentTypeId;
	}
}

/**
 * Every attempt at `max(asn) + 1` lost the race against another assignment.
 * The API turns it into a `CONFLICT`; retrying is always safe.
 */
export class AsnAllocationError extends Error {
	readonly documentId: string;

	constructor(documentId: string) {
		super("Could not allocate an ASN: too many concurrent assignments.");
		this.name = "AsnAllocationError";
		this.documentId = documentId;
	}
}

/** The document or file targeted by a step no longer exists. */
export class PipelineTargetNotFoundError extends Error {
	readonly documentId: string;
	readonly fileId: string;

	constructor(documentId: string, fileId: string) {
		super(
			`File not found for the pipeline: document ${documentId}, file ${fileId}.`,
		);
		this.name = "PipelineTargetNotFoundError";
		this.documentId = documentId;
		this.fileId = fileId;
	}
}
