import { createFileRoute } from "@tanstack/react-router";

import { UploadLinkList } from "@/components/settings/upload-link-list";

export const Route = createFileRoute("/_app/settings/upload-links")({
	component: UploadLinkList,
});
