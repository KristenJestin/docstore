import { createFileRoute } from "@tanstack/react-router";

import { SettingsSkeleton } from "@/components/page-skeletons";
import { GeneralSettings } from "@/components/settings/general-settings";

export const Route = createFileRoute("/_app/settings/general")({
	component: GeneralSettings,
	pendingComponent: SettingsSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.settings.get.queryOptions({ input: {} }),
		),
});
