import { DOCUMENT_TOMBSTONE_REASONS } from "@docstore/shared/document";
import { sql } from "drizzle-orm";
import {
	check,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const documentTombstoneReasonEnum = pgEnum(
	"document_tombstone_reason",
	DOCUMENT_TOMBSTONE_REASONS,
);

/**
 * What became of a document id that no longer answers for a live document of
 * its own (issue #2), so that a `doc_…` cited elsewhere always leads somewhere:
 *
 * - `merged`: `mergeAsVersion` absorbed it into `merged_into_id`; every read of
 *   the id is redirected there, even after the absorbed row is purged from the
 *   trash. Restoring the document removes the row.
 * - `deleted`: it was permanently deleted; reads answer `410 GONE` instead of
 *   the `404` of an id that never existed.
 *
 * No foreign key on purpose: the row has to outlive the document it describes,
 * and `merged_into_id` may point at a document that is itself gone (the chain
 * then ends on that document's own tombstone).
 */
export const documentTombstone = pgTable(
	"document_tombstone",
	{
		documentId: text("document_id").primaryKey(),
		reason: documentTombstoneReasonEnum("reason").notNull(),
		mergedIntoId: text("merged_into_id"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("document_tombstone_merged_into_id_idx").on(table.mergedIntoId),
		// A merge always names its target; a deletion never does.
		check(
			"document_tombstone_target_ck",
			sql`(${table.reason} = 'merged') = (${table.mergedIntoId} is not null)`,
		),
		check(
			"document_tombstone_no_self_ck",
			sql`${table.mergedIntoId} is null or ${table.mergedIntoId} <> ${table.documentId}`,
		),
	],
);

export type DocumentTombstoneRow = typeof documentTombstone.$inferSelect;
export type NewDocumentTombstone = typeof documentTombstone.$inferInsert;
