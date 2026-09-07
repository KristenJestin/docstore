import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import { documentTag, tag } from "@docstore/db/schema/tag";
import type {
	CreateTagInput,
	ListTagsInput,
	MergeTagsInput,
	Tag,
	TagSummary,
	TagWithCount,
	UpdateTagInput,
} from "@docstore/shared/tag";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { likePattern } from "./sql-utils";

export async function listTags(
	db: Db,
	input: ListTagsInput,
): Promise<TagWithCount[]> {
	const where = input.query
		? sql`${tag.name} ilike ${likePattern(input.query)}`
		: undefined;

	// Joins rather than a correlated subquery: in a single-table `select` drizzle
	// does not add the table prefix, so same-named columns resolve against the
	// wrong relation.
	const rows = await db
		.select({
			id: tag.id,
			name: tag.name,
			color: tag.color,
			createdAt: tag.createdAt,
			documentCount: sql<number>`count(${document.id})::int`,
		})
		.from(tag)
		.leftJoin(documentTag, eq(documentTag.tagId, tag.id))
		.leftJoin(
			document,
			and(eq(document.id, documentTag.documentId), isNull(document.deletedAt)),
		)
		.where(where)
		.groupBy(tag.id, tag.name, tag.color, tag.createdAt)
		.orderBy(asc(tag.name), asc(tag.id));

	return rows;
}

export async function requireTag(db: Db, id: string): Promise<Tag> {
	const rows = await db.select().from(tag).where(eq(tag.id, id)).limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", { message: `Tag "${id}" not found.` });
	}
	return row;
}

/** Checks that every tag exists (bulk assignment). */
export async function requireTags(db: Db, ids: string[]): Promise<void> {
	if (ids.length === 0) {
		return;
	}
	const rows = await db
		.select({ id: tag.id })
		.from(tag)
		.where(inArray(tag.id, ids));
	const found = new Set(rows.map((row) => row.id));
	const missing = ids.filter((id) => !found.has(id));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Tag not found: ${missing.join(", ")}.`,
		});
	}
}

/** A tag name is unique ignoring case (index on `lower(name)`). */
async function assertNameAvailable(
	db: Db,
	name: string,
	excludeId?: string,
): Promise<void> {
	const conditions = [sql`lower(${tag.name}) = lower(${name})`];
	if (excludeId) {
		conditions.push(ne(tag.id, excludeId));
	}
	const rows = await db
		.select({ id: tag.id, name: tag.name })
		.from(tag)
		.where(and(...conditions))
		.limit(1);
	if (rows[0]) {
		throw new ORPCError("CONFLICT", {
			message: `The tag "${rows[0].name}" already exists.`,
		});
	}
}

export async function createTag(db: Db, input: CreateTagInput): Promise<Tag> {
	await assertNameAvailable(db, input.name);

	const rows = await db
		.insert(tag)
		.values({ name: input.name, color: input.color ?? null })
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The tag could not be created.",
		});
	}
	return row;
}

export async function updateTag(db: Db, input: UpdateTagInput): Promise<Tag> {
	const current = await requireTag(db, input.id);

	const patch: Partial<typeof tag.$inferInsert> = {};
	if (input.name !== undefined) {
		await assertNameAvailable(db, input.name, input.id);
		patch.name = input.name;
	}
	if (input.color !== undefined) {
		patch.color = input.color ?? null;
	}
	if (Object.keys(patch).length === 0) {
		return current;
	}

	const rows = await db
		.update(tag)
		.set(patch)
		.where(eq(tag.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Tag "${input.id}" not found.`,
		});
	}
	return row;
}

export async function deleteTag(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	await requireTag(db, id);
	// `document_tag` is deleted by cascade.
	await db.delete(tag).where(eq(tag.id, id));
	return { id, deleted: true };
}

/**
 * Merges `sourceId` into `targetId`: the documents of the source tag receive
 * the target tag (without duplicates), then the source tag is deleted.
 */
export async function mergeTags(
	db: Db,
	input: MergeTagsInput,
): Promise<{ target: Tag; movedDocuments: number }> {
	if (input.sourceId === input.targetId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "A tag cannot be merged with itself.",
		});
	}
	await requireTag(db, input.sourceId);
	const target = await requireTag(db, input.targetId);

	const moved = await db.transaction(async (tx) => {
		const sourceLinks = await tx
			.select({ documentId: documentTag.documentId })
			.from(documentTag)
			.where(eq(documentTag.tagId, input.sourceId));
		const targetLinks = await tx
			.select({ documentId: documentTag.documentId })
			.from(documentTag)
			.where(eq(documentTag.tagId, input.targetId));

		const alreadyTagged = new Set(targetLinks.map((row) => row.documentId));
		const toInsert = sourceLinks
			.map((row) => row.documentId)
			.filter((documentId) => !alreadyTagged.has(documentId));

		if (toInsert.length > 0) {
			await tx.insert(documentTag).values(
				toInsert.map((documentId) => ({
					documentId,
					tagId: input.targetId,
					source: "manual" as const,
					confidence: null,
				})),
			);
		}

		await tx.delete(tag).where(eq(tag.id, input.sourceId));
		return toInsert.length;
	});

	return { target, movedDocuments: moved };
}

/** Active tags of a set of documents, used to enrich lists. */
export async function loadTagsByDocument(
	db: Db,
	documentIds: string[],
): Promise<Map<string, TagSummary[]>> {
	const result = new Map<string, TagSummary[]>();
	if (documentIds.length === 0) {
		return result;
	}

	const rows = await db
		.select({
			documentId: documentTag.documentId,
			id: tag.id,
			name: tag.name,
			color: tag.color,
			source: documentTag.source,
			confidence: documentTag.confidence,
		})
		.from(documentTag)
		.innerJoin(tag, eq(tag.id, documentTag.tagId))
		.where(inArray(documentTag.documentId, documentIds))
		.orderBy(asc(tag.name), asc(tag.id));

	for (const row of rows) {
		const { documentId, ...summary } = row;
		const bucket = result.get(documentId);
		if (bucket) {
			bucket.push(summary);
		} else {
			result.set(documentId, [summary]);
		}
	}
	return result;
}

/** Count of non-deleted documents carrying the tag (internal/test usage). */
export async function countTaggedDocuments(
	db: Db,
	tagId: string,
): Promise<number> {
	const rows = await db
		.select({ value: sql<number>`count(*)::int` })
		.from(documentTag)
		.innerJoin(document, eq(document.id, documentTag.documentId))
		.where(and(eq(documentTag.tagId, tagId), isNull(document.deletedAt)));
	return rows[0]?.value ?? 0;
}
