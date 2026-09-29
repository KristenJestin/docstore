import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import { documentExternalRef } from "@docstore/db/schema/external-ref";
import { touchDocuments } from "@docstore/ingestion";
import type {
	DocumentExternalRef,
	ExternalRefItem,
} from "@docstore/shared/external-ref";
import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { documentEvents } from "./document-events";

/**
 * External references of a document (issue #4): the notes of another system,
 * the life wiki first, that cite it.
 *
 * This module does not depend on `document.service`: it is the other way
 * around (document detail, list filters, merge into a version).
 */

/** References of a document, ordered by system then ref. */
export async function loadExternalRefs(
	db: Db,
	documentId: string,
): Promise<DocumentExternalRef[]> {
	return db
		.select({
			system: documentExternalRef.system,
			ref: documentExternalRef.ref,
			url: documentExternalRef.url,
			label: documentExternalRef.label,
			createdAt: documentExternalRef.createdAt,
			updatedAt: documentExternalRef.updatedAt,
		})
		.from(documentExternalRef)
		.where(eq(documentExternalRef.documentId, documentId))
		.orderBy(asc(documentExternalRef.system), asc(documentExternalRef.ref));
}

/**
 * `referencedBy` (`referenced: true`) / `notReferencedBy` (`false`): the
 * documents at least one note of `system` cites, or none.
 */
export function externalRefCondition(system: string, referenced: boolean): SQL {
	const cited = sql`exists (
		select 1 from ${documentExternalRef}
		where ${documentExternalRef.documentId} = ${document.id}
			and ${documentExternalRef.system} = ${system}
	)`;
	return referenced ? cited : sql`not ${cited}`;
}

/** What `replaceExternalRefs` changed, for the activity log. */
export type ExternalRefsChange = {
	added: string[];
	removed: string[];
	/** Refs kept whose `url` or `label` changed. */
	updated: string[];
};

function isEmptyChange(change: ExternalRefsChange): boolean {
	return (
		change.added.length === 0 &&
		change.removed.length === 0 &&
		change.updated.length === 0
	);
}

/**
 * Replaces the references `system` declares on a document; the other systems
 * are left alone and an empty list clears that system.
 *
 * A call that changes nothing (D4-03) neither bumps `updatedAt` nor emits
 * anything: the wiki lint re-declares its references on every run, and each
 * run must not make every cited document look changed to the incremental sync.
 * A real change bumps `updatedAt`, emits `document.updated` and leaves a
 * `document.external_refs_set` entry in the activity log (D4-04).
 *
 * The caller checks that the document exists and is live; this runs inside
 * its event batch.
 */
export async function replaceExternalRefs(
	db: Db,
	documentId: string,
	system: string,
	refs: readonly ExternalRefItem[],
): Promise<ExternalRefsChange> {
	if (new Set(refs.map((item) => item.ref)).size !== refs.length) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Each ref may appear only once.",
		});
	}
	const change = await db.transaction(async (tx) => {
		const existing = await tx
			.select({
				ref: documentExternalRef.ref,
				url: documentExternalRef.url,
				label: documentExternalRef.label,
			})
			.from(documentExternalRef)
			.where(
				and(
					eq(documentExternalRef.documentId, documentId),
					eq(documentExternalRef.system, system),
				),
			);
		const before = new Map(existing.map((row) => [row.ref, row]));
		const wanted = new Map(refs.map((item) => [item.ref, item]));

		const result: ExternalRefsChange = { added: [], removed: [], updated: [] };
		for (const ref of before.keys()) {
			if (!wanted.has(ref)) result.removed.push(ref);
		}
		const toWrite: ExternalRefItem[] = [];
		for (const item of refs) {
			const current = before.get(item.ref);
			const url = item.url ?? null;
			const label = item.label ?? null;
			if (!current) {
				result.added.push(item.ref);
				toWrite.push(item);
			} else if (current.url !== url || current.label !== label) {
				result.updated.push(item.ref);
				toWrite.push(item);
			}
		}
		if (isEmptyChange(result)) return result;

		if (result.removed.length > 0) {
			await tx
				.delete(documentExternalRef)
				.where(
					and(
						eq(documentExternalRef.documentId, documentId),
						eq(documentExternalRef.system, system),
						inArray(documentExternalRef.ref, result.removed),
					),
				);
		}
		if (toWrite.length > 0) {
			await tx
				.insert(documentExternalRef)
				.values(
					toWrite.map((item) => ({
						documentId,
						system,
						ref: item.ref,
						url: item.url ?? null,
						label: item.label ?? null,
					})),
				)
				.onConflictDoUpdate({
					target: [
						documentExternalRef.documentId,
						documentExternalRef.system,
						documentExternalRef.ref,
					],
					set: {
						url: sql`excluded.url`,
						label: sql`excluded.label`,
						updatedAt: new Date(),
					},
				});
		}
		await touchDocuments(tx, [documentId]);
		return result;
	});

	if (!isEmptyChange(change)) {
		documentEvents().changed(documentId, "document.external_refs_set", {
			system,
			added: change.added.map((ref) => ({ name: ref })),
			removed: change.removed.map((ref) => ({ name: ref })),
			...(change.updated.length > 0
				? { updated: change.updated.map((ref) => ({ name: ref })) }
				: {}),
		});
	}
	return change;
}

/**
 * Merge into a version (D4-05): the references of the absorbed document move
 * to the kept one, which is what the notes now lead to (its id redirects
 * there). A ref the kept document already carries keeps its own url and
 * label. Runs inside the merge transaction; the caller bumps the kept
 * document.
 */
export async function moveExternalRefs(
	tx: Pick<Db, "select" | "insert" | "delete">,
	fromDocumentId: string,
	toDocumentId: string,
): Promise<void> {
	const moving = await tx
		.select({
			system: documentExternalRef.system,
			ref: documentExternalRef.ref,
			url: documentExternalRef.url,
			label: documentExternalRef.label,
		})
		.from(documentExternalRef)
		.where(eq(documentExternalRef.documentId, fromDocumentId));
	if (moving.length === 0) return;
	await tx
		.insert(documentExternalRef)
		.values(moving.map((row) => ({ ...row, documentId: toDocumentId })))
		.onConflictDoNothing();
	await tx
		.delete(documentExternalRef)
		.where(eq(documentExternalRef.documentId, fromDocumentId));
}
