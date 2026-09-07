import { createFileRoute } from "@tanstack/react-router";

import { SettingsSkeleton } from "@/components/page-skeletons";
import { CategoryTree } from "@/components/settings/category-tree";

export const Route = createFileRoute("/_app/settings/categories")({
	component: CategoryTree,
	pendingComponent: SettingsSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.category.list.queryOptions({ input: {} }),
		),
});
