import { paginatedSchema } from "@docstore/shared/pagination";
import {
	createWebhookInput,
	listWebhookDeliveriesInput,
	testWebhookResultSchema,
	updateWebhookInput,
	webhookDeliverySchema,
	webhookSchema,
} from "@docstore/shared/webhook";
import { z } from "zod";
import { adminProcedure, protectedProcedure } from "../index";
import {
	createWebhook,
	deleteWebhook,
	listWebhookDeliveries,
	listWebhooks,
	testWebhook,
	updateWebhook,
} from "../services/webhook.service";

const TAGS = ["Webhook"];

const idInput = z.object({ id: z.string().min(1) });

/**
 * Outgoing webhooks (SPEC §2 "Miscellaneous").
 *
 * The signing secret is returned by `list`: it has to be copyable into the
 * destination service. Administration is therefore reserved for `admin`.
 */
export const webhookRouter = {
	list: adminProcedure
		.route({
			method: "GET",
			path: "/webhooks",
			tags: TAGS,
			summary: "List webhooks and their last status",
		})
		.input(z.object({}))
		.output(z.array(webhookSchema))
		.handler(({ context }) => listWebhooks(context.db)),

	create: adminProcedure
		.route({
			method: "POST",
			path: "/webhooks",
			tags: TAGS,
			summary: "Create a webhook (secret generated if absent)",
			successStatus: 201,
		})
		.input(createWebhookInput)
		.output(webhookSchema)
		.handler(({ input, context }) => createWebhook(context.db, input)),

	update: adminProcedure
		.route({
			method: "PATCH",
			path: "/webhooks/{id}",
			tags: TAGS,
			summary: "Update a webhook",
		})
		.input(updateWebhookInput)
		.output(webhookSchema)
		.handler(({ input, context }) => updateWebhook(context.db, input)),

	delete: adminProcedure
		.route({
			method: "DELETE",
			path: "/webhooks/{id}",
			tags: TAGS,
			summary: "Delete a webhook and its delivery log",
		})
		.input(idInput)
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) => deleteWebhook(context.db, input.id)),

	test: adminProcedure
		.route({
			method: "POST",
			path: "/webhooks/{id}/test",
			tags: TAGS,
			summary: "Send a `ping` event to the webhook",
		})
		.input(idInput)
		.output(testWebhookResultSchema)
		.handler(({ input, context }) =>
			testWebhook(context.db, context.ingestion, input.id),
		),

	deliveries: protectedProcedure
		.route({
			method: "GET",
			path: "/webhooks/{id}/deliveries",
			tags: TAGS,
			summary: "Delivery log of a webhook",
		})
		.input(listWebhookDeliveriesInput)
		.output(paginatedSchema(webhookDeliverySchema))
		.handler(({ input, context }) => listWebhookDeliveries(context.db, input)),
};
