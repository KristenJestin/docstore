import type { TagWithCount } from "@docstore/shared/tag";
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
import { Input } from "@docstore/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	MergeIcon,
	PencilIcon,
	PlusIcon,
	TagIcon,
	Trash2Icon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";
import { SettingsPanel, SettingsStack } from "./settings-panel";
import { ColorPicker } from "./taxonomy-pickers";

/**
 * Tags with their document counts: creation, renaming, colour, deletion and
 * merge into another tag (`tag.merge`).
 */
export function TagManager() {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const tags = useQuery(orpc.tag.list.queryOptions({ input: {} }));

	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [merging, setMerging] = useState<TagWithCount | null>(null);

	const deleteTag = useMutation(orpc.tag.delete.mutationOptions());

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: orpc.tag.key() });
		await queryClient.invalidateQueries({ queryKey: orpc.document.key() });
	};

	const remove = async (item: TagWithCount) => {
		const ok = await confirm({
			title: `Delete the tag "${item.name}"?`,
			description:
				item.documentCount > 0
					? `It will be removed from ${countLabel(item.documentCount, "document")}.`
					: "This tag is not used by any document.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await deleteTag.mutateAsync({ id: item.id });
			await invalidate();
			toast.success("Tag deleted.");
		} catch (error) {
			toastApiError(error, "The tag could not be deleted.");
		}
	};

	if (tags.isLoading) {
		return (
			<SettingsStack>
				<Skeleton className="h-64 w-full" />
			</SettingsStack>
		);
	}

	const items = tags.data ?? [];

	return (
		<SettingsStack>
			<SettingsPanel
				title="Tags"
				description="Free-form labels, independent from the category tree."
				actions={
					<Button
						size="sm"
						onClick={() => {
							setEditingId(null);
							setCreating(true);
						}}
					>
						<PlusIcon />
						New tag
					</Button>
				}
			>
				{creating ? (
					<TagForm
						onCancel={() => setCreating(false)}
						onSaved={async () => {
							setCreating(false);
							await invalidate();
						}}
					/>
				) : null}

				{items.length === 0 && !creating ? (
					<div className="p-3">
						<EmptyState
							icon={TagIcon}
							title="No tag"
							description="Tags are created here or on the fly from a document."
							size="sm"
							action={
								<Button variant="outline" onClick={() => setCreating(true)}>
									<PlusIcon />
									New tag
								</Button>
							}
						/>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{items.map((item) => (
							<li key={item.id}>
								{editingId === item.id ? (
									<TagForm
										initial={item}
										onCancel={() => setEditingId(null)}
										onSaved={async () => {
											setEditingId(null);
											await invalidate();
										}}
									/>
								) : (
									<div className="group/row flex h-14 items-center gap-3 px-4 transition-colors duration-200 ease-premium hover:bg-muted/70">
										<span
											aria-hidden
											className="size-2.5 shrink-0 rounded-full ring-1 ring-border"
											style={{
												backgroundColor:
													item.color ?? "var(--muted-foreground)",
											}}
										/>
										<p className="min-w-0 flex-1 truncate font-medium text-sm">
											{item.name}
										</p>
										<Badge tone="outline" className="shrink-0 tabular-nums">
											{countLabel(item.documentCount, "doc")}
										</Badge>
										<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Rename ${item.name}`}
												onClick={() => {
													setCreating(false);
													setEditingId(item.id);
												}}
											>
												<PencilIcon />
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Merge ${item.name}`}
												onClick={() => setMerging(item)}
											>
												<MergeIcon />
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Delete ${item.name}`}
												onClick={() => void remove(item)}
											>
												<Trash2Icon />
											</Button>
										</div>
									</div>
								)}
							</li>
						))}
					</ul>
				)}
			</SettingsPanel>

			<MergeTagDialog
				source={merging}
				tags={items}
				onClose={() => setMerging(null)}
				onMerged={invalidate}
			/>
		</SettingsStack>
	);
}

/** Inline create / rename row: name and colour. */
function TagForm({
	initial,
	onCancel,
	onSaved,
}: {
	initial?: TagWithCount;
	onCancel: () => void;
	onSaved: () => Promise<void> | void;
}) {
	const [name, setName] = useState(initial?.name ?? "");
	const [color, setColor] = useState<string | null>(initial?.color ?? null);

	const createTag = useMutation(orpc.tag.create.mutationOptions());
	const updateTag = useMutation(orpc.tag.update.mutationOptions());
	const pending = createTag.isPending || updateTag.isPending;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const trimmed = name.trim();
		if (trimmed.length === 0) {
			return;
		}
		try {
			if (initial) {
				await updateTag.mutateAsync({ id: initial.id, name: trimmed, color });
				toast.success("Tag updated.");
			} else {
				await createTag.mutateAsync({ name: trimmed, color });
				toast.success(`Tag "${trimmed}" created.`);
			}
			await onSaved();
		} catch (error) {
			toastApiError(error, "The tag could not be saved.");
		}
	};

	return (
		<form
			onSubmit={submit}
			className="flex flex-wrap items-center gap-2 bg-muted/40 px-4 py-3"
		>
			<Input
				autoFocus
				value={name}
				onChange={(event) => setName(event.target.value)}
				placeholder="Tag name"
				aria-label={initial ? "Tag name" : "New tag name"}
				className="w-56"
			/>
			<ColorPicker value={color} onValueChange={setColor} />
			<div className="ml-auto flex items-center gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="submit"
					size="sm"
					disabled={pending || name.trim().length === 0}
				>
					{initial ? "Save" : "Create"}
				</Button>
			</div>
		</form>
	);
}

function MergeTagDialog({
	source,
	tags,
	onClose,
	onMerged,
}: {
	source: TagWithCount | null;
	tags: TagWithCount[];
	onClose: () => void;
	onMerged: () => Promise<void>;
}) {
	const [targetId, setTargetId] = useState<string>("");
	const mergeTags = useMutation(orpc.tag.merge.mutationOptions());

	const candidates = tags.filter((item) => item.id !== source?.id);

	const submit = async () => {
		if (!source || targetId.length === 0) {
			return;
		}
		try {
			const result = await mergeTags.mutateAsync({
				sourceId: source.id,
				targetId,
			});
			await onMerged();
			toast.success(
				`"${source.name}" merged into "${result.target.name}" (${countLabel(
					result.movedDocuments,
					"document",
				)}).`,
			);
			onClose();
		} catch (error) {
			toastApiError(error, "The tags could not be merged.");
		}
	};

	return (
		<Dialog
			key={source?.id ?? "none"}
			open={source !== null}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Merge {source?.name}</DialogTitle>
					<DialogDescription>
						Its documents move to the tag you pick, then "{source?.name}" is
						deleted.
					</DialogDescription>
				</DialogHeader>

				<Select
					items={Object.fromEntries(
						candidates.map((item) => [item.id, item.name]),
					)}
					value={targetId}
					onValueChange={(value) => setTargetId(value ?? "")}
				>
					<SelectTrigger aria-label="Target tag" className="w-full">
						<SelectValue placeholder="Choose a tag…" />
					</SelectTrigger>
					<SelectContent>
						{candidates.map((item) => (
							<SelectItem key={item.id} value={item.id}>
								{item.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						onClick={submit}
						disabled={targetId.length === 0 || mergeTags.isPending}
					>
						Merge
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
