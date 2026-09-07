import { createFileRoute } from "@tanstack/react-router";

import { SettingsSkeleton } from "@/components/page-skeletons";
import { WebhookList } from "@/components/settings/webhook-list";

export const Route = createFileRoute("/_app/settings/webhooks")({
	component: WebhookList,
	pendingComponent: SettingsSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.webhook.list.queryOptions({ input: {} }),
		),
});
