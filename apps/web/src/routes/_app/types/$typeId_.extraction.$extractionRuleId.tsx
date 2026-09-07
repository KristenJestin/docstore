import { Button } from "@docstore/ui/components/button";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { EmptyState } from "@/components/empty-state";
import { ExtractionRuleEditor } from "@/components/rules/extraction-rule-editor";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute(
	"/_app/types/$typeId_/extraction/$extractionRuleId",
)({
	component: ExtractionRuleDetailPage,
});

function ExtractionRuleDetailPage() {
	const { typeId, extractionRuleId } = Route.useParams();
	const rule = useQuery(
		orpc.extractionRule.get.queryOptions({ input: { id: extractionRuleId } }),
	);

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
					title="Extraction rule not found"
					description="This extraction rule may have been deleted."
					action={
						<Link
							to="/types/$typeId"
							params={{ typeId }}
							search={{ tab: "layouts" }}
						>
							<Button variant="outline">Back to the layouts</Button>
						</Link>
					}
				/>
			</div>
		);
	}

	return (
		<ExtractionRuleEditor
			key={rule.data.id}
			documentTypeId={typeId}
			rule={rule.data}
		/>
	);
}
