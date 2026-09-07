import { z } from "zod";

/**
 * Outgoing webhooks (SPEC §2 "Misc", §5 `finalize` step).
 *
 * The body is signed with HMAC-SHA256 using the webhook secret and sent in
 * `X-Docstore-Signature` (`sha256=<hex>`), the event in `X-Docstore-Event`.
 */

export const WEBHOOK_EVENTS = [
	"document.created",
	"document.processed",
	"document.review",
	"document.updated",
	"reminder.due",
] as const;
export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

/**
 * Events that can actually be delivered: the subscriptions plus `ping` (the
 * "test" button) and `rule.webhook` (a rule action to an ad hoc URL).
 */
export const DELIVERABLE_EVENTS = [
	...WEBHOOK_EVENTS,
	"ping",
	"rule.webhook",
] as const;
export const deliverableEventSchema = z.enum(DELIVERABLE_EVENTS);
export type DeliverableEvent = z.infer<typeof deliverableEventSchema>;

/** Headers set on every delivery. */
export const WEBHOOK_SIGNATURE_HEADER = "X-Docstore-Signature";
export const WEBHOOK_EVENT_HEADER = "X-Docstore-Event";
export const WEBHOOK_DELIVERY_HEADER = "X-Docstore-Delivery";

/** Attempts for one delivery (first + 5 retries). */
export const WEBHOOK_RETRY_LIMIT = 5;
/** Delivery timeout. */
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** Length of the secret generated at creation time. */
export const WEBHOOK_SECRET_LENGTH = 32;

export const webhookSchema = z.object({
	id: z.string(),
	name: z.string(),
	url: z.string(),
	/** Returned: it must be copyable into the receiving service. */
	secret: z.string(),
	events: z.array(webhookEventSchema),
	enabled: z.boolean(),
	lastStatus: z.int().nullable(),
	lastCalledAt: z.date().nullable(),
	createdAt: z.date(),
});
export type Webhook = z.infer<typeof webhookSchema>;

export const createWebhookInput = z.object({
	name: z.string().trim().min(1).max(150),
	url: z.url().max(2000),
	events: z.array(webhookEventSchema).min(1),
	/** Generated when absent. */
	secret: z.string().trim().min(16).max(200).optional(),
	enabled: z.boolean().default(true),
});
export type CreateWebhookInput = z.infer<typeof createWebhookInput>;

export const updateWebhookInput = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(150).optional(),
	url: z.url().max(2000).optional(),
	events: z.array(webhookEventSchema).min(1).optional(),
	secret: z.string().trim().min(16).max(200).optional(),
	enabled: z.boolean().optional(),
});
export type UpdateWebhookInput = z.infer<typeof updateWebhookInput>;

export const webhookDeliverySchema = z.object({
	id: z.string(),
	webhookId: z.string().nullable(),
	event: deliverableEventSchema,
	payload: z.unknown(),
	statusCode: z.int().nullable(),
	attempt: z.int().min(1),
	error: z.string().nullable(),
	createdAt: z.date(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const listWebhookDeliveriesInput = z.object({
	id: z.string().min(1),
	page: z.int().min(1).default(1),
	pageSize: z.int().min(1).max(100).default(25),
});
export type ListWebhookDeliveriesInput = z.infer<
	typeof listWebhookDeliveriesInput
>;

export const testWebhookResultSchema = z.object({
	queued: z.boolean(),
	jobId: z.string().nullable(),
});
export type TestWebhookResult = z.infer<typeof testWebhookResultSchema>;

/** Summary of a document sent in the body of an event. */
export const webhookDocumentSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: z.string(),
	source: z.string(),
	sourceRef: z.string().nullable(),
	documentDate: z.string().nullable(),
	categoryId: z.string().nullable(),
	sensitive: z.boolean(),
	reviewReasons: z.array(z.string()),
	createdAt: z.string(),
});
export type WebhookDocument = z.infer<typeof webhookDocumentSchema>;
