import { createFileRoute } from "@tanstack/react-router";

import { CustomFieldList } from "@/components/settings/custom-field-list";

export const Route = createFileRoute("/_app/settings/custom-fields")({
	component: CustomFieldList,
});
