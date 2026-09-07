import { Button } from "@docstore/ui/components/button";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { EmptyState } from "@/components/empty-state";
import { RuleEditor } from "@/components/rules/rule-editor";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_app/settings_/automations/$ruleId")({
	component: AutomationDetailPage,
});

function AutomationDetailPage() {
	const { ruleId } = Route.useParams();
	const rule = useQuery(orpc.rule.get.queryOptions({ input: { id: ruleId } }));

	if (rule.isLoading) {
		return (
			<div className="flex flex-col gap-4 px-6 py-8 lg:px-8">
				<Skeleton className="h-10 w-96" />
				<Skeleton className="h-160 w-full" />
			</div>
		);
	}

	if (rule.isError || !rule.data) {
		return (
			<div className="px-6 py-8 lg:px-8">
				<EmptyState
					title="Automation not found"
					description="This automation may have been deleted."
					action={
						<Link to="/settings/automations">
							<Button variant="outline">Back to automations</Button>
						</Link>
					}
				/>
			</div>
		);
	}

	// Remounting on the id keeps the draft state in sync with the loaded rule.
	return <RuleEditor key={rule.data.id} rule={rule.data} />;
}
