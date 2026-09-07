import type { Db } from "@docstore/db";
import { category } from "@docstore/db/schema/category";
import { party } from "@docstore/db/schema/party";
import { tag } from "@docstore/db/schema/tag";
import type { IntakeDefaults } from "@docstore/shared/intake";
import { ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";

/**
 * Default values imposed by an intake channel (SPEC §5): category, tags and
 * Issuer written on every document arriving through it.
 *
 * They are checked when the channel is saved rather than when a document comes
 * in: a dangling identifier would otherwise fail silently, hours later, on a
 * document nobody is watching — and an upload link is often handed to a third
 * party long before the first file arrives.
 */
export async function assertIntakeDefaults(
	db: Db,
	defaults: IntakeDefaults | undefined,
): Promise<void> {
	if (!defaults) return;

	if (defaults.categoryId) {
		const rows = await db
			.select({ id: category.id })
			.from(category)
			.where(eq(category.id, defaults.categoryId))
			.limit(1);
		if (!rows[0]) {
			throw new ORPCError("NOT_FOUND", {
				message: `Category "${defaults.categoryId}" not found.`,
			});
		}
	}

	const tagIds = [...new Set(defaults.tagIds ?? [])];
	if (tagIds.length > 0) {
		const rows = await db
			.select({ id: tag.id })
			.from(tag)
			.where(inArray(tag.id, tagIds));
		const found = new Set(rows.map((row) => row.id));
		const missing = tagIds.filter((id) => !found.has(id));
		if (missing.length > 0) {
			throw new ORPCError("NOT_FOUND", {
				message: `Tag not found: ${missing.join(", ")}.`,
			});
		}
	}

	if (defaults.partyId) {
		const rows = await db
			.select({ id: party.id })
			.from(party)
			.where(eq(party.id, defaults.partyId))
			.limit(1);
		if (!rows[0]) {
			throw new ORPCError("NOT_FOUND", {
				message: `Party "${defaults.partyId}" not found.`,
			});
		}
	}
}
