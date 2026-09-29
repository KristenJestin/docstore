import type {
	ActivityActorType,
	ActivityKind,
	ActivityObjectType,
	ActivitySummary,
} from "@docstore/shared/activity";
import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { createId } from "../id";

/**
 * Activity log (issue #15): one row per change and per traced read, whatever
 * the surface (web, oRPC, MCP, rules, pipeline).
 *
 * No foreign key on purpose (D15-01): the log is kept forever and has to
 * outlive the key, the user and the document it names. The key and object
 * names are copied into the row for the same reason.
 *
 * The indexes follow the filters of `activity.list` and `list_activity`: the
 * newest entries first, then by key, by user, by object and by action, each
 * ordered by time so a filtered page is an index range scan.
 */
export const activityLog = pgTable(
	"activity_log",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("act_")),
		/** Set by the writer with millisecond precision, like the `since` filter. */
		createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
		kind: text("kind").$type<ActivityKind>().notNull(),
		action: text("action").notNull(),
		actorType: text("actor_type").$type<ActivityActorType>().notNull(),
		actorUserId: text("actor_user_id"),
		actorApiKeyId: text("actor_api_key_id"),
		/** Name of the key, or of the user, at the time of the entry. */
		actorName: text("actor_name"),
		objectType: text("object_type").$type<ActivityObjectType>().notNull(),
		objectId: text("object_id"),
		objectLabel: text("object_label"),
		summary: jsonb("summary")
			.$type<ActivitySummary>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		sensitive: boolean("sensitive").notNull().default(false),
	},
	(table) => [
		index("activity_log_created_at_idx").on(
			table.createdAt.desc(),
			table.id.desc(),
		),
		index("activity_log_api_key_idx").on(
			table.actorApiKeyId,
			table.createdAt.desc(),
		),
		index("activity_log_user_idx").on(
			table.actorUserId,
			table.createdAt.desc(),
		),
		index("activity_log_object_idx").on(table.objectId, table.createdAt.desc()),
		index("activity_log_action_idx").on(table.action, table.createdAt.desc()),
	],
);

export type ActivityLogRow = typeof activityLog.$inferSelect;
export type NewActivityLog = typeof activityLog.$inferInsert;
