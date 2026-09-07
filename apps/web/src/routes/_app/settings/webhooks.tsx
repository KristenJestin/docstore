import { createFileRoute } from "@tanstack/react-router";

import { WebhookList } from "@/components/settings/webhook-list";

export const Route = createFileRoute("/_app/settings/webhooks")({
	component: WebhookList,
});
