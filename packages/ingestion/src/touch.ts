import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import { inArray } from "drizzle-orm";

/** Anything that can run an `update`: the connection or a transaction. */
export type DocumentWriter = Pick<Db, "update">;

/**
 * Stamps `updated_at` on documents whose change lives in another table (tags,
 * parties, custom field values, dossiers, relations, files).
 *
 * `updated_at` is the cursor of the incremental sync (`document.list` with
 * `updatedSince`): a change that does not move it is invisible to an agent
 * that syncs. A write on the `document` row itself already moves it through
 * the column's `$onUpdate`.
 */
export async function touchDocuments(
	db: DocumentWriter,
	documentIds: readonly string[],
): Promise<void> {
	const ids = [...new Set(documentIds)];
	if (ids.length === 0) return;
	await db
		.update(document)
		.set({ updatedAt: new Date() })
		.where(inArray(document.id, ids));
}
