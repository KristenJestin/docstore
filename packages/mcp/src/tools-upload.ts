import {
	ArchiveError,
	DuplicateOriginalError,
	declaresArchive,
	intakeFile,
	isArchive,
	isDuplicate,
	resolveAllowedMime,
	resolveContentMime,
	sniffArchive,
	UnsupportedMediaError,
} from "@docstore/ingestion";
import {
	archiveModeSchema,
	archiveResultSchema,
} from "@docstore/shared/archive";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "./context";
import {
	defineTool,
	McpToolError,
	requireIngestion,
	requireWrite,
} from "./context";

/** JSON-RPC transport ceiling: 20 MB of decoded content. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Base64 alphabet, optional `=` padding; whitespace is stripped first. */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeBase64(value: string): Uint8Array {
	// `base64` tolerates the whitespace and line breaks of the transport.
	const compact = value.replace(/\s+/g, "");
	// `Buffer.from(…, "base64")` silently drops anything outside the alphabet:
	// without this check a truncated or mangled payload would be stored as a
	// shorter, corrupt file.
	if (!BASE64_RE.test(compact) || compact.length % 4 !== 0) {
		throw new McpToolError("The `base64` content is not valid base64.");
	}
	const buffer = Buffer.from(compact, "base64");
	if (buffer.length === 0) {
		throw new McpToolError("The base64 content is empty or invalid.");
	}
	return new Uint8Array(buffer);
}

export function registerUploadTool(
	server: McpServer,
	context: McpContext,
): void {
	defineTool(
		server,
		"upload_document",
		{
			title: "Upload a document",
			description:
				"Creates a document from a base64-encoded file (20 MB maximum). The ingestion pipeline takes over: OCR, analysis, rules. Content already stored is not an error: it returns `duplicateOf`, plus `trashed: true` when the document holding that content sits in the trash (restore it or delete it permanently before importing again). A ZIP archive is handled according to `archives`: `extract` turns each file it holds into a document, `keep` stores the archive itself, `both` does the two and links them; the result then comes back in `archive` and `documentId` stays null.",
			inputSchema: {
				filename: z.string().trim().min(1).max(255),
				mime: z
					.string()
					.trim()
					.min(1)
					.describe("MIME type, for example application/pdf"),
				base64: z.string().min(1).describe("File content in base64"),
				title: z.string().trim().min(1).max(500).optional(),
				archives: archiveModeSchema
					.optional()
					.describe(
						"What to do with a ZIP: extract its files, keep the archive, or both. Defaults to the `intake.archives` setting.",
					),
			},
			outputSchema: {
				documentId: z.string().nullable(),
				fileId: z.string().nullable(),
				duplicateOf: z.string().nullable(),
				trashed: z
					.boolean()
					.describe(
						"True when `duplicateOf` points at a document currently in the trash.",
					),
				archive: archiveResultSchema
					.nullable()
					.describe("What a ZIP produced; null for an ordinary file."),
			},
			text: (output) => {
				if (output.archive) {
					const { archive } = output;
					const kept = archive.archiveDocumentId
						? `archive kept as ${archive.archiveDocumentId}`
						: "archive not kept";
					return `Archive ${archive.filename} (${archive.mode}): ${archive.extracted.length} document(s) created, ${archive.duplicates.length} already stored, ${archive.skipped.length} entry(ies) skipped, ${kept}.`;
				}
				if (!output.duplicateOf) {
					return `Document created: ${output.documentId}.`;
				}
				return output.trashed
					? `Content already stored on document ${output.duplicateOf}, which is in the trash. Restore it or delete it permanently before importing this file again.`
					: `Content already stored: see document ${output.duplicateOf}.`;
			},
		},
		async (input) => {
			requireWrite(context);
			const ingestion = requireIngestion(context);

			// A ZIP is a container, not one of the accepted document types: only
			// what comes out of it is checked against `ALLOWED_MIMES`.
			const container = declaresArchive(input.mime, input.filename);
			if (!container) {
				try {
					resolveAllowedMime(input.mime, input.filename);
				} catch (error) {
					if (error instanceof UnsupportedMediaError) {
						throw new McpToolError(error.message);
					}
					throw error;
				}
			}

			const data = decodeBase64(input.base64);
			if (data.byteLength > MAX_UPLOAD_BYTES) {
				throw new McpToolError(
					`File too large (${Math.round(data.byteLength / 1024 / 1024)} MB): 20 MB maximum.`,
				);
			}

			// The magic bytes decide what the file really is: a `.pdf` carrying
			// anything else is refused before it reaches the pipeline.
			if (!sniffArchive(data)) {
				try {
					resolveContentMime(data, input.filename, input.mime);
				} catch (error) {
					if (error instanceof UnsupportedMediaError) {
						throw new McpToolError(error.message);
					}
					throw error;
				}
			}

			let result: Awaited<ReturnType<typeof intakeFile>>;
			try {
				result = await intakeFile(ingestion.ctx, {
					data,
					filename: input.filename,
					mime: input.mime,
					createdById: context.principal.userId,
					title: input.title,
					archives: input.archives,
				});
			} catch (error) {
				// Content already stored on a trashed document: the unique sha256
				// index does not filter on `deleted_at`. Report it as a duplicate
				// rather than a tool failure.
				if (error instanceof DuplicateOriginalError && error.documentId) {
					return {
						documentId: null,
						fileId: null,
						duplicateOf: error.documentId,
						trashed: true,
						archive: null,
					};
				}
				if (error instanceof DuplicateOriginalError) {
					throw new McpToolError(error.message);
				}
				if (error instanceof ArchiveError) {
					throw new McpToolError(error.message);
				}
				throw error;
			}

			if (isArchive(result)) {
				return {
					documentId: null,
					fileId: null,
					duplicateOf: null,
					trashed: false,
					archive: result.archive,
				};
			}
			if (isDuplicate(result)) {
				return {
					documentId: null,
					fileId: null,
					duplicateOf: result.duplicateOf,
					trashed: false,
					archive: null,
				};
			}
			return {
				documentId: result.documentId,
				fileId: result.fileId,
				duplicateOf: null,
				trashed: false,
				archive: null,
			};
		},
	);
}
