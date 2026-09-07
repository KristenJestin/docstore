import type { ApiKeyScope } from "@docstore/shared/api-key";
import { relations, sql } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createId } from "../id";
import { user } from "./auth";

/**
 * API key (SPEC §6). Only the sha256 of the secret is stored: the plaintext
 * secret is only visible at creation time.
 */
export const apiKey = pgTable(
	"api_key",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("key_")),
		name: text("name").notNull(),
		/** Hexadecimal sha256 of the full secret (`dsk_…`). */
		hashedKey: text("hashed_key").notNull().unique(),
		/** First eight characters of the secret, displayed in the UI. */
		prefix: text("prefix").notNull(),
		scopes: text("scopes")
			.array()
			.$type<ApiKeyScope[]>()
			.notNull()
			.default(sql`'{}'::text[]`),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** Updated at most once a minute by the auth middleware. */
		lastUsedAt: timestamp("last_used_at"),
		expiresAt: timestamp("expires_at"),
		revokedAt: timestamp("revoked_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("api_key_user_id_idx").on(table.userId)],
);

export const apiKeyRelations = relations(apiKey, ({ one }) => ({
	user: one(user, {
		fields: [apiKey.userId],
		references: [user.id],
	}),
}));

export type ApiKeyRow = typeof apiKey.$inferSelect;
export type NewApiKey = typeof apiKey.$inferInsert;
