import { createFileRoute } from "@tanstack/react-router";

import { TagManager } from "@/components/settings/tag-manager";

export const Route = createFileRoute("/_app/settings/tags")({
	component: TagManager,
});
