import type { Rule } from "@docstore/shared/rule";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@docstore/ui/components/dropdown-menu";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { Switch } from "@docstore/ui/components/switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontalIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import {
	DragHandle,
	SortableList,
	SortableRow,
} from "@/components/dnd/sortable";
import { EmptyState } from "@/components/empty-state";
import { MonoLabel } from "@/components/mono-label";
import { formatDateTime } from "@/components/settings/settings-labels";
import { useForceRetry } from "@/hooks/use-force-retry";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import { RULE_TRIGGER_LABELS, RULE_TRIGGER_SHORT } from "./rule-labels";

/** Rows drawn while `rule.list` is loading. */
const SKELETON_ROWS = 6;

/**
 * Rules in priority order (SPEC §3): drag and drop reorder (`rule.reorder`,
 * keyboard included through the grip), enable, and the row menu that edits,
 * duplicates, runs or deletes a rule.
 *
 * The list is drawn here rather than through `DataList`, which owns its row
 * element and so cannot hand it over to `SortableRow`; the frame, the row
 * height and the twelve-column grid are the same.
 */
export function RuleList() {
	const navigate = useNavigate();
	const confirm = useConfirm();

	const rules = useQuery(orpc.rule.list.queryOptions({ input: {} }));
	const reorder = useMutation(orpc.rule.reorder.mutationOptions());
	const toggle = useMutation(orpc.rule.toggle.mutationOptions());
	const create = useMutation(orpc.rule.create.mutationOptions());
	const remove = useMutation(orpc.rule.delete.mutationOptions());
	const run = useMutation(orpc.rule.run.mutationOptions());
	const forceRetry = useForceRetry();

	const items = rules.data ?? [];

	const onReorder = async (ids: string[]) => {
		try {
			await reorder.mutateAsync({ ids });
		} catch (error) {
			toastApiError(error, "The automations could not be reordered.");
		}
	};

	const onToggle = async (rule: Rule, enabled: boolean) => {
		try {
			await toggle.mutateAsync({ id: rule.id, enabled });
		} catch (error) {
			toastApiError(error, "The automation could not be switched.");
		}
	};

	const onDuplicate = async (rule: Rule) => {
		try {
			const created = await create.mutateAsync({
				name: `${rule.name} (copy)`,
				description: rule.description,
				enabled: false,
				triggers: rule.triggers,
				condition: rule.condition,
				actions: rule.actions,
				stopOnMatch: rule.stopOnMatch,
			});
			toast.success(`Automation "${created.name}" created.`);
		} catch (error) {
			toastApiError(error, "The automation could not be duplicated.");
		}
	};

	const onDelete = async (rule: Rule) => {
		const ok = await confirm({
			title: `Delete the automation "${rule.name}"?`,
			description: "Its run history is deleted with it.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: rule.id });
			toast.success("Automation deleted.");
		} catch (error) {
			toastApiError(error, "The automation could not be deleted.");
		}
	};

	const onRun = async (rule: Rule) => {
		const ok = await confirm({
			title: `Run "${rule.name}" on every document?`,
			description:
				"Up to 500 documents are processed. Matching documents are updated for real.",
			confirmLabel: "Run now",
		});
		if (!ok) {
			return;
		}
		try {
			// A disabled automation is refused unless the caller insists.
			const outcome = await forceRetry("automation", (force) =>
				run.mutateAsync({ ruleId: rule.id, all: true, force }),
			);
			if (outcome === null) {
				return;
			}
			toast.success(
				`${outcome.matched} matched of ${outcome.processed} processed.`,
			);
		} catch (error) {
			toastApiError(error, "The automation could not be run.");
		}
	};

	return (
		<div className="shell mx-6 my-6 lg:mx-8">
			<div className="overflow-hidden rounded-xl bg-card shadow-soft ring-1 ring-border">
				<div className="flex items-center gap-3 border-border border-b bg-muted/40 px-4 py-2">
					<span className="w-7 shrink-0" />
					<div className="grid min-w-0 flex-1 grid-cols-12 items-center gap-4">
						<MonoLabel className="col-span-1">#</MonoLabel>
						<MonoLabel className="col-span-4">Automation</MonoLabel>
						<MonoLabel className="col-span-2 hidden lg:block">
							Triggers
						</MonoLabel>
						<MonoLabel className="col-span-2">Matches</MonoLabel>
						<MonoLabel className="col-span-1">Enabled</MonoLabel>
						<MonoLabel className="col-span-2 flex justify-end text-right">
							Actions
						</MonoLabel>
					</div>
				</div>

				{rules.isLoading ? (
					<div className="divide-y divide-border">
						{Array.from({ length: SKELETON_ROWS }, (_, index) => index).map(
							(index) => (
								<div key={index} className="flex h-14 items-center gap-3 px-4">
									<span className="w-7 shrink-0" />
									<Skeleton className="h-4 w-full max-w-md" />
								</div>
							),
						)}
					</div>
				) : items.length === 0 ? (
					<div className="p-3">
						<EmptyState
							icon={WorkflowIcon}
							title="No automation yet"
							description="An automation watches every incoming document: add tags, link a party, flag it as sensitive, call a webhook."
							action={
								<Link to="/settings/automations/new">
									<Button>
										<PlusIcon />
										Create your first automation
									</Button>
								</Link>
							}
						/>
					</div>
				) : (
					<SortableList
						ids={items.map((rule) => rule.id)}
						onReorder={(ids) => void onReorder(ids)}
						label="Reorder the automations by priority"
						disabled={reorder.isPending}
					>
						<ul className="divide-y divide-border">
							{items.map((rule) => (
								<SortableRow key={rule.id} id={rule.id}>
									{({ handleProps }) => (
										<div className="group/row flex items-center gap-3 px-4 transition-colors duration-200 ease-premium hover:bg-muted/70">
											<DragHandle
												handleProps={handleProps}
												label={`Reorder ${rule.name}`}
												disabled={reorder.isPending}
											/>
											<div className="grid h-14 min-w-0 flex-1 grid-cols-12 items-center gap-4">
												<span className="col-span-1 min-w-0 font-mono text-muted-foreground text-xs tabular-nums">
													{rule.priority}
												</span>

												<div className="col-span-4 min-w-0">
													<Link
														to="/settings/automations/$ruleId"
														params={{ ruleId: rule.id }}
														className="block min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
													>
														<span className="block truncate font-semibold text-sm">
															{rule.name}
														</span>
														<span className="block truncate text-muted-foreground text-xs">
															{rule.description ?? "No description"}
														</span>
													</Link>
												</div>

												<div className="col-span-2 hidden min-w-0 items-center gap-1 overflow-hidden lg:flex">
													{rule.triggers.map((trigger) => (
														<Badge
															key={trigger}
															tone="outline"
															title={RULE_TRIGGER_LABELS[trigger]}
														>
															{RULE_TRIGGER_SHORT[trigger]}
														</Badge>
													))}
												</div>

												<div className="col-span-2 min-w-0">
													<p className="font-mono text-sm tabular-nums">
														{rule.matchCount}
													</p>
													<p className="truncate font-mono text-muted-foreground text-xs">
														{rule.lastMatchedAt
															? formatDateTime(rule.lastMatchedAt)
															: "—"}
													</p>
												</div>

												<div className="col-span-1 min-w-0">
													<Switch
														aria-label={`Enable ${rule.name}`}
														checked={rule.enabled}
														onCheckedChange={(enabled) =>
															onToggle(rule, enabled)
														}
													/>
												</div>

												<div className="col-span-2 flex min-w-0 justify-end">
													<DropdownMenu>
														<DropdownMenuTrigger
															render={
																<Button
																	variant="ghost"
																	size="icon-sm"
																	aria-label={`Actions for ${rule.name}`}
																/>
															}
														>
															<MoreHorizontalIcon />
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem
																onClick={() =>
																	navigate({
																		to: "/settings/automations/$ruleId",
																		params: { ruleId: rule.id },
																	})
																}
															>
																Edit
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() => onDuplicate(rule)}
															>
																Duplicate
															</DropdownMenuItem>
															<DropdownMenuItem onClick={() => onRun(rule)}>
																Run on…
															</DropdownMenuItem>
															<DropdownMenuSeparator />
															<DropdownMenuItem
																variant="destructive"
																onClick={() => onDelete(rule)}
															>
																Delete
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												</div>
											</div>
										</div>
									)}
								</SortableRow>
							))}
						</ul>
					</SortableList>
				)}
			</div>
		</div>
	);
}
