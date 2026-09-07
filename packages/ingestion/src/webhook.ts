import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import { webhook, webhookDelivery } from "@docstore/db/schema/webhook";
import type {
	DeliverableEvent,
	WebhookDocument,
	WebhookEvent,
} from "@docstore/shared/webhook";
import {
	WEBHOOK_DELIVERY_HEADER,
	WEBHOOK_EVENT_HEADER,
	WEBHOOK_SIGNATURE_HEADER,
	WEBHOOK_TIMEOUT_MS,
} from "@docstore/shared/webhook";
import { and, eq, sql } from "drizzle-orm";
import type { IngestionContext } from "./context";
import type { WebhookDeliverPayload } from "./jobs";

/**
 * Outgoing webhooks (SPEC §2 "Misc", §5 `finalize` step).
 *
 * `emitEvent` only stacks jobs: the HTTP delivery is the work of
 * `deliverWebhook`, replayed by pg-boss on failure. An unreachable webhook must
 * never make the pipeline that triggered it fail.
 */

/** Signature of the delivered body: `sha256=<hex>`. */
export function signPayload(body: string, secret: string): string {
	return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

/** Constant-time comparison, for the consumers and the tests. */
export function verifySignature(
	body: string,
	secret: string,
	signature: string,
): boolean {
	const expected = Buffer.from(signPayload(body, secret));
	const received = Buffer.from(signature);
	if (expected.length !== received.length) return false;
	return timingSafeEqual(expected, received);
}

/** Summary of a document, body of the `document.*` events. */
export async function webhookDocumentSummary(
	db: Db,
	documentId: string,
): Promise<WebhookDocument | null> {
	const rows = await db
		.select()
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return {
		id: row.id,
		title: row.title,
		status: row.status,
		source: row.source,
		sourceRef: row.sourceRef,
		documentDate: row.documentDate,
		categoryId: row.categoryId,
		sensitive: row.sensitive,
		reviewReasons: row.reviewReasons.map((reason) => reason.code),
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * Publishes an event to every enabled webhook subscribed to it.
 *
 * Without a queue (unit tests, degraded server) the call is a no-op: this is
 * intentional, the pipeline must keep working without pg-boss.
 */
export async function emitEvent(
	ctx: IngestionContext,
	event: WebhookEvent,
	payload: unknown,
): Promise<number> {
	if (!ctx.queue) return 0;
	try {
		const targets = await ctx.db
			.select({ id: webhook.id })
			.from(webhook)
			.where(
				and(
					eq(webhook.enabled, true),
					sql`${webhook.events} @> ARRAY[${event}]::text[]`,
				),
			);
		for (const target of targets) {
			await ctx.queue.publishWebhookDeliver({
				webhookId: target.id,
				event,
				payload,
			});
		}
		return targets.length;
	} catch (error) {
		console.error("[webhook] unable to publish", error);
		return 0;
	}
}

/** Document variant: builds the summary then emits. */
export async function emitDocumentEvent(
	ctx: IngestionContext,
	event: WebhookEvent,
	documentId: string,
): Promise<number> {
	const summary = await webhookDocumentSummary(ctx.db, documentId);
	if (!summary) return 0;
	return emitEvent(ctx, event, { event, document: summary });
}

/** `webhook { url }` rule action: delivery to an ad hoc URL. */
export async function emitRuleWebhook(
	ctx: IngestionContext,
	url: string,
	documentId: string,
	ruleId?: string,
): Promise<boolean> {
	if (!ctx.queue) return false;
	const summary = await webhookDocumentSummary(ctx.db, documentId);
	if (!summary) return false;
	await ctx.queue.publishWebhookDeliver({
		url,
		event: "rule.webhook",
		payload: {
			event: "rule.webhook",
			...(ruleId ? { ruleId } : {}),
			document: summary,
		},
	});
	return true;
}

export interface DeliveryOutcome {
	delivered: boolean;
	statusCode: number | null;
	error: string | null;
}

/** Maximum length kept in `webhook_delivery.error`. */
const MAX_ERROR_LENGTH = 1000;

/**
 * Delivers an event. Always logs into `webhook_delivery`, then throws if the
 * target did not answer 2xx: pg-boss takes care of the retries (`attempt`
 * reflects the attempt number).
 */
export async function deliverWebhook(
	ctx: IngestionContext,
	payload: WebhookDeliverPayload,
	attempt = 1,
): Promise<DeliveryOutcome> {
	let url = payload.url;
	let secret: string | null = null;

	if (payload.webhookId) {
		const rows = await ctx.db
			.select()
			.from(webhook)
			.where(eq(webhook.id, payload.webhookId))
			.limit(1);
		const row = rows[0];
		// Webhook deleted or disabled meanwhile: we give up without an error.
		if (!row?.enabled) {
			return { delivered: false, statusCode: null, error: null };
		}
		url = row.url;
		secret = row.secret;
	}

	if (!url) {
		throw new Error("Webhook delivery without a target URL.");
	}

	const body = JSON.stringify(payload.payload ?? {});
	const deliveryId = crypto.randomUUID();
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		[WEBHOOK_EVENT_HEADER]: payload.event,
		[WEBHOOK_DELIVERY_HEADER]: deliveryId,
	};
	// A rule action has no secret: no signature to set.
	if (secret) headers[WEBHOOK_SIGNATURE_HEADER] = signPayload(body, secret);

	let statusCode: number | null = null;
	let error: string | null = null;

	try {
		const response = await fetch(url, {
			method: "POST",
			headers,
			body,
			signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
		});
		statusCode = response.status;
		if (!response.ok) error = `HTTP ${response.status}`;
	} catch (caught) {
		error = caught instanceof Error ? caught.message : String(caught);
	}

	await ctx.db.insert(webhookDelivery).values({
		webhookId: payload.webhookId ?? null,
		event: payload.event as DeliverableEvent,
		payload: payload.payload ?? {},
		statusCode,
		attempt,
		error: error?.slice(0, MAX_ERROR_LENGTH) ?? null,
	});

	if (payload.webhookId) {
		await ctx.db
			.update(webhook)
			.set({ lastStatus: statusCode, lastCalledAt: new Date() })
			.where(eq(webhook.id, payload.webhookId));
	}

	if (error) {
		throw new Error(`Webhook ${url}: ${error}`);
	}
	return { delivered: true, statusCode, error: null };
}
