import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import { documentDossier, dossier } from "@docstore/db/schema/dossier";
import { revokeDossierShareLinksForSensitive } from "@docstore/ingestion";
import type {
	AddDossierDocumentsInput,
	CreateDossierInput,
	DossierDto,
	DossierSummary,
	DossierWithCount,
	ListDossiersInput,
	RemoveDossierDocumentInput,
	UpdateDossierInput,
} from "@docstore/shared/dossier";
import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { likePattern } from "./sql-utils";

/**
 * Dossiers (SPEC §2): flat, cross-cutting collections with a lifecycle.
 * A closed Dossier drops out of the default lists but keeps its documents.
 */

async function requireDossier(db: Db, id: string): Promise<DossierDto> {
	const rows = await db
		.select()
		.from(dossier)
		.where(eq(dossier.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Dossier "${id}" not found.`,
		});
	}
	return row;
}

export async function listDossiers(
	db: Db,
	input: ListDossiersInput,
): Promise<DossierWithCount[]> {
	const conditions: SQL[] = [];
	if (!input.includeClosed) {
		conditions.push(eq(dossier.status, "open"));
	}
	if (input.query) {
		conditions.push(sql`${dossier.name} ilike ${likePattern(input.query)}`);
	}

	// `leftJoin` + `groupBy`: a single-table correlated subquery would resolve
	// same-named columns badly (see `tag.service`).
	return db
		.select({
			id: dossier.id,
			name: dossier.name,
			description: dossier.description,
			status: dossier.status,
			closedAt: dossier.closedAt,
			createdAt: dossier.createdAt,
			updatedAt: dossier.updatedAt,
			documentCount: sql<number>`count(${document.id})::int`,
		})
		.from(dossier)
		.leftJoin(documentDossier, eq(documentDossier.dossierId, dossier.id))
		.leftJoin(
			document,
			and(
				eq(document.id, documentDossier.documentId),
				isNull(document.deletedAt),
			),
		)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.groupBy(
			dossier.id,
			dossier.name,
			dossier.description,
			dossier.status,
			dossier.closedAt,
			dossier.createdAt,
			dossier.updatedAt,
		)
		.orderBy(asc(dossier.name), asc(dossier.id));
}

/** Dossiers a document belongs to, e.g. for `document.get`. */
export async function listDossiersForDocument(
	db: Db,
	documentId: string,
): Promise<DossierSummary[]> {
	return db
		.select({ id: dossier.id, name: dossier.name, status: dossier.status })
		.from(documentDossier)
		.innerJoin(dossier, eq(dossier.id, documentDossier.dossierId))
		.where(eq(documentDossier.documentId, documentId))
		.orderBy(asc(dossier.name), asc(dossier.id));
}

export async function getDossier(
	db: Db,
	id: string,
): Promise<DossierWithCount> {
	const row = await requireDossier(db, id);
	const counted = await db
		.select({ value: sql<number>`count(*)::int` })
		.from(documentDossier)
		.innerJoin(document, eq(document.id, documentDossier.documentId))
		.where(and(eq(documentDossier.dossierId, id), isNull(document.deletedAt)));
	return { ...row, documentCount: counted[0]?.value ?? 0 };
}

export async function createDossier(
	db: Db,
	input: CreateDossierInput,
): Promise<DossierDto> {
	const rows = await db
		.insert(dossier)
		.values({ name: input.name, description: input.description ?? null })
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The Dossier could not be created.",
		});
	}
	return row;
}

export async function updateDossier(
	db: Db,
	input: UpdateDossierInput,
): Promise<DossierDto> {
	const current = await requireDossier(db, input.id);

	const patch: Partial<typeof dossier.$inferInsert> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) {
		patch.description = input.description ?? null;
	}
	if (Object.keys(patch).length === 0) {
		return current;
	}

	const rows = await db
		.update(dossier)
		.set(patch)
		.where(eq(dossier.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Dossier "${input.id}" not found.`,
		});
	}
	return row;
}

async function setStatus(
	db: Db,
	id: string,
	status: "open" | "closed",
): Promise<DossierWithCount> {
	await requireDossier(db, id);
	await db
		.update(dossier)
		.set({ status, closedAt: status === "closed" ? new Date() : null })
		.where(eq(dossier.id, id));
	return getDossier(db, id);
}

export function closeDossier(db: Db, id: string): Promise<DossierWithCount> {
	return setStatus(db, id, "closed");
}

export function reopenDossier(db: Db, id: string): Promise<DossierWithCount> {
	return setStatus(db, id, "open");
}

export async function deleteDossier(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	await requireDossier(db, id);
	// `document_dossier` goes away by cascade; the documents remain.
	await db.delete(dossier).where(eq(dossier.id, id));
	return { id, deleted: true as const };
}

export async function addDossierDocuments(
	db: Db,
	input: AddDossierDocumentsInput,
): Promise<DossierWithCount> {
	await requireDossier(db, input.id);

	const ids = [...new Set(input.documentIds)];
	const found = await db
		.select({
			id: document.id,
			deletedAt: document.deletedAt,
			sensitive: document.sensitive,
		})
		.from(document)
		.where(inArray(document.id, ids));
	const known = new Map(found.map((row) => [row.id, row.deletedAt]));
	const missing = ids.filter((id) => !known.has(id));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document not found: ${missing.join(", ")}.`,
		});
	}
	// A Dossier collects live documents: filing something from the trash would
	// silently hide it from the very list it was added to.
	const trashed = ids.filter((id) => known.get(id) !== null);
	if (trashed.length > 0) {
		throw new ORPCError("CONFLICT", {
			message: `Document is in the trash; restore it first. (${trashed.join(", ")})`,
		});
	}

	await db
		.insert(documentDossier)
		.values(ids.map((documentId) => ({ documentId, dossierId: input.id })))
		.onConflictDoNothing();

	// A sensitive document walking into the dossier closes every public window
	// already open on it — `shareLink.create` refuses a dossier holding one, and
	// this is the same rule applied from the other side (SPEC §2).
	if (found.some((row) => row.sensitive)) {
		await revokeDossierShareLinksForSensitive(db, input.id);
	}

	return getDossier(db, input.id);
}

export async function removeDossierDocument(
	db: Db,
	input: RemoveDossierDocumentInput,
): Promise<DossierWithCount> {
	await requireDossier(db, input.id);
	// Filing is symmetric: a trashed document cannot be added, so it cannot be
	// pulled out either — it comes back with the document when it is restored.
	const [target] = await db
		.select({ deletedAt: document.deletedAt })
		.from(document)
		.where(eq(document.id, input.documentId))
		.limit(1);
	if (target?.deletedAt) {
		throw new ORPCError("CONFLICT", {
			message: "Document is in the trash; restore it first.",
		});
	}
	const deleted = await db
		.delete(documentDossier)
		.where(
			and(
				eq(documentDossier.dossierId, input.id),
				eq(documentDossier.documentId, input.documentId),
			),
		)
		.returning({ documentId: documentDossier.documentId });
	if (!deleted[0]) {
		throw new ORPCError("NOT_FOUND", {
			message: "This document does not belong to the Dossier.",
		});
	}
	return getDossier(db, input.id);
}
