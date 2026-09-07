import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Application settings (JSONB key/value).
 *
 * The known keys and their validation schema live in
 * `@docstore/shared/settings`; the table accepts any key so that a new setting
 * does not require a migration.
 */
export const setting = pgTable("settings", {
	key: text("key").primaryKey(),
	value: jsonb("value").notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export type SettingRow = typeof setting.$inferSelect;
export type NewSetting = typeof setting.$inferInsert;
