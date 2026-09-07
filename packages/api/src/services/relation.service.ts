import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import { documentRelation } from "@docstore/db/schema/relation";
import type { DocumentRelationLink } from "@docstore/shared/document";
import type {
	AddRelationInput,
	DocumentRelationDto,
	DocumentRelationKind,
} from "@docstore/shared/relation";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

/**
 * Relations between documents (SPEC §2 "DocumentRelation").
 *
 * A relation is directed: `from` → `to`. `document.get` returns both
 * directions, each with a summary of the other document.
 *
 * This module does not depend on `document.service`: it is the other way
 * around (document detail, merge into a version).
 */

export async function requireDocumentIds(db: Db, ids: string[]): Promise<void> {
	const unique = [...new Set(ids)];
	const rows = await db
		.select({ id: document.id })
		.from(document)
		.where(inArray(document.id, unique));
	const found = new Set(rows.map((row) => row.id));
	const missing = unique.filter((id) => !found.has(id));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document not found: ${missing.join(", ")}.`,
		});
	}
}

/**
 * Relation kinds that describe a direction: "A supersedes B", "A is a version
 * of B"… A cycle among them would mean a document supersedes itself, directly
 * or through a chain. `related_to` carries no direction and stays symmetric.
 */
const DIRECTIONAL_RELATION_KINDS = new Set<DocumentRelationKind>([
	"supersedes",
	"version_of",
	"page_of",
	"fulfills",
]);

/**
 * `true` when linking `from → to` would close a cycle: following the edges of
 * the same kind from `to`, we come back to `from`.
 */
async function createsCycle(db: Db, input: AddRelationInput): Promise<boolean> {
	const edges = await db
		.select({
			from: documentRelation.fromDocumentId,
			to: documentRelation.toDocumentId,
		})
		.from(documentRelation)
		.where(eq(documentRelation.kind, input.kind));

	const next = new Map<string, string[]>();
	for (const edge of edges) {
		const bucket = next.get(edge.from);
		if (bucket) bucket.push(edge.to);
		else next.set(edge.from, [edge.to]);
	}

	const seen = new Set<string>();
	const queue = [input.toDocumentId];
	while (queue.length > 0) {
		const current = queue.shift() as string;
		if (current === input.fromDocumentId) return true;
		if (seen.has(current)) continue;
		seen.add(current);
		queue.push(...(next.get(current) ?? []));
	}
	return false;
}

/** Refused on a trashed document (SPEC §2: the trash is read-only). */
const TRASHED_MESSAGE = "Document is in the trash; restore it first.";

/** Same as {@link requireDocumentIds}, and none of them may be trashed. */
export async function requireLiveDocumentIds(
	db: Db,
	ids: string[],
): Promise<void> {
	const unique = [...new Set(ids)];
	const rows = await db
		.select({ id: document.id, deletedAt: document.deletedAt })
		.from(document)
		.where(inArray(document.id, unique));
	const found = new Map(rows.map((row) => [row.id, row.deletedAt]));
	const missing = unique.filter((id) => !found.has(id));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document not found: ${missing.join(", ")}.`,
		});
	}
	const trashed = unique.filter((id) => found.get(id) !== null);
	if (trashed.length > 0) {
		throw new ORPCError("CONFLICT", {
			message: `${TRASHED_MESSAGE} (${trashed.join(", ")})`,
		});
	}
}

/** Relations of a document, both ways, with the other document summarised. */
export async function loadDocumentRelations(
	db: Db,
	documentId: string,
): Promise<DocumentRelationLink[]> {
	const rows = await db
		.select({
			id: documentRelation.id,
			kind: documentRelation.kind,
			createdAt: documentRelation.createdAt,
			fromDocumentId: documentRelation.fromDocumentId,
			toDocumentId: documentRelation.toDocumentId,
			otherId: document.id,
			otherTitle: document.title,
			otherDocumentDate: document.documentDate,
			otherDatePrecision: document.datePrecision,
		})
		.from(documentRelation)
		// The other end of the relation, whatever the direction.
		.innerJoin(
			document,
			or(
				and(
					eq(documentRelation.fromDocumentId, documentId),
					eq(document.id, documentRelation.toDocumentId),
				),
				and(
					eq(documentRelation.toDocumentId, documentId),
					eq(document.id, documentRelation.fromDocumentId),
				),
			),
		)
		// A trashed document drops out of the relations shown on the others: it
		// is no longer part of the store until it is restored.
		.where(
			and(
				or(
					eq(documentRelation.fromDocumentId, documentId),
					eq(documentRelation.toDocumentId, documentId),
				),
				isNull(document.deletedAt),
			),
		)
		.orderBy(asc(documentRelation.createdAt), asc(documentRelation.id));

	return rows.map((row) => ({
		id: row.id,
		kind: row.kind,
		direction:
			row.fromDocumentId === documentId
				? ("outgoing" as const)
				: ("incoming" as const),
		createdAt: row.createdAt,
		document: {
			id: row.otherId,
			title: row.otherTitle,
			documentDate: row.otherDocumentDate,
			datePrecision: row.otherDatePrecision,
		},
	}));
}

export async function addRelation(
	db: Db,
	input: AddRelationInput,
): Promise<DocumentRelationDto> {
	if (input.fromDocumentId === input.toDocumentId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "A document cannot be related to itself.",
		});
	}
	await requireLiveDocumentIds(db, [input.fromDocumentId, input.toDocumentId]);

	if (
		DIRECTIONAL_RELATION_KINDS.has(input.kind) &&
		(await createsCycle(db, input))
	) {
		throw new ORPCError("BAD_REQUEST", {
			message: `This "${input.kind}" relation would create a cycle between these documents.`,
		});
	}

	const rows = await db
		.insert(documentRelation)
		.values({
			fromDocumentId: input.fromDocumentId,
			toDocumentId: input.toDocumentId,
			kind: input.kind,
		})
		.onConflictDoNothing()
		.returning();

	const row = rows[0];
	if (!row) {
		throw new ORPCError("CONFLICT", {
			message: "This relation already exists between these two documents.",
		});
	}
	return row;
}

export async function removeRelation(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	const [existing] = await db
		.select({
			from: documentRelation.fromDocumentId,
			to: documentRelation.toDocumentId,
		})
		.from(documentRelation)
		.where(eq(documentRelation.id, id))
		.limit(1);
	if (!existing) {
		throw new ORPCError("NOT_FOUND", {
			message: `Relation "${id}" not found.`,
		});
	}
	// A relation is hidden while one of its ends is in the trash, not deleted
	// (SPEC §2): dropping it there would silently lose it on restore.
	await requireLiveDocumentIds(db, [existing.from, existing.to]);

	await db.delete(documentRelation).where(eq(documentRelation.id, id));
	return { id, deleted: true as const };
}
