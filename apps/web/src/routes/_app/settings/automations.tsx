import { Button } from "@docstore/ui/components/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { HistoryIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { SettingsSkeleton } from "@/components/page-skeletons";
import { AUTOMATIONS_DESCRIPTION } from "@/components/rules/rule-labels";
import { RuleList } from "@/components/rules/rule-list";
import { RuleRunsDrawer } from "@/components/rules/rule-runs-drawer";

export const Route = createFileRoute("/_app/settings/automations")({
	component: AutomationsPage,
	pendingComponent: SettingsSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.rule.list.queryOptions({ input: {} }),
		),
});

/**
 * "Automations" tab of the settings: the cross-cutting rules of the engine
 * (SPEC §3). Everything that classifies a recurring document — category,
 * issuer, layout, extraction — belongs to a document type instead.
 */
function AutomationsPage() {
	const [runsOpen, setRunsOpen] = useState(false);

	return (
		<>
			<div className="mx-6 mt-6 flex flex-wrap items-start justify-between gap-3 lg:mx-8">
				<p className="max-w-3xl text-muted-foreground text-sm">
					{AUTOMATIONS_DESCRIPTION}
				</p>
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="ghost" onClick={() => setRunsOpen(true)}>
						<HistoryIcon />
						History
					</Button>
					<Link to="/settings/automations/new">
						<Button>
							<PlusIcon />
							New automation
						</Button>
					</Link>
				</div>
			</div>

			<RuleList />

			<RuleRunsDrawer open={runsOpen} onOpenChange={setRunsOpen} />
		</>
	);
}
