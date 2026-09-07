import { createFileRoute } from "@tanstack/react-router";

import { SettingsSkeleton } from "@/components/page-skeletons";
import { CustomFieldList } from "@/components/settings/custom-field-list";

export const Route = createFileRoute("/_app/settings/custom-fields")({
	component: CustomFieldList,
	pendingComponent: SettingsSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.customField.list.queryOptions({ input: {} }),
		),
});
