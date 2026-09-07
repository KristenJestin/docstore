import type { DeliverableEvent, WebhookEvent } from "@docstore/shared/webhook";
import { relations, sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { createId } from "../id";

/**
 * Outgoing webhooks (SPEC §2 "Misc").
 *
 * `events` stays a `text[]`: the list of events changes faster than a
 * PostgreSQL enum, and filtering already happens on the Zod side.
 */

export const webhook = pgTable(
	"webhook",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("whk_")),
		name: text("name").notNull(),
		url: text("url").notNull(),
		/** Key of the HMAC-SHA256 signature of the delivered body. */
		secret: text("secret").notNull(),
		events: text("events")
			.array()
			.$type<WebhookEvent[]>()
			.notNull()
			.default(sql`'{}'::text[]`),
		enabled: boolean("enabled").notNull().default(true),
		lastStatus: integer("last_status"),
		lastCalledAt: timestamp("last_called_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("webhook_enabled_idx").on(table.enabled)],
);

/**
 * Delivery log. `webhook_id` is nullable: the `webhook { url }` rule action
 * posts to an ad hoc URL, without a registered webhook.
 */
export const webhookDelivery = pgTable(
	"webhook_delivery",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("whd_")),
		webhookId: text("webhook_id").references(() => webhook.id, {
			onDelete: "cascade",
		}),
		event: text("event").$type<DeliverableEvent>().notNull(),
		payload: jsonb("payload").notNull(),
		statusCode: integer("status_code"),
		attempt: integer("attempt").notNull().default(1),
		error: text("error"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("webhook_delivery_webhook_id_idx").on(table.webhookId),
		index("webhook_delivery_created_at_idx").on(table.createdAt),
	],
);

export const webhookRelations = relations(webhook, ({ many }) => ({
	deliveries: many(webhookDelivery),
}));

export const webhookDeliveryRelations = relations(
	webhookDelivery,
	({ one }) => ({
		webhook: one(webhook, {
			fields: [webhookDelivery.webhookId],
			references: [webhook.id],
		}),
	}),
);

export type WebhookRow = typeof webhook.$inferSelect;
export type NewWebhook = typeof webhook.$inferInsert;
export type WebhookDeliveryRow = typeof webhookDelivery.$inferSelect;
export type NewWebhookDelivery = typeof webhookDelivery.$inferInsert;
