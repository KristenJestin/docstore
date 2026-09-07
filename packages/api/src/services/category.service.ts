import type { Db } from "@docstore/db";
import { category } from "@docstore/db/schema/category";
import { document } from "@docstore/db/schema/document";
import type {
	Category,
	CategoryNode,
	CreateCategoryInput,
	DeleteCategoryInput,
	MoveCategoryInput,
	ReorderCategoriesInput,
	UpdateCategoryInput,
} from "@docstore/shared/category";
import { CATEGORY_MAX_DEPTH } from "@docstore/shared/category";
import { slugify } from "@docstore/shared/common";
import { ORPCError } from "@orpc/server";
import { asc, count, eq, isNull, sql } from "drizzle-orm";

type CategoryRow = typeof category.$inferSelect;

async function loadAll(db: Db): Promise<CategoryRow[]> {
	return db
		.select()
		.from(category)
		.orderBy(asc(category.sortOrder), asc(category.name), asc(category.id));
}

function childrenOf(rows: CategoryRow[]): Map<string | null, CategoryRow[]> {
	const map = new Map<string | null, CategoryRow[]>();
	for (const row of rows) {
		const key = row.parentId;
		const bucket = map.get(key);
		if (bucket) {
			bucket.push(row);
		} else {
			map.set(key, [row]);
		}
	}
	return map;
}

/** Depth of a category: 1 for a root. */
function depthOf(byId: Map<string, CategoryRow>, id: string): number {
	let depth = 1;
	let current = byId.get(id);
	const seen = new Set<string>([id]);
	while (current?.parentId) {
		if (seen.has(current.parentId)) {
			// Safety: a cycle in the database must not block the service.
			break;
		}
		seen.add(current.parentId);
		current = byId.get(current.parentId);
		depth += 1;
	}
	return depth;
}

/** Number of levels in the subtree rooted at `id` (1 = leaf). */
function heightOf(children: Map<string | null, CategoryRow[]>, id: string) {
	let height = 1;
	for (const child of children.get(id) ?? []) {
		height = Math.max(height, 1 + heightOf(children, child.id));
	}
	return height;
}

function collectSubtree(
	children: Map<string | null, CategoryRow[]>,
	id: string,
	into: string[] = [],
): string[] {
	into.push(id);
	for (const child of children.get(id) ?? []) {
		collectSubtree(children, child.id, into);
	}
	return into;
}

/**
 * Identifiers of a category and of all its descendants.
 * Used by `document.list` for the recursive "category" filter.
 */
export async function categorySubtreeIds(
	db: Db,
	id: string,
): Promise<string[]> {
	const rows = await loadAll(db);
	if (!rows.some((row) => row.id === id)) {
		throw new ORPCError("NOT_FOUND", {
			message: `Category "${id}" not found.`,
		});
	}
	return collectSubtree(childrenOf(rows), id);
}

/** Counts non-deleted documents per direct category. */
async function ownCounts(db: Db): Promise<Map<string, number>> {
	const rows = await db
		.select({ categoryId: document.categoryId, value: count() })
		.from(document)
		.where(isNull(document.deletedAt))
		.groupBy(document.categoryId);

	const map = new Map<string, number>();
	for (const row of rows) {
		if (row.categoryId) {
			map.set(row.categoryId, row.value);
		}
	}
	return map;
}

export async function listCategories(db: Db): Promise<CategoryNode[]> {
	const [rows, counts] = await Promise.all([loadAll(db), ownCounts(db)]);
	const children = childrenOf(rows);

	function build(row: CategoryRow, depth: number): CategoryNode {
		const kids = (children.get(row.id) ?? []).map((child) =>
			build(child, depth + 1),
		);
		const ownDocumentCount = counts.get(row.id) ?? 0;
		return {
			...row,
			depth,
			ownDocumentCount,
			documentCount:
				ownDocumentCount +
				kids.reduce((total, kid) => total + kid.documentCount, 0),
			children: kids,
		};
	}

	return (children.get(null) ?? []).map((row) => build(row, 1));
}

async function requireCategory(db: Db, id: string): Promise<Category> {
	const rows = await db
		.select()
		.from(category)
		.where(eq(category.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Category "${id}" not found.`,
		});
	}
	return row;
}

/** Slug unique among siblings: `invoice`, `invoice-2`, `invoice-3`… */
async function uniqueSlug(
	db: Db,
	parentId: string | null,
	base: string,
	excludeId?: string,
): Promise<string> {
	const siblings = await db
		.select({ id: category.id, slug: category.slug })
		.from(category)
		.where(
			parentId === null
				? isNull(category.parentId)
				: eq(category.parentId, parentId),
		);
	const taken = new Set(
		siblings.filter((row) => row.id !== excludeId).map((row) => row.slug),
	);

	// Fallback for a name that slugifies to nothing (emoji, CJK, punctuation).
	const root = base || "category";
	if (!taken.has(root)) {
		return root;
	}
	let suffix = 2;
	while (taken.has(`${root}-${suffix}`)) {
		suffix += 1;
	}
	return `${root}-${suffix}`;
}

async function nextSortOrder(db: Db, parentId: string | null): Promise<number> {
	const rows = await db
		.select({ value: sql<number>`coalesce(max(${category.sortOrder}), -1)` })
		.from(category)
		.where(
			parentId === null
				? isNull(category.parentId)
				: eq(category.parentId, parentId),
		);
	return (rows[0]?.value ?? -1) + 1;
}

export async function createCategory(
	db: Db,
	input: CreateCategoryInput,
): Promise<Category> {
	const parentId = input.parentId ?? null;
	if (parentId) {
		const rows = await loadAll(db);
		const byId = new Map(rows.map((row) => [row.id, row]));
		if (!byId.has(parentId)) {
			throw new ORPCError("NOT_FOUND", {
				message: `Parent category "${parentId}" not found.`,
			});
		}
		if (depthOf(byId, parentId) >= CATEGORY_MAX_DEPTH) {
			throw new ORPCError("BAD_REQUEST", {
				message: `The category tree is limited to ${CATEGORY_MAX_DEPTH} levels.`,
			});
		}
	}

	const slug = await uniqueSlug(db, parentId, slugify(input.name));
	const rows = await db
		.insert(category)
		.values({
			parentId,
			name: input.name,
			slug,
			icon: input.icon ?? null,
			color: input.color ?? null,
			sortOrder: await nextSortOrder(db, parentId),
		})
		.returning();

	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The category could not be created.",
		});
	}
	return row;
}

export async function updateCategory(
	db: Db,
	input: UpdateCategoryInput,
): Promise<Category> {
	const current = await requireCategory(db, input.id);

	const patch: Partial<typeof category.$inferInsert> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.icon !== undefined) patch.icon = input.icon ?? null;
	if (input.color !== undefined) patch.color = input.color ?? null;
	if (input.slug !== undefined) {
		patch.slug = await uniqueSlug(db, current.parentId, input.slug, current.id);
	}

	if (Object.keys(patch).length === 0) {
		return current;
	}

	const rows = await db
		.update(category)
		.set(patch)
		.where(eq(category.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Category "${input.id}" not found.`,
		});
	}
	return row;
}

export async function moveCategory(
	db: Db,
	input: MoveCategoryInput,
): Promise<Category> {
	const rows = await loadAll(db);
	const byId = new Map(rows.map((row) => [row.id, row]));
	const current = byId.get(input.id);
	if (!current) {
		throw new ORPCError("NOT_FOUND", {
			message: `Category "${input.id}" not found.`,
		});
	}

	const parentId = input.parentId ?? null;
	const children = childrenOf(rows);

	if (parentId) {
		if (!byId.has(parentId)) {
			throw new ORPCError("NOT_FOUND", {
				message: `Parent category "${parentId}" not found.`,
			});
		}
		const subtree = new Set(collectSubtree(children, input.id));
		if (subtree.has(parentId)) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"A category cannot be moved under itself or under one of its subcategories.",
			});
		}
		const newDepth = depthOf(byId, parentId) + 1;
		if (newDepth + heightOf(children, input.id) - 1 > CATEGORY_MAX_DEPTH) {
			throw new ORPCError("BAD_REQUEST", {
				message: `The category tree is limited to ${CATEGORY_MAX_DEPTH} levels.`,
			});
		}
	}

	const slug =
		parentId === current.parentId
			? current.slug
			: await uniqueSlug(db, parentId, current.slug, current.id);

	const updated = await db
		.update(category)
		.set({ parentId, sortOrder: input.sortOrder, slug })
		.where(eq(category.id, input.id))
		.returning();
	const row = updated[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Category "${input.id}" not found.`,
		});
	}
	return row;
}

/**
 * Renumbers one sibling group (drag & drop inside a level).
 *
 * Nothing changes parent here — that is `moveCategory`'s job. Every id must
 * already sit under `parentId`; siblings left out of the list keep their
 * relative order and are appended after the listed ones, so a partial payload
 * never scrambles the rest of the level.
 */
export async function reorderCategories(
	db: Db,
	input: ReorderCategoriesInput,
): Promise<CategoryNode[]> {
	const parentId = input.parentId ?? null;
	const rows = await loadAll(db);
	const byId = new Map(rows.map((row) => [row.id, row]));

	const unique = [...new Set(input.ids)];
	const missing = unique.filter((id) => !byId.has(id));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Category not found: ${missing.join(", ")}.`,
		});
	}
	const foreign = unique.filter((id) => byId.get(id)?.parentId !== parentId);
	if (foreign.length > 0) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Not a child of the target parent: ${foreign.join(", ")}. Use \`move\` to change the parent.`,
		});
	}

	const listed = new Set(unique);
	const rest = (childrenOf(rows).get(parentId) ?? [])
		.filter((row) => !listed.has(row.id))
		.map((row) => row.id);
	const ordered = [...unique, ...rest];

	await db.transaction(async (tx) => {
		for (const [index, id] of ordered.entries()) {
			await tx
				.update(category)
				.set({ sortOrder: index })
				.where(eq(category.id, id));
		}
	});

	return listCategories(db);
}

/**
 * Deletes a category: its documents move to `reassignTo` (or lose their
 * category) and its children move up one level.
 */
export async function deleteCategory(
	db: Db,
	input: DeleteCategoryInput,
): Promise<{ id: string; deleted: true; reassignedDocuments: number }> {
	const current = await requireCategory(db, input.id);
	const reassignTo = input.reassignTo ?? null;

	if (reassignTo) {
		if (reassignTo === input.id) {
			throw new ORPCError("BAD_REQUEST", {
				message: "The fallback category cannot be the deleted one.",
			});
		}
		await requireCategory(db, reassignTo);
	}

	// Children move up to the parent: their slug must stay unique there.
	const orphans = await db
		.select({ id: category.id, slug: category.slug })
		.from(category)
		.where(eq(category.parentId, input.id));
	const destinationSlugs = new Set(
		(
			await db
				.select({ slug: category.slug })
				.from(category)
				.where(
					current.parentId === null
						? isNull(category.parentId)
						: eq(category.parentId, current.parentId),
				)
		).map((row) => row.slug),
	);
	destinationSlugs.delete(current.slug);
	const reparented = orphans.map((child) => {
		let slug = child.slug;
		let suffix = 2;
		while (destinationSlugs.has(slug)) {
			slug = `${child.slug}-${suffix}`;
			suffix += 1;
		}
		destinationSlugs.add(slug);
		return { id: child.id, slug };
	});

	return db.transaction(async (tx) => {
		const moved = await tx
			.update(document)
			.set({ categoryId: reassignTo })
			.where(eq(document.categoryId, input.id))
			.returning({ id: document.id });

		for (const child of reparented) {
			await tx
				.update(category)
				.set({ parentId: current.parentId, slug: child.slug })
				.where(eq(category.id, child.id));
		}

		await tx.delete(category).where(eq(category.id, input.id));

		return {
			id: input.id,
			deleted: true as const,
			reassignedDocuments: moved.length,
		};
	});
}

/** Checks that a category exists (used by `document.setCategory`). */
export async function assertCategoryExists(db: Db, id: string): Promise<void> {
	const rows = await db
		.select({ id: category.id })
		.from(category)
		.where(eq(category.id, id))
		.limit(1);
	if (!rows[0]) {
		throw new ORPCError("NOT_FOUND", {
			message: `Category "${id}" not found.`,
		});
	}
}
