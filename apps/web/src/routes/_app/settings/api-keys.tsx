import { createFileRoute } from "@tanstack/react-router";

import { SettingsSkeleton } from "@/components/page-skeletons";
import { ApiKeyList } from "@/components/settings/api-key-list";

export const Route = createFileRoute("/_app/settings/api-keys")({
	component: ApiKeyList,
	pendingComponent: SettingsSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.apiKey.list.queryOptions({ input: {} }),
		),
});
