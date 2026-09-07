import { createFileRoute } from "@tanstack/react-router";

import { CategoryTree } from "@/components/settings/category-tree";

export const Route = createFileRoute("/_app/settings/categories")({
	component: CategoryTree,
});
