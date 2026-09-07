import { z } from "zod";

/** Number of files accepted per `file.upload` call (multi drag & drop, SPEC §5). */
export const MAX_UPLOAD_FILES = 20;

export const uploadedFileSchema = z.object({
	documentId: z.string(),
	fileId: z.string(),
	filename: z.string(),
});
export type UploadedFile = z.infer<typeof uploadedFileSchema>;

/**
 * A file whose content is already stored: nothing was created.
 *
 * Both cases are reported here rather than as an error, so a batch upload never
 * fails as a whole because of one already known file.
 */
export const uploadDuplicateSchema = z.object({
	filename: z.string(),
	/** Document that already holds this exact content. */
	duplicateOf: z.string(),
	/**
	 * `true` when that document sits in the trash. The content cannot be
	 * re-imported until the document is restored or permanently deleted, so the
	 * UI should offer those two actions instead of a plain "already there".
	 */
	trashed: z.boolean(),
});
export type UploadDuplicate = z.infer<typeof uploadDuplicateSchema>;

export const uploadFilesOutput = z.object({
	created: z.array(uploadedFileSchema),
	duplicates: z.array(uploadDuplicateSchema),
});
export type UploadFilesOutput = z.infer<typeof uploadFilesOutput>;
