import { randomBytes } from "node:crypto";
import type { Db } from "@docstore/db";
import type { WebhookRow } from "@docstore/db/schema/webhook";
import { webhook, webhookDelivery } from "@docstore/db/schema/webhook";
import type { IngestionBinding } from "@docstore/ingestion";
import type { Paginated } from "@docstore/shared/pagination";
import { paginationMeta } from "@docstore/shared/pagination";
import type {
	CreateWebhookInput,
	ListWebhookDeliveriesInput,
	TestWebhookResult,
	UpdateWebhookInput,
	Webhook,
	WebhookDelivery,
} from "@docstore/shared/webhook";
import { WEBHOOK_SECRET_LENGTH } from "@docstore/shared/webhook";
import { ORPCError } from "@orpc/server";
import { desc, eq, sql } from "drizzle-orm";

/**
 * Outgoing webhooks (SPEC §2 "Misc").
 *
 * This service delivers nothing: it manages subscriptions and publishes
 * `webhook.deliver` jobs. HTTP delivery and its retries live in
 * `@docstore/ingestion`.
 */

/** Hexadecimal secret, copyable into the receiving service. */
export function generateWebhookSecret(): string {
	return randomBytes(WEBHOOK_SECRET_LENGTH).toString("hex");
}

function toWebhook(row: WebhookRow): Webhook {
	return {
		id: row.id,
		name: row.name,
		url: row.url,
		secret: row.secret,
		events: row.events,
		enabled: row.enabled,
		lastStatus: row.lastStatus,
		lastCalledAt: row.lastCalledAt,
		createdAt: row.createdAt,
	};
}

export async function listWebhooks(db: Db): Promise<Webhook[]> {
	const rows = await db
		.select()
		.from(webhook)
		.orderBy(desc(webhook.createdAt), desc(webhook.id));
	return rows.map(toWebhook);
}

async function requireRow(db: Db, id: string): Promise<WebhookRow> {
	const rows = await db
		.select()
		.from(webhook)
		.where(eq(webhook.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Webhook "${id}" not found.`,
		});
	}
	return row;
}

export async function createWebhook(
	db: Db,
	input: CreateWebhookInput,
): Promise<Webhook> {
	const rows = await db
		.insert(webhook)
		.values({
			name: input.name,
			url: input.url,
			secret: input.secret ?? generateWebhookSecret(),
			events: input.events,
			enabled: input.enabled,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The webhook could not be created.",
		});
	}
	return toWebhook(row);
}

export async function updateWebhook(
	db: Db,
	input: UpdateWebhookInput,
): Promise<Webhook> {
	const existing = await requireRow(db, input.id);
	const rows = await db
		.update(webhook)
		.set({
			name: input.name ?? existing.name,
			url: input.url ?? existing.url,
			secret: input.secret ?? existing.secret,
			events: input.events ?? existing.events,
			enabled: input.enabled ?? existing.enabled,
		})
		.where(eq(webhook.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Webhook "${input.id}" not found.`,
		});
	}
	return toWebhook(row);
}

export async function deleteWebhook(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	await requireRow(db, id);
	await db.delete(webhook).where(eq(webhook.id, id));
	return { id, deleted: true };
}

/** Sends a `ping` event to the webhook, to check the URL and the secret. */
export async function testWebhook(
	db: Db,
	ingestion: IngestionBinding | undefined,
	id: string,
): Promise<TestWebhookResult> {
	const row = await requireRow(db, id);
	if (!ingestion?.queue) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "The processing queue is not available on this server.",
		});
	}
	const jobId = await ingestion.queue.publishWebhookDeliver({
		webhookId: row.id,
		event: "ping",
		payload: {
			event: "ping",
			webhookId: row.id,
			sentAt: new Date().toISOString(),
		},
	});
	return { queued: jobId !== null, jobId };
}

export async function listWebhookDeliveries(
	db: Db,
	input: ListWebhookDeliveriesInput,
): Promise<Paginated<WebhookDelivery>> {
	await requireRow(db, input.id);

	const totals = await db
		.select({ value: sql<number>`count(*)::int` })
		.from(webhookDelivery)
		.where(eq(webhookDelivery.webhookId, input.id));
	const total = totals[0]?.value ?? 0;

	const items = await db
		.select()
		.from(webhookDelivery)
		.where(eq(webhookDelivery.webhookId, input.id))
		.orderBy(desc(webhookDelivery.createdAt), desc(webhookDelivery.id))
		.limit(input.pageSize)
		.offset((input.page - 1) * input.pageSize);

	return {
		items,
		...paginationMeta(total, input.page, input.pageSize),
	};
}
