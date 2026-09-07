import type { IngestionBinding } from "@docstore/ingestion";
import {
	DuplicateOriginalError,
	intakeFile,
	isDuplicate,
	resolveAllowedMime,
	storageForFile,
	UnsupportedMediaError,
} from "@docstore/ingestion";
import {
	MAX_UPLOAD_FILES,
	type UploadDuplicate,
	type UploadedFile,
	uploadFilesOutput,
} from "@docstore/shared/file";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { protectedProcedure, writeProcedure } from "../index";
import {
	getFileForDownload,
	getThumbnailForDownload,
} from "../services/file.service";

const TAGS = ["File"];

export { MAX_UPLOAD_FILES };

const uploadInput = z.object({
	files: z.array(z.file()).min(1).max(MAX_UPLOAD_FILES),
	/** Title applied only when a single file is sent. */
	title: z.string().trim().min(1).max(500).optional(),
});

const fileIdInput = z.object({ fileId: z.string().min(1) });

/** The ingestion pipeline could not start (missing binaries...). */
function requireIngestion(context: Context): IngestionBinding {
	if (!context.ingestion) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "The ingestion pipeline is not available on this server.",
		});
	}
	return context.ingestion;
}

export const fileRouter = {
	upload: writeProcedure
		.route({
			method: "POST",
			path: "/files/upload",
			tags: TAGS,
			summary: "Upload one or more files (multipart)",
			description:
				"Content that is already stored is never an error: it comes back in `duplicates`, with `trashed: true` when the document holding it sits in the trash.",
		})
		.input(uploadInput)
		.output(uploadFilesOutput)
		.handler(async ({ input, context }) => {
			const ingestion = requireIngestion(context);
			const createdById = context.session?.user.id;
			if (!createdById) {
				throw new ORPCError("UNAUTHORIZED");
			}

			// Validate first: nothing is ingested if one file of the batch is rejected.
			for (const file of input.files) {
				try {
					resolveAllowedMime(file.type, file.name);
				} catch (error) {
					if (error instanceof UnsupportedMediaError) {
						throw new ORPCError("BAD_REQUEST", { message: error.message });
					}
					throw error;
				}
			}

			// A call authenticated with an API key is not a browser upload:
			// it is the `api` channel of SPEC §5.
			const source = context.apiKey ? "api" : "upload";

			const created: UploadedFile[] = [];
			const duplicates: UploadDuplicate[] = [];

			for (const file of input.files) {
				let result: Awaited<ReturnType<typeof intakeFile>>;
				try {
					result = await intakeFile(ingestion.ctx, {
						data: file,
						filename: file.name,
						mime: file.type,
						createdById,
						title: input.files.length === 1 ? input.title : undefined,
						source,
					});
				} catch (error: unknown) {
					// Content already stored on a trashed document: the unique sha256
					// index does not filter on `deleted_at`, so the insert fails. This
					// is still a duplicate, not a server error — report it as such so
					// the caller can offer to restore or purge the existing document.
					if (error instanceof DuplicateOriginalError && error.documentId) {
						duplicates.push({
							filename: file.name,
							duplicateOf: error.documentId,
							trashed: true,
						});
						continue;
					}
					// Same content, but its owner cannot be resolved: nothing useful to
					// point the caller at, so keep the opaque conflict.
					if (error instanceof DuplicateOriginalError) {
						throw new ORPCError("CONFLICT", { message: error.message });
					}
					// `intakeFile` sniffs the magic bytes: a file whose content is not
					// one of the accepted formats is a bad request, not a crash.
					if (error instanceof UnsupportedMediaError) {
						throw new ORPCError("BAD_REQUEST", { message: error.message });
					}
					throw error;
				}

				if (isDuplicate(result)) {
					duplicates.push({
						filename: file.name,
						duplicateOf: result.duplicateOf,
						trashed: false,
					});
				} else {
					created.push({
						documentId: result.documentId,
						fileId: result.fileId,
						filename: file.name,
					});
				}
			}

			return { created, duplicates };
		}),

	download: protectedProcedure
		.route({
			method: "GET",
			path: "/files/{fileId}/content",
			tags: TAGS,
			summary: "Download the original file",
		})
		.input(fileIdInput)
		.output(z.file())
		.handler(async ({ input, context }) => {
			const ingestion = requireIngestion(context);
			const file = await getFileForDownload(context.db, input.fileId);
			const blob = await storageForFile(ingestion.ctx, file.encrypted).get(
				file.storageKey,
			);
			return new File([blob], file.filename, { type: file.mime });
		}),

	thumbnail: protectedProcedure
		.route({
			method: "GET",
			path: "/files/{fileId}/thumbnail",
			tags: TAGS,
			summary: "PNG thumbnail of the file",
		})
		.input(fileIdInput)
		.output(z.file())
		.handler(async ({ input, context }) => {
			const ingestion = requireIngestion(context);
			const file = await getThumbnailForDownload(context.db, input.fileId);
			const blob = await storageForFile(ingestion.ctx, file.encrypted).get(
				file.thumbnailKey,
			);
			return new File([blob], `${file.id}.png`, { type: "image/png" });
		}),
};
