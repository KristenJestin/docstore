import { Badge } from "@docstore/ui/components/badge";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@docstore/ui/components/sheet";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { formatDateTime } from "@/components/settings/settings-labels";
import { orpc } from "@/utils/orpc";

import { PlannedOperationList } from "./planned-operations";

/** Page size of the run journal. */
const PAGE_SIZE = 25;

export interface RuleRunsDrawerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Absent = journal of every rule. */
	ruleId?: string;
	ruleName?: string;
}

/** Side panel listing the `rule_run` journal (`rule.runs`). */
export function RuleRunsDrawer({
	open,
	onOpenChange,
	ruleId,
	ruleName,
}: RuleRunsDrawerProps) {
	const [page, setPage] = useState(1);

	const runs = useQuery({
		...orpc.rule.runs.queryOptions({
			input: { ruleId, page, pageSize: PAGE_SIZE },
		}),
		enabled: open,
	});

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" size="lg" className="w-full gap-0">
				<SheetHeader className="shrink-0 border-border border-b px-6 py-5">
					<SheetTitle>Run history</SheetTitle>
					<SheetDescription>
						{ruleName
							? `Last evaluations of "${ruleName}", newest first.`
							: "Last evaluations of every rule, newest first."}
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-6">
					{runs.isLoading ? (
						<Skeleton className="h-40 w-full" />
					) : (runs.data?.items.length ?? 0) === 0 ? (
						<EmptyState
							icon={HistoryIcon}
							size="sm"
							title="No run yet"
							description="The journal fills up as documents go through this rule."
						/>
					) : (
						<ul className="flex flex-col gap-3">
							{runs.data?.items.map((run) => (
								<li
									key={run.id}
									className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3 ring-1 ring-border"
								>
									<div className="flex flex-wrap items-center gap-2">
										<Badge tone={run.matched ? "success" : "neutral"}>
											{run.matched ? "matched" : "no match"}
										</Badge>
										<Link
											to="/documents/$documentId"
											params={{ documentId: run.documentId }}
											className="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
										>
											{run.documentId}
										</Link>
										<span className="font-mono text-muted-foreground text-xs tabular-nums">
											{run.durationMs} ms
										</span>
										<span className="font-mono text-muted-foreground text-xs tabular-nums">
											{formatDateTime(run.createdAt)}
										</span>
									</div>
									{run.actionsApplied.length > 0 ? (
										<PlannedOperationList operations={run.actionsApplied} />
									) : null}
								</li>
							))}
						</ul>
					)}
				</div>

				{runs.data && runs.data.total > 0 ? (
					<div className="shrink-0 border-border border-t">
						<Pagination
							page={runs.data.page}
							pageSize={runs.data.pageSize}
							total={runs.data.total}
							totalPages={runs.data.totalPages}
							onPageChange={setPage}
							itemLabel="run"
						/>
					</div>
				) : null}
			</SheetContent>
		</Sheet>
	);
}
