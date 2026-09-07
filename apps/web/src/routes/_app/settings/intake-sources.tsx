import { createFileRoute } from "@tanstack/react-router";

import { IntakeSourceList } from "@/components/settings/intake-source-list";

export const Route = createFileRoute("/_app/settings/intake-sources")({
	component: IntakeSourceList,
});
