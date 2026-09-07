import type { IntakeSource } from "@docstore/shared/intake";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@docstore/ui/components/dialog";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { Switch } from "@docstore/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@docstore/ui/components/tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	InboxIcon,
	PencilIcon,
	PlayIcon,
	PlugZapIcon,
	PlusIcon,
	ScrollTextIcon,
	ServerCogIcon,
	Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { MonoLabel } from "@/components/mono-label";
import { Pagination } from "@/components/pagination";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

import { CopyButton } from "./copy-button";
import { IntakeSourceSheet } from "./intake-source-sheet";
import {
	formatDateTime,
	INTAKE_OUTCOME_LABELS,
	INTAKE_OUTCOME_TONES,
	INTAKE_SOURCE_TYPE_LABELS,
} from "./settings-labels";
import { SettingsPanel, SettingsStack } from "./settings-panel";

/** Page size of the intake journal dialog. */
const LOG_PAGE_SIZE = 25;

/** Tooltip of the "Server config" badge, word for word. */
const MANAGED_TOOLTIP = "Defined in docstore.config.json";

/**
 * Intake channels (SPEC §5): watched folders and mailboxes, with their state,
 * their counters, a manual run and the journal of what they saw.
 *
 * A source declared in `docstore.config.json` (`managed`) belongs to the
 * server: it carries a "Server config" badge and its editing, deletion and
 * enable switch are disabled, the way the API refuses them. Running it,
 * testing it and reading its journal stay available.
 */
export function IntakeSourceList() {
	const confirm = useConfirm();
	const sources = useQuery(orpc.intakeSource.list.queryOptions({ input: {} }));
	const serverInfo = useQuery(
		orpc.settings.serverInfo.queryOptions({ input: {} }),
	);

	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<IntakeSource | null>(null);
	const [logsFor, setLogsFor] = useState<IntakeSource | null>(null);

	const toggle = useMutation(orpc.intakeSource.toggle.mutationOptions());
	const runNow = useMutation(orpc.intakeSource.runNow.mutationOptions());
	const test = useMutation(orpc.intakeSource.test.mutationOptions());
	const remove = useMutation(orpc.intakeSource.delete.mutationOptions());

	const onToggle = async (source: IntakeSource, enabled: boolean) => {
		try {
			await toggle.mutateAsync({ id: source.id, enabled });
			toast.success(enabled ? "Source enabled." : "Source disabled.");
		} catch (error) {
			toastApiError(error, "The source could not be switched.");
		}
	};

	const onRun = async (source: IntakeSource) => {
		try {
			const result = await runNow.mutateAsync({ id: source.id });
			toast.success(
				result.queued
					? "Run queued."
					: "The ingestion queue is not available right now.",
			);
		} catch (error) {
			toastApiError(error, "The run could not be started.");
		}
	};

	const onTest = async (source: IntakeSource) => {
		try {
			const result = await test.mutateAsync({ id: source.id });
			if (result.ok) {
				toast.success(result.message, {
					description: `${countLabel(result.candidates, "item")} ready to import.`,
				});
			} else {
				toast.error("Connection test failed.", {
					description: result.message,
				});
			}
		} catch (error) {
			toastApiError(error, "The connection could not be tested.");
		}
	};

	const onDelete = async (source: IntakeSource) => {
		const ok = await confirm({
			title: `Delete "${source.name}"?`,
			description: "The channel and its journal are removed. Documents stay.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: source.id });
			toast.success("Intake source deleted.");
		} catch (error) {
			toastApiError(error, "The source could not be deleted.");
		}
	};

	if (sources.isLoading) {
		return (
			<SettingsStack>
				<Skeleton className="h-64 w-full" />
			</SettingsStack>
		);
	}

	const items = sources.data ?? [];

	return (
		<SettingsStack>
			<SettingsPanel
				title="Intake sources"
				description="Where documents arrive from on their own: a folder on the server or an IMAP mailbox."
				actions={
					<Button size="sm" onClick={() => setCreating(true)}>
						<PlusIcon />
						New source
					</Button>
				}
			>
				{serverInfo.data ? (
					<div className="flex flex-wrap items-center gap-2 border-border border-b bg-muted/30 px-4 py-2">
						<ServerCogIcon
							className="size-4 shrink-0 text-muted-foreground"
							strokeWidth={1.75}
						/>
						<code className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
							{serverInfo.data.configPath}
						</code>
						<Badge tone="outline" className="tabular-nums">
							{countLabel(
								serverInfo.data.managedIntakeSources,
								"managed source",
							)}
						</Badge>
						<CopyButton
							value={serverInfo.data.configPath}
							label="Copy the configuration file path"
						/>
					</div>
				) : null}

				{items.length === 0 ? (
					<div className="p-3">
						<EmptyState
							icon={InboxIcon}
							title="No intake source"
							description="Add a watched folder or a mailbox to import documents automatically."
							size="sm"
							action={
								<Button variant="outline" onClick={() => setCreating(true)}>
									<PlusIcon />
									New source
								</Button>
							}
						/>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{items.map((source) => (
							<li
								key={source.id}
								className="group/row flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-200 ease-premium hover:bg-muted/70"
							>
								<Switch
									checked={source.enabled}
									disabled={source.managed}
									aria-label={`Enable ${source.name}`}
									onCheckedChange={(enabled) => void onToggle(source, enabled)}
								/>

								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-sm">{source.name}</p>
									<p className="truncate font-mono text-muted-foreground text-xs">
										{source.config.type === "folder"
											? source.config.path
											: `${source.config.username}@${source.config.host}`}
									</p>
								</div>

								{source.managed ? (
									<Tooltip>
										<TooltipTrigger className="cursor-default rounded-full focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">
											<Badge tone="info">
												<ServerCogIcon />
												Server config
											</Badge>
										</TooltipTrigger>
										<TooltipContent>{MANAGED_TOOLTIP}</TooltipContent>
									</Tooltip>
								) : null}

								<Badge tone="neutral">
									{INTAKE_SOURCE_TYPE_LABELS[source.type]}
								</Badge>

								<div className="w-56 shrink-0 text-right">
									<p className="font-mono text-muted-foreground text-xs tabular-nums">
										{source.lastRunAt
											? `run ${formatDateTime(source.lastRunAt)}`
											: "never run"}
									</p>
									<p className="font-mono text-muted-foreground text-xs tabular-nums">
										{source.stats.imported} imported · {source.stats.duplicates}{" "}
										dup · {source.stats.errors} err
									</p>
								</div>

								{source.lastError ? (
									<Badge tone="danger" className="max-w-56 truncate">
										{source.lastError}
									</Badge>
								) : null}

								<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Run ${source.name} now`}
										disabled={runNow.isPending}
										onClick={() => void onRun(source)}
									>
										<PlayIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Test the connection of ${source.name}`}
										disabled={test.isPending}
										onClick={() => void onTest(source)}
									>
										<PlugZapIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Logs of ${source.name}`}
										onClick={() => setLogsFor(source)}
									>
										<ScrollTextIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Edit ${source.name}`}
										disabled={source.managed}
										onClick={() => setEditing(source)}
									>
										<PencilIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Delete ${source.name}`}
										disabled={source.managed}
										onClick={() => void onDelete(source)}
									>
										<Trash2Icon />
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</SettingsPanel>

			<IntakeSourceSheet
				open={creating || editing !== null}
				source={editing ?? undefined}
				onOpenChange={(open) => {
					if (!open) {
						setCreating(false);
						setEditing(null);
					}
				}}
			/>

			<IntakeLogsDialog source={logsFor} onClose={() => setLogsFor(null)} />
		</SettingsStack>
	);
}

/** Paginated journal of a channel (30 days of retention). */
function IntakeLogsDialog({
	source,
	onClose,
}: {
	source: IntakeSource | null;
	onClose: () => void;
}) {
	const [page, setPage] = useState(1);

	const logs = useQuery({
		...orpc.intakeSource.logs.queryOptions({
			input: { id: source?.id ?? "", page, pageSize: LOG_PAGE_SIZE },
		}),
		enabled: source !== null,
	});

	return (
		<Dialog
			key={source?.id ?? "none"}
			open={source !== null}
			onOpenChange={(open) => {
				if (!open) {
					setPage(1);
					onClose();
				}
			}}
		>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Journal of {source?.name}</DialogTitle>
					<DialogDescription>
						Every file the channel saw, kept for 30 days.
					</DialogDescription>
				</DialogHeader>

				{logs.isLoading ? (
					<Skeleton className="h-64 w-full" />
				) : (logs.data?.items.length ?? 0) === 0 ? (
					<EmptyState
						icon={ScrollTextIcon}
						title="Nothing yet"
						description="This channel has not seen a single file."
						size="sm"
					/>
				) : (
					<ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg ring-1 ring-border">
						{logs.data?.items.map((log) => (
							<li key={log.id} className="flex items-center gap-3 px-3 py-2">
								<Badge tone={INTAKE_OUTCOME_TONES[log.outcome]}>
									{INTAKE_OUTCOME_LABELS[log.outcome]}
								</Badge>
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-sm">{log.filename}</p>
									{log.message ? (
										<p className="truncate text-muted-foreground text-xs">
											{log.message}
										</p>
									) : null}
								</div>
								<span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
									{formatDateTime(log.createdAt)}
								</span>
							</li>
						))}
					</ul>
				)}

				{logs.data && logs.data.total > 0 ? (
					<Pagination
						page={logs.data.page}
						pageSize={logs.data.pageSize}
						total={logs.data.total}
						totalPages={logs.data.totalPages}
						onPageChange={setPage}
						itemLabel="entry"
						itemLabelPlural="entries"
						className="rounded-lg ring-1 ring-border"
					/>
				) : null}

				<DialogFooter>
					<MonoLabel className="mr-auto self-center">
						{logs.data?.total ?? 0} entries
					</MonoLabel>
					<Button variant="outline" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
