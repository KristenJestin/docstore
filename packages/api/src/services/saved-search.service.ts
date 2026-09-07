import type { Db } from "@docstore/db";
import { savedSearch } from "@docstore/db/schema/saved-search";
import type {
	CreateSavedSearchInput,
	ReorderSavedSearchesInput,
	SavedSearchDto,
	UpdateSavedSearchInput,
} from "@docstore/shared/saved-search";
import { ORPCError } from "@orpc/server";
import { asc, eq, sql } from "drizzle-orm";

/**
 * Saved searches (SPEC §2): the `document.list` filters persisted, manually
 * ordered for the sidebar.
 */

async function requireSavedSearch(db: Db, id: string): Promise<SavedSearchDto> {
	const rows = await db
		.select()
		.from(savedSearch)
		.where(eq(savedSearch.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Saved search "${id}" not found.`,
		});
	}
	return row;
}

export function listSavedSearches(db: Db): Promise<SavedSearchDto[]> {
	return db
		.select()
		.from(savedSearch)
		.orderBy(
			asc(savedSearch.sortOrder),
			asc(savedSearch.name),
			asc(savedSearch.id),
		);
}

export async function createSavedSearch(
	db: Db,
	input: CreateSavedSearchInput,
): Promise<SavedSearchDto> {
	const maxRows = await db
		.select({ value: sql<number>`coalesce(max(${savedSearch.sortOrder}), -1)` })
		.from(savedSearch);

	const rows = await db
		.insert(savedSearch)
		.values({
			name: input.name,
			filters: input.filters,
			sortOrder: (maxRows[0]?.value ?? -1) + 1,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The search could not be saved.",
		});
	}
	return row;
}

export async function updateSavedSearch(
	db: Db,
	input: UpdateSavedSearchInput,
): Promise<SavedSearchDto> {
	const current = await requireSavedSearch(db, input.id);

	const patch: Partial<typeof savedSearch.$inferInsert> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.filters !== undefined) patch.filters = input.filters;
	if (Object.keys(patch).length === 0) {
		return current;
	}

	const rows = await db
		.update(savedSearch)
		.set(patch)
		.where(eq(savedSearch.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Saved search "${input.id}" not found.`,
		});
	}
	return row;
}

export async function deleteSavedSearch(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	await requireSavedSearch(db, id);
	await db.delete(savedSearch).where(eq(savedSearch.id, id));
	return { id, deleted: true as const };
}

/** Reorders: the given identifiers move to the front, in the received order. */
export async function reorderSavedSearches(
	db: Db,
	input: ReorderSavedSearchesInput,
): Promise<SavedSearchDto[]> {
	const ids = [...new Set(input.ids)];
	const existing = await listSavedSearches(db);
	const known = new Set(existing.map((row) => row.id));
	const missing = ids.filter((id) => !known.has(id));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Saved search not found: ${missing.join(", ")}.`,
		});
	}

	const ordered = [
		...ids,
		...existing.map((row) => row.id).filter((id) => !ids.includes(id)),
	];

	await db.transaction(async (tx) => {
		for (const [index, id] of ordered.entries()) {
			await tx
				.update(savedSearch)
				.set({ sortOrder: index })
				.where(eq(savedSearch.id, id));
		}
	});

	return listSavedSearches(db);
}
