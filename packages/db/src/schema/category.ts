import { relations, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId } from "../id";

/**
 * Hierarchical category (SPEC §2). The maximum depth (3 levels) cannot be
 * expressed as a simple constraint: it is checked by the service.
 */
export const category = pgTable(
	"category",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("cat_")),
		parentId: text("parent_id").references((): AnyPgColumn => category.id, {
			onDelete: "set null",
		}),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		/** Lucide icon name in kebab-case. */
		icon: text("icon"),
		color: text("color"),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("category_parent_id_idx").on(table.parentId),
		// Since `null` is never equal to itself, roots would be excluded from a
		// plain unique index: a missing parent is normalized to "".
		uniqueIndex("category_parent_slug_uidx").on(
			sql`coalesce(${table.parentId}, '')`,
			table.slug,
		),
	],
);

export const categoryRelations = relations(category, ({ one, many }) => ({
	parent: one(category, {
		fields: [category.parentId],
		references: [category.id],
		relationName: "category_parent",
	}),
	children: many(category, { relationName: "category_parent" }),
}));

export type Category = typeof category.$inferSelect;
export type NewCategory = typeof category.$inferInsert;
