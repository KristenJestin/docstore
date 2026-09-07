import { createFileRoute } from "@tanstack/react-router";

import { ApiKeyList } from "@/components/settings/api-key-list";

export const Route = createFileRoute("/_app/settings/api-keys")({
	component: ApiKeyList,
});
