import { createFileRoute } from "@tanstack/react-router";

import { SettingsSkeleton } from "@/components/page-skeletons";
import { IntakeSourceList } from "@/components/settings/intake-source-list";

export const Route = createFileRoute("/_app/settings/intake-sources")({
	component: IntakeSourceList,
	pendingComponent: SettingsSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.intakeSource.list.queryOptions({ input: {} }),
		),
});
