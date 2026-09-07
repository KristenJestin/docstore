import { createFileRoute } from "@tanstack/react-router";

import { SettingsSkeleton } from "@/components/page-skeletons";
import { UploadLinkList } from "@/components/settings/upload-link-list";

export const Route = createFileRoute("/_app/settings/upload-links")({
	component: UploadLinkList,
	pendingComponent: SettingsSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.uploadLink.list.queryOptions({ input: {} }),
		),
});
