import type { DossierWithCount } from "@docstore/shared/dossier";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@docstore/ui/components/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@docstore/ui/components/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	FolderIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { DataList } from "@/components/data-list";
import { DateText } from "@/components/date-text";
import { DossierFormSheet } from "@/components/dossiers/dossier-form-sheet";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SearchInput } from "@/components/search-input";
import { toastApiError } from "@/lib/api-error";
import { PAGE_ACTIONS, usePageAction } from "@/lib/page-actions";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_app/dossiers/")({
	component: DossiersPage,
});

function DossiersPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const confirm = useConfirm();

	const [tab, setTab] = useState<"open" | "closed">("open");
	const [query, setQuery] = useState("");
	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<DossierWithCount | null>(null);

	// One request for both tabs: the counters must stay in sync.
	const dossiers = useQuery(
		orpc.dossier.list.queryOptions({
			input: {
				includeClosed: true,
				query: query.trim().length > 0 ? query.trim() : undefined,
			},
		}),
	);

	const close = useMutation(orpc.dossier.close.mutationOptions());
	const reopen = useMutation(orpc.dossier.reopen.mutationOptions());
	const remove = useMutation(orpc.dossier.delete.mutationOptions());

	usePageAction(
		PAGE_ACTIONS.create,
		useCallback(() => setFormOpen(true), []),
	);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.dossier.key() });

	const all = dossiers.data ?? [];
	const openItems = all.filter((item) => item.status === "open");
	const closedItems = all.filter((item) => item.status === "closed");
	const items = tab === "open" ? openItems : closedItems;

	const onClose = async (dossier: DossierWithCount) => {
		try {
			await close.mutateAsync({ id: dossier.id });
			await invalidate();
			toast.success("Dossier closed.");
		} catch (error) {
			toastApiError(error, "The dossier could not be closed.");
		}
	};

	const onReopen = async (dossier: DossierWithCount) => {
		try {
			await reopen.mutateAsync({ id: dossier.id });
			await invalidate();
			toast.success("Dossier reopened.");
		} catch (error) {
			toastApiError(error, "The dossier could not be reopened.");
		}
	};

	const onDelete = async (dossier: DossierWithCount) => {
		const ok = await confirm({
			title: `Delete "${dossier.name}"?`,
			description: "The documents themselves are left untouched.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: dossier.id });
			await invalidate();
			toast.success("Dossier deleted.");
		} catch (error) {
			toastApiError(error, "The dossier could not be deleted.");
		}
	};

	return (
		<>
			<PageHeader
				kicker="Cross-cutting collections"
				title="Dossiers"
				description="Groups of documents that share a life cycle: a move, a claim, a tax year."
				actions={
					<Button onClick={() => setFormOpen(true)}>
						<PlusIcon />
						New dossier
					</Button>
				}
			>
				<div className="mt-6 flex flex-wrap items-center gap-3">
					<Tabs
						value={tab}
						onValueChange={(value) => setTab(value as "open" | "closed")}
					>
						<TabsList>
							<TabsTrigger value="open">
								Open
								<Badge tone="outline">{openItems.length}</Badge>
							</TabsTrigger>
							<TabsTrigger value="closed">
								Closed
								<Badge tone="outline">{closedItems.length}</Badge>
							</TabsTrigger>
						</TabsList>
					</Tabs>
					<SearchInput
						className="w-full max-w-md"
						value={query}
						onValueChange={setQuery}
						placeholder="Search a dossier…"
						label="Search a dossier"
					/>
				</div>
			</PageHeader>

			<DataList<DossierWithCount>
				items={items}
				isLoading={dossiers.isLoading}
				getKey={(item) => item.id}
				columns={[
					{
						id: "name",
						header: "Dossier",
						span: 6,
						cell: (item) => (
							<div className="min-w-0">
								<Link
									to="/dossiers/$dossierId"
									params={{ dossierId: item.id }}
									className="block truncate font-semibold text-sm hover:underline"
								>
									{item.name}
								</Link>
								{item.description ? (
									<span className="block truncate text-muted-foreground text-xs">
										{item.description}
									</span>
								) : null}
							</div>
						),
					},
					{
						id: "documents",
						header: "Documents",
						span: 2,
						cell: (item) => (
							<span className="font-mono text-sm tabular-nums">
								{item.documentCount}
							</span>
						),
					},
					{
						id: "updated",
						header: "Updated",
						span: 2,
						hideBelowLg: true,
						cell: (item) => <DateText value={item.updatedAt} />,
					},
					{
						id: "actions",
						header: "",
						span: 2,
						align: "end",
						cell: (item) => (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Actions for ${item.name}`}
										/>
									}
								>
									<MoreHorizontalIcon />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => setEditing(item)}>
										<PencilIcon />
										Edit
									</DropdownMenuItem>
									{item.status === "open" ? (
										<DropdownMenuItem onClick={() => onClose(item)}>
											<FolderIcon />
											Close
										</DropdownMenuItem>
									) : (
										<DropdownMenuItem onClick={() => onReopen(item)}>
											<FolderIcon />
											Reopen
										</DropdownMenuItem>
									)}
									<DropdownMenuItem
										variant="destructive"
										onClick={() => onDelete(item)}
									>
										<Trash2Icon />
										Delete
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						),
					},
				]}
				empty={
					<EmptyState
						icon={FolderIcon}
						title={tab === "open" ? "No open dossier" : "No closed dossier"}
						description="A dossier gathers documents that share a life cycle, without touching their filing."
						action={
							<Button variant="outline" onClick={() => setFormOpen(true)}>
								<PlusIcon />
								New dossier
							</Button>
						}
					/>
				}
			/>

			<DossierFormSheet
				open={formOpen}
				onOpenChange={setFormOpen}
				onSaved={(dossier) =>
					navigate({
						to: "/dossiers/$dossierId",
						params: { dossierId: dossier.id },
					})
				}
			/>
			<DossierFormSheet
				open={editing !== null}
				onOpenChange={(next) => {
					if (!next) {
						setEditing(null);
					}
				}}
				dossier={editing ?? undefined}
			/>
		</>
	);
}
