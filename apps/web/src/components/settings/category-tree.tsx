import type { CategoryNode } from "@docstore/shared/category";
import { CATEGORY_MAX_DEPTH } from "@docstore/shared/category";
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
import { cn } from "@docstore/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	FolderInputIcon,
	FolderTreeIcon,
	PencilIcon,
	PlusIcon,
	SlidersHorizontalIcon,
	Trash2Icon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
	DragHandle,
	SortableList,
	SortableRow,
} from "@/components/dnd/sortable";
import { EmptyState } from "@/components/empty-state";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";
import { SettingsPanel, SettingsStack } from "./settings-panel";
import { ColorPicker, IconPicker, TaxonomyIcon } from "./taxonomy-pickers";

/** Left padding of a row, one entry per tree level (root = 1). */
const DEPTH_CLASSES = ["pl-4", "pl-10", "pl-16"] as const;

/** Value of the "no parent" entry of the move and reassign selects. */
const ROOT_VALUE = "__root__";

/** Value of the "leave the documents without a category" entry. */
const NONE_VALUE = "__none__";

interface FlatCategory {
	node: CategoryNode;
	/** Full path, e.g. "Invoice › Subscription". */
	path: string;
}

function flatten(
	nodes: CategoryNode[],
	parentPath = "",
	out: FlatCategory[] = [],
): FlatCategory[] {
	for (const node of nodes) {
		const path = parentPath ? `${parentPath} › ${node.name}` : node.name;
		out.push({ node, path });
		flatten(node.children, path, out);
	}
	return out;
}

/** Counts a list of `categoryIds` owners per category. */
function countByCategory(
	owners: { categoryIds: string[] }[] | undefined,
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const owner of owners ?? []) {
		for (const id of owner.categoryIds) {
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
	}
	return counts;
}

/** Draft of an inline creation: the parent it will be attached to. */
type CreateDraft = { parentId: string | null };

/** Everything a branch needs, gathered once instead of drilled level by level. */
interface TreeView {
	fieldCounts: Map<string, number>;
	draft: CreateDraft | null;
	editingId: string | null;
	reordering: boolean;
	onReorder: (parentId: string | null, ids: string[]) => void;
	onAddChild: (node: CategoryNode) => void;
	onEdit: (node: CategoryNode) => void;
	onMove: (node: CategoryNode) => void;
	onDelete: (node: CategoryNode) => void;
	onCancelDraft: () => void;
	onSavedDraft: () => Promise<void>;
	onCancelEdit: () => void;
	onSavedEdit: () => Promise<void>;
}

/**
 * Category tree (three levels, SPEC §2): inline creation and editing, drag and
 * drop reorder **inside one sibling group** (`category.reorder`, one
 * `SortableList` per level so a row can only land among its own siblings),
 * "Move to another parent" through the dialog (`category.move`), and deletion
 * with reassignment of the documents.
 */
export function CategoryTree() {
	const queryClient = useQueryClient();
	const categories = useQuery(orpc.category.list.queryOptions({ input: {} }));
	const customFields = useQuery(
		orpc.customField.list.queryOptions({ input: {} }),
	);
	const [draft, setDraft] = useState<CreateDraft | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [moving, setMoving] = useState<CategoryNode | null>(null);
	const [deleting, setDeleting] = useState<CategoryNode | null>(null);

	const reorderCategories = useMutation(
		orpc.category.reorder.mutationOptions(),
	);

	const tree = categories.data ?? [];
	const flat = flatten(tree);

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: orpc.category.key() });
	};

	/**
	 * Reorder: `category.reorder` renumbers one sibling group in a single call,
	 * so the dropped order is written as is.
	 */
	const onReorder = async (parentId: string | null, ids: string[]) => {
		try {
			await reorderCategories.mutateAsync({ parentId, ids });
			await invalidate();
		} catch (error) {
			toastApiError(error, "The categories could not be reordered.");
		}
	};

	if (categories.isLoading) {
		return (
			<SettingsStack>
				<Skeleton className="h-64 w-full" />
			</SettingsStack>
		);
	}

	const view: TreeView = {
		fieldCounts: countByCategory(customFields.data),
		draft,
		editingId,
		reordering: reorderCategories.isPending,
		onReorder: (parentId, ids) => void onReorder(parentId, ids),
		onAddChild: (node) => {
			setEditingId(null);
			setDraft({ parentId: node.id });
		},
		onEdit: (node) => {
			setDraft(null);
			setEditingId(node.id);
		},
		onMove: setMoving,
		onDelete: setDeleting,
		onCancelDraft: () => setDraft(null),
		onSavedDraft: async () => {
			setDraft(null);
			await invalidate();
		},
		onCancelEdit: () => setEditingId(null),
		onSavedEdit: async () => {
			setEditingId(null);
			await invalidate();
		},
	};

	return (
		<SettingsStack>
			<SettingsPanel
				title="Categories"
				description={`Filing tree, ${CATEGORY_MAX_DEPTH} levels at most. Drag a row to reorder it among its siblings; deleting a category moves its subcategories up one level.`}
				actions={
					<Button
						size="sm"
						onClick={() => {
							setEditingId(null);
							setDraft({ parentId: null });
						}}
					>
						<PlusIcon />
						New category
					</Button>
				}
			>
				{tree.length === 0 && !draft ? (
					<div className="p-3">
						<EmptyState
							icon={FolderTreeIcon}
							title="No category"
							description="Create a first category to file your documents."
							size="sm"
							action={
								<Button
									variant="outline"
									onClick={() => setDraft({ parentId: null })}
								>
									<PlusIcon />
									New category
								</Button>
							}
						/>
					</div>
				) : (
					<>
						<CategoryBranch
							nodes={tree}
							parentId={null}
							depth={1}
							view={view}
						/>

						{draft && draft.parentId === null ? (
							<div className="border-border border-t">
								<CategoryForm
									depth={1}
									parentId={null}
									onCancel={view.onCancelDraft}
									onSaved={view.onSavedDraft}
								/>
							</div>
						) : null}
					</>
				)}
			</SettingsPanel>

			<MoveCategoryDialog
				node={moving}
				options={flat}
				onClose={() => setMoving(null)}
				onMoved={invalidate}
			/>
			<DeleteCategoryDialog
				node={deleting}
				options={flat}
				onClose={() => setDeleting(null)}
				onDeleted={invalidate}
			/>
		</SettingsStack>
	);
}

/**
 * One sibling group. Each level owns its own `SortableList`, which is what
 * keeps a dragged row inside its own group: changing the parent stays the job
 * of the "Move to another parent" dialog.
 */
function CategoryBranch({
	nodes,
	parentId,
	depth,
	view,
}: {
	nodes: CategoryNode[];
	parentId: string | null;
	depth: number;
	view: TreeView;
}) {
	if (nodes.length === 0) {
		return null;
	}

	return (
		<SortableList
			ids={nodes.map((node) => node.id)}
			onReorder={(ids) => view.onReorder(parentId, ids)}
			label="Reorder the categories of this level"
			disabled={view.reordering}
		>
			<ul
				className={cn(
					"divide-y divide-border",
					depth > 1 && "border-border border-t",
				)}
			>
				{nodes.map((node) => (
					<SortableRow key={node.id} id={node.id}>
						{({ handleProps }) => (
							<>
								{view.editingId === node.id ? (
									<CategoryForm
										depth={depth}
										initial={node}
										onCancel={view.onCancelEdit}
										onSaved={view.onSavedEdit}
									/>
								) : (
									<CategoryRow
										node={node}
										depth={depth}
										handleProps={handleProps}
										view={view}
									/>
								)}

								<CategoryBranch
									nodes={node.children}
									parentId={node.id}
									depth={depth + 1}
									view={view}
								/>

								{view.draft?.parentId === node.id ? (
									<div className="border-border border-t">
										<CategoryForm
											depth={Math.min(depth + 1, CATEGORY_MAX_DEPTH)}
											parentId={node.id}
											onCancel={view.onCancelDraft}
											onSaved={view.onSavedDraft}
										/>
									</div>
								) : null}
							</>
						)}
					</SortableRow>
				))}
			</ul>
		</SortableList>
	);
}

function CategoryRow({
	node,
	depth,
	handleProps,
	view,
}: {
	node: CategoryNode;
	depth: number;
	handleProps: Record<string, unknown>;
	view: TreeView;
}) {
	const fieldCount = view.fieldCounts.get(node.id) ?? 0;

	return (
		<div
			className={cn(
				"group/row flex h-14 items-center gap-3 pr-4 transition-colors duration-200 ease-premium hover:bg-muted/70",
				DEPTH_CLASSES[depth - 1],
			)}
		>
			<DragHandle
				handleProps={handleProps}
				label={`Reorder ${node.name}`}
				disabled={view.reordering}
			/>

			<span
				className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted ring-1 ring-border"
				style={node.color ? { color: node.color } : undefined}
			>
				<TaxonomyIcon name={node.icon} />
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">{node.name}</p>
				<p className="truncate font-mono text-muted-foreground text-xs">
					{node.slug}
				</p>
			</div>

			{fieldCount > 0 ? (
				<Badge
					tone="neutral"
					className="shrink-0 tabular-nums"
					title={`${countLabel(fieldCount, "custom field")} on this category`}
				>
					<SlidersHorizontalIcon />
					{fieldCount}
				</Badge>
			) : null}
			<Badge tone="outline" className="shrink-0 tabular-nums">
				{countLabel(node.documentCount, "doc")}
			</Badge>

			<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
				{depth < CATEGORY_MAX_DEPTH ? (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Add a subcategory to ${node.name}`}
						onClick={() => view.onAddChild(node)}
					>
						<PlusIcon />
					</Button>
				) : null}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Rename ${node.name}`}
					onClick={() => view.onEdit(node)}
				>
					<PencilIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Move ${node.name} to another parent`}
					onClick={() => view.onMove(node)}
				>
					<FolderInputIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Delete ${node.name}`}
					onClick={() => view.onDelete(node)}
				>
					<Trash2Icon />
				</Button>
			</div>
		</div>
	);
}

/** Inline create / edit row: name, icon and colour. */
function CategoryForm({
	depth,
	parentId,
	initial,
	onCancel,
	onSaved,
}: {
	depth: number;
	parentId?: string | null;
	initial?: CategoryNode;
	onCancel: () => void;
	onSaved: () => Promise<void> | void;
}) {
	const [name, setName] = useState(initial?.name ?? "");
	const [icon, setIcon] = useState<string | null>(initial?.icon ?? null);
	const [color, setColor] = useState<string | null>(initial?.color ?? null);

	const createCategory = useMutation(orpc.category.create.mutationOptions());
	const updateCategory = useMutation(orpc.category.update.mutationOptions());
	const pending = createCategory.isPending || updateCategory.isPending;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const trimmed = name.trim();
		if (trimmed.length === 0) {
			return;
		}
		try {
			if (initial) {
				await updateCategory.mutateAsync({
					id: initial.id,
					name: trimmed,
					icon,
					color,
				});
				toast.success("Category updated.");
			} else {
				await createCategory.mutateAsync({
					parentId: parentId ?? null,
					name: trimmed,
					icon,
					color,
				});
				toast.success(`Category "${trimmed}" created.`);
			}
			await onSaved();
		} catch (error) {
			toastApiError(error, "The category could not be saved.");
		}
	};

	return (
		<form
			onSubmit={submit}
			className={cn(
				"flex flex-wrap items-center gap-2 bg-muted/40 py-3 pr-4",
				DEPTH_CLASSES[Math.min(depth, DEPTH_CLASSES.length) - 1],
			)}
		>
			<IconPicker value={icon} onValueChange={setIcon} />
			<Input
				autoFocus
				value={name}
				onChange={(event) => setName(event.target.value)}
				placeholder="Category name"
				aria-label={initial ? "Category name" : "New category name"}
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

function MoveCategoryDialog({
	node,
	options,
	onClose,
	onMoved,
}: {
	node: CategoryNode | null;
	options: FlatCategory[];
	onClose: () => void;
	onMoved: () => Promise<void>;
}) {
	const [parentId, setParentId] = useState<string>(ROOT_VALUE);
	const moveCategory = useMutation(orpc.category.move.mutationOptions());

	// The dialog is remounted for each category through its `key`, so the local
	// state always starts from the current parent.
	const submit = async () => {
		if (!node) {
			return;
		}
		try {
			await moveCategory.mutateAsync({
				id: node.id,
				parentId: parentId === ROOT_VALUE ? null : parentId,
				sortOrder: 0,
			});
			await onMoved();
			toast.success(`"${node.name}" moved.`);
			onClose();
		} catch (error) {
			toastApiError(error, "The category could not be moved.");
		}
	};

	// A category cannot become its own descendant's child.
	const excluded = new Set(node ? collectIds(node) : []);
	const candidates = node
		? options.filter((item) => !excluded.has(item.node.id))
		: [];
	const items: Record<string, string> = { [ROOT_VALUE]: "Top level" };
	for (const item of candidates) {
		items[item.node.id] = item.path;
	}

	return (
		<Dialog
			key={node?.id ?? "none"}
			open={node !== null}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Move {node?.name}</DialogTitle>
					<DialogDescription>
						Choose the new parent. The tree is limited to {CATEGORY_MAX_DEPTH}{" "}
						levels.
					</DialogDescription>
				</DialogHeader>

				<Select
					items={items}
					value={parentId}
					onValueChange={(value) => setParentId(value ?? ROOT_VALUE)}
				>
					<SelectTrigger aria-label="New parent category" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ROOT_VALUE}>Top level</SelectItem>
						{candidates.map((item) => (
							<SelectItem key={item.node.id} value={item.node.id}>
								{item.path}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={submit} disabled={moveCategory.isPending}>
						Move
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function DeleteCategoryDialog({
	node,
	options,
	onClose,
	onDeleted,
}: {
	node: CategoryNode | null;
	options: FlatCategory[];
	onClose: () => void;
	onDeleted: () => Promise<void>;
}) {
	const [reassignTo, setReassignTo] = useState<string>(NONE_VALUE);
	const deleteCategory = useMutation(orpc.category.delete.mutationOptions());

	const submit = async () => {
		if (!node) {
			return;
		}
		try {
			const result = await deleteCategory.mutateAsync({
				id: node.id,
				reassignTo: reassignTo === NONE_VALUE ? null : reassignTo,
			});
			await onDeleted();
			toast.success(
				result.reassignedDocuments > 0
					? `Category deleted, ${countLabel(result.reassignedDocuments, "document")} reassigned.`
					: "Category deleted.",
			);
			onClose();
		} catch (error) {
			toastApiError(error, "The category could not be deleted.");
		}
	};

	const items: Record<string, string> = {
		[NONE_VALUE]: "Leave without a category",
	};
	for (const item of options) {
		if (item.node.id !== node?.id) {
			items[item.node.id] = item.path;
		}
	}

	return (
		<Dialog
			key={node?.id ?? "none"}
			open={node !== null}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Delete {node?.name}</DialogTitle>
					<DialogDescription>
						{node && node.ownDocumentCount > 0
							? `${countLabel(node.ownDocumentCount, "document")} ${
									node.ownDocumentCount === 1 ? "is" : "are"
								} filed here. Choose where they should go.`
							: "No document is filed directly here. Subcategories move up one level."}
					</DialogDescription>
				</DialogHeader>

				<Select
					items={items}
					value={reassignTo}
					onValueChange={(value) => setReassignTo(value ?? NONE_VALUE)}
				>
					<SelectTrigger aria-label="Reassign documents to" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={NONE_VALUE}>Leave without a category</SelectItem>
						{options
							.filter((item) => item.node.id !== node?.id)
							.map((item) => (
								<SelectItem key={item.node.id} value={item.node.id}>
									{item.path}
								</SelectItem>
							))}
					</SelectContent>
				</Select>

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={submit}
						disabled={deleteCategory.isPending}
					>
						Delete
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Identifiers of a category and of all its descendants. */
function collectIds(node: CategoryNode, into: string[] = []): string[] {
	into.push(node.id);
	for (const child of node.children) {
		collectIds(child, into);
	}
	return into;
}
