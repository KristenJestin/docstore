import type { Db } from "@docstore/db";
import { document, documentFile } from "@docstore/db/schema/document";
import type { DocumentFileKind } from "@docstore/shared/document";
import type { StorageDriver } from "@docstore/storage";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

/** Metadata needed to serve a file from storage. */
export interface FileForDownload {
	id: string;
	documentId: string;
	kind: DocumentFileKind;
	filename: string;
	mime: string;
	size: number;
	sha256: string;
	storageKey: string;
	thumbnailKey: string | null;
	/** True when the stored object is encrypted (sensitive document, SPEC §2). */
	encrypted: boolean;
	/** Non-null if the document is in the trash. */
	documentDeletedAt: Date | null;
	documentTitle: string;
}

/**
 * Loads a file and its document. Throws `NOT_FOUND` if either one is missing.
 */
export async function getFileForDownload(
	db: Db,
	fileId: string,
): Promise<FileForDownload> {
	const [row] = await db
		.select({
			id: documentFile.id,
			documentId: documentFile.documentId,
			kind: documentFile.kind,
			filename: documentFile.filename,
			mime: documentFile.mime,
			size: documentFile.size,
			sha256: documentFile.sha256,
			storageKey: documentFile.storageKey,
			thumbnailKey: documentFile.thumbnailKey,
			encrypted: documentFile.encrypted,
			documentDeletedAt: document.deletedAt,
			documentTitle: document.title,
		})
		.from(documentFile)
		.innerJoin(document, eq(document.id, documentFile.documentId))
		.where(eq(documentFile.id, fileId))
		.limit(1);

	if (!row) {
		throw new ORPCError("NOT_FOUND", { message: "File not found." });
	}
	return row;
}

/**
 * Same, while guaranteeing that a thumbnail has been produced.
 *
 * Throws `NOT_FOUND` until the pipeline `render` step has run: the front end
 * can therefore retry after processing.
 */
export async function getThumbnailForDownload(
	db: Db,
	fileId: string,
): Promise<FileForDownload & { thumbnailKey: string }> {
	const file = await getFileForDownload(db, fileId);
	if (!file.thumbnailKey) {
		throw new ORPCError("NOT_FOUND", {
			message: "Thumbnail not available (document is still being processed).",
		});
	}
	return { ...file, thumbnailKey: file.thumbnailKey };
}

/**
 * Physical deletion of a document's objects (`onDeleteFiles` hook of
 * `deleteDocumentPermanently`). Idempotent: a missing key is ignored.
 */
export async function deleteStorageObjects(
	storage: StorageDriver,
	storageKeys: string[],
): Promise<void> {
	for (const key of storageKeys) {
		try {
			await storage.delete(key);
		} catch (error) {
			console.error(`[storage] could not delete: ${key}`, error);
		}
	}
}

/** Safe file name for the `Content-Disposition` header. */
export function contentDispositionFilename(filename: string): string {
	const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
	return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
