import { createFileRoute } from "@tanstack/react-router";

import { SettingsSkeleton } from "@/components/page-skeletons";
import { TagManager } from "@/components/settings/tag-manager";

export const Route = createFileRoute("/_app/settings/tags")({
	component: TagManager,
	pendingComponent: SettingsSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.tag.list.queryOptions({ input: {} }),
		),
});
