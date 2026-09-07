import type {
	SavedSearchDto,
	SavedSearchFilters,
} from "@docstore/shared/saved-search";
import { Button } from "@docstore/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@docstore/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@docstore/ui/components/dropdown-menu";
import { Input } from "@docstore/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	BookmarkIcon,
	MoreHorizontalIcon,
	PencilIcon,
	Trash2Icon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import {
	DragHandle,
	SortableList,
	SortableRow,
} from "@/components/dnd/sortable";
import { FormField } from "@/components/form-field";
import { toastApiError } from "@/lib/api-error";
import { fromSavedSearchFilters } from "@/lib/document-search";
import { orpc } from "@/utils/orpc";

/**
 * "Saved searches" block of the sidebar (prototype B): the persisted
 * `/documents` filters, opened in one click, reordered by dragging the grip
 * revealed on hover, renamed or deleted through the row menu.
 */
export function SavedSearchNav({ onNavigate }: { onNavigate?: () => void }) {
	const navigate = useNavigate();
	const confirm = useConfirm();

	const searches = useQuery(orpc.savedSearch.list.queryOptions({ input: {} }));
	const update = useMutation(orpc.savedSearch.update.mutationOptions());
	const remove = useMutation(orpc.savedSearch.delete.mutationOptions());
	const reorder = useMutation(orpc.savedSearch.reorder.mutationOptions());

	const [renaming, setRenaming] = useState<SavedSearchDto | null>(null);

	const items = searches.data ?? [];
	if (items.length === 0) {
		return null;
	}

	const open = (search: SavedSearchDto) => {
		navigate({
			to: "/documents",
			search: fromSavedSearchFilters(search.filters),
		});
		onNavigate?.();
	};

	const onReorder = async (ids: string[]) => {
		try {
			await reorder.mutateAsync({ ids });
		} catch (error) {
			toastApiError(error, "The saved searches could not be reordered.");
		}
	};

	const onDelete = async (search: SavedSearchDto) => {
		const ok = await confirm({
			title: `Delete "${search.name}"?`,
			description: "The documents themselves are left untouched.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: search.id });
			toast.success("Saved search deleted.");
		} catch (error) {
			toastApiError(error, "The saved search could not be deleted.");
		}
	};

	return (
		<div className="flex flex-col gap-0.5">
			<p className="mono-label px-3 pt-5 pb-1.5 tracking-widest">
				Saved searches
			</p>
			<SortableList
				ids={items.map((search) => search.id)}
				onReorder={(ids) => void onReorder(ids)}
				label="Reorder the saved searches"
				disabled={reorder.isPending}
			>
				{items.map((search) => (
					<SortableRow key={search.id} id={search.id} as="div">
						{({ handleProps }) => (
							<div className="group/saved flex w-full items-center gap-1 rounded-lg pr-1 text-muted-foreground transition-colors duration-200 ease-premium hover:bg-muted hover:text-foreground">
								<button
									type="button"
									onClick={() => open(search)}
									className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-left font-medium text-sm"
								>
									<BookmarkIcon
										className="size-4 shrink-0"
										strokeWidth={1.75}
									/>
									<span className="min-w-0 flex-1 truncate">{search.name}</span>
								</button>
								<DragHandle
									handleProps={handleProps}
									label={`Reorder ${search.name}`}
									disabled={reorder.isPending}
									className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/saved:opacity-100"
								/>
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Actions for ${search.name}`}
												className="opacity-0 transition-opacity group-hover/saved:opacity-100"
											/>
										}
									>
										<MoreHorizontalIcon />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onClick={() => setRenaming(search)}>
											<PencilIcon />
											Rename
										</DropdownMenuItem>
										<DropdownMenuItem
											variant="destructive"
											onClick={() => onDelete(search)}
										>
											<Trash2Icon />
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						)}
					</SortableRow>
				))}
			</SortableList>

			<RenameSavedSearchDialog
				search={renaming}
				onOpenChange={(next) => {
					if (!next) {
						setRenaming(null);
					}
				}}
				onRename={async (name) => {
					if (!renaming) {
						return;
					}
					try {
						await update.mutateAsync({ id: renaming.id, name });
						toast.success("Saved search renamed.");
						setRenaming(null);
					} catch (error) {
						toastApiError(error, "The saved search could not be renamed.");
					}
				}}
			/>
		</div>
	);
}

function RenameSavedSearchDialog({
	search,
	onOpenChange,
	onRename,
}: {
	search: SavedSearchDto | null;
	onOpenChange: (open: boolean) => void;
	onRename: (name: string) => Promise<void>;
}) {
	const ids = useId();
	const [name, setName] = useState("");

	useEffect(() => {
		setName(search?.name ?? "");
	}, [search]);

	return (
		<Dialog open={search !== null} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rename saved search</DialogTitle>
					<DialogDescription>
						Only the name changes; the filters stay as they were saved.
					</DialogDescription>
				</DialogHeader>
				<FormField label="Name" htmlFor={`${ids}-name`} required>
					<Input
						id={`${ids}-name`}
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</FormField>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={name.trim().length === 0}
						onClick={() => onRename(name.trim())}
					>
						Rename
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export interface SaveSearchDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Filters currently applied on `/documents`. */
	filters: SavedSearchFilters;
}

/** "Save search" dialog of `/documents`: a name, then `savedSearch.create`. */
export function SaveSearchDialog({
	open,
	onOpenChange,
	filters,
}: SaveSearchDialogProps) {
	const ids = useId();
	const [name, setName] = useState("");

	useEffect(() => {
		if (open) {
			setName("");
		}
	}, [open]);

	const create = useMutation(orpc.savedSearch.create.mutationOptions());

	const submit = async () => {
		const trimmed = name.trim();
		if (trimmed.length === 0) {
			return;
		}
		try {
			await create.mutateAsync({ name: trimmed, filters });
			toast.success(`Search "${trimmed}" saved.`);
			onOpenChange(false);
		} catch (error) {
			toastApiError(error, "The search could not be saved.");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Save search</DialogTitle>
					<DialogDescription>
						The current filters are stored under this name and appear in the
						sidebar.
					</DialogDescription>
				</DialogHeader>
				<FormField label="Name" htmlFor={`${ids}-name`} required>
					<Input
						id={`${ids}-name`}
						value={name}
						placeholder="Unpaid invoices"
						onChange={(event) => setName(event.target.value)}
					/>
				</FormField>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={name.trim().length === 0 || create.isPending}
						onClick={submit}
					>
						{create.isPending ? "Saving…" : "Save search"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
