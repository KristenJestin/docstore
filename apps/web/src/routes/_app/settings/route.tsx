import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { SETTINGS_TABS } from "@/lib/navigation";

export const Route = createFileRoute("/_app/settings")({
	component: SettingsLayout,
});

/**
 * Settings shell: one header for the whole section and a sub-navigation whose
 * entries are real routes, so every tab is linkable and reloadable.
 */
function SettingsLayout() {
	return (
		<>
			<PageHeader
				kicker="System"
				title="Settings"
				description="Taxonomy, custom fields, integrations and everything the household shares."
			>
				<nav
					aria-label="Settings sections"
					className="mt-6 -mb-6 flex gap-1 overflow-x-auto pb-2"
				>
					{SETTINGS_TABS.map((tab) => (
						<Link
							key={tab.to}
							to={tab.to}
							className="whitespace-nowrap rounded-lg px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors duration-200 ease-premium hover:bg-muted hover:text-foreground data-[status=active]:bg-selection data-[status=active]:font-semibold data-[status=active]:text-selection-foreground"
						>
							{tab.label}
						</Link>
					))}
				</nav>
			</PageHeader>

			<Outlet />
		</>
	);
}
