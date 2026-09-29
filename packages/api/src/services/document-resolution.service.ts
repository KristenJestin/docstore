import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import { documentTombstone } from "@docstore/db/schema/document-tombstone";
import type { DocumentDetail } from "@docstore/shared/document";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { logDocumentRead } from "./activity.service";
import { getDocument } from "./document.service";
import { publicBaseUrl } from "./upload-link.service";

/**
 * A document id always leads somewhere (issue #2).
 *
 * A `doc_…` cited outside docstore (the life wiki, an agent's notes) keeps
 * working after the document it named was merged or deleted:
 *
 * - a live document answers for itself;
 * - a merged one (`document_tombstone.reason = 'merged'`) leads to the kept
 *   document, even once the absorbed row has been purged from the trash;
 * - a trashed one that was not merged still answers for itself, with its
 *   `deletedAt`;
 * - a permanently deleted one answers `410 GONE`, and an id that never existed
 *   `404 NOT_FOUND`.
 */

/** Longest merge chain followed before giving up (A into B into C…). */
export const MAX_MERGE_HOPS = 16;

export interface ResolvedDocumentId {
	/** The document that answers: the one asked for, or where it was merged. */
	id: string;
	/** The id that was asked for when it differs from `id`, else `null`. */
	redirectedFrom: string | null;
}

export function documentGoneError(id: string): ORPCError<"GONE", unknown> {
	return new ORPCError("GONE", {
		status: 410,
		message: `Document "${id}" was permanently deleted.`,
	});
}

/** Follows merges from `id` to the document that answers for it. */
export async function resolveDocumentId(
	db: Db,
	id: string,
): Promise<ResolvedDocumentId> {
	let current = id;
	const visited = new Set<string>();

	for (let hop = 0; hop <= MAX_MERGE_HOPS; hop++) {
		visited.add(current);
		const [row] = await db
			.select({ deletedAt: document.deletedAt })
			.from(document)
			.where(eq(document.id, current))
			.limit(1);
		const answer = {
			id: current,
			redirectedFrom: current === id ? null : id,
		};
		if (row && !row.deletedAt) return answer;

		const [tombstone] = await db
			.select({
				reason: documentTombstone.reason,
				mergedIntoId: documentTombstone.mergedIntoId,
			})
			.from(documentTombstone)
			.where(eq(documentTombstone.documentId, current))
			.limit(1);

		if (tombstone?.reason === "merged" && tombstone.mergedIntoId) {
			if (visited.has(tombstone.mergedIntoId)) break;
			current = tombstone.mergedIntoId;
			continue;
		}
		// In the trash without a merge: still readable, `deletedAt` says so.
		if (row) return answer;
		if (tombstone) throw documentGoneError(current);
		if (current === id) {
			throw new ORPCError("NOT_FOUND", {
				message: `Document "${id}" not found.`,
			});
		}
		// A merge target with neither a row nor a tombstone: only possible for
		// rows deleted before tombstones existed. The document is gone all the
		// same.
		throw documentGoneError(current);
	}

	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message: `The merges of document "${id}" do not lead to a document.`,
	});
}

/** Page of the document in the web app, for humans. */
export function documentWebUrl(id: string): string {
	return `${publicBaseUrl()}/documents/${id}`;
}

/**
 * Stable URL of the primary file of the document (`GET /d/<id>`, served by
 * the Hono server next to `/files`).
 */
export function documentFileUrl(id: string): string {
	return `${publicBaseUrl()}/d/${id}`;
}

/**
 * `document.get` and MCP `get_document`: resolves the id, then returns the
 * detail of the document that answers, with its stable URLs. The caller still
 * masks the content for its own scopes.
 *
 * The read is traced in the activity log (issue #15), in the background.
 */
export async function getDocumentWithUrls(
	db: Db,
	requestedId: string,
): Promise<
	DocumentDetail & {
		webUrl: string;
		fileUrl: string;
		redirectedFrom: string | null;
	}
> {
	const { id, redirectedFrom } = await resolveDocumentId(db, requestedId);
	const detail = await getDocument(db, id);
	logDocumentRead(
		db,
		"document.read",
		detail,
		redirectedFrom ? { redirectedFrom } : {},
	);
	return {
		...detail,
		webUrl: documentWebUrl(id),
		fileUrl: documentFileUrl(id),
		redirectedFrom,
	};
}
