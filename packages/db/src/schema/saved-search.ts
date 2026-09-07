import type { SavedSearchFilters } from "@docstore/shared/saved-search";
import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { createId } from "../id";

/**
 * Saved search (SPEC §2): the `document.list` filters persisted, without the
 * current page. The JSONB is validated by `savedSearchFiltersSchema` at the
 * API boundary.
 */
export const savedSearch = pgTable(
	"saved_search",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("sav_")),
		name: text("name").notNull(),
		filters: jsonb("filters").$type<SavedSearchFilters>().notNull(),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("saved_search_sort_order_idx").on(table.sortOrder)],
);

export type SavedSearchRow = typeof savedSearch.$inferSelect;
export type NewSavedSearch = typeof savedSearch.$inferInsert;
