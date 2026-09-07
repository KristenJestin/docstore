import type { DocumentBulkAction } from "@docstore/shared/document";
import { Button } from "@docstore/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@docstore/ui/components/popover";
import { cn } from "@docstore/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	FolderTreeIcon,
	LayersIcon,
	LockIcon,
	TagIcon,
	Trash2Icon,
	TypeIcon,
	Undo2Icon,
	XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { DocumentTypePicker } from "@/components/document-types/document-type-picker";
import {
	shareRevocationWarning,
	useActiveShareLinks,
} from "@/components/share/sensitive-links";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";
import { CategoryPicker } from "./category-picker";
import { TagInput } from "./tag-input";

/** Duration of the `bar-out` animation, kept in sync with `globals.css`. */
const BAR_EXIT_MS = 160;

export interface BulkActionsBarProps {
	/** Selected documents. The bar disappears when the list is empty. */
	ids: string[];
	onClear: () => void;
	/** Shows "Restore" instead of "Trash" (trash view). */
	trashed?: boolean;
}

/**
 * Floating action bar of the multi-selection: category, tags, sensitive,
 * trash / restore — all through `document.bulk`.
 */
export function BulkActionsBar({
	ids,
	onClear,
	trashed = false,
}: BulkActionsBarProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const activeShareLinks = useActiveShareLinks();
	const bulk = useMutation(orpc.document.bulk.mutationOptions());
	const [tagIds, setTagIds] = useState<string[]>([]);
	// The bar keeps the last non-empty selection while it slides out, so the
	// closing animation has something to render.
	const [leaving, setLeaving] = useState(false);
	const [shown, setShown] = useState(ids);

	useEffect(() => {
		if (ids.length > 0) {
			setShown(ids);
			setLeaving(false);
			return;
		}
		if (shown.length === 0) {
			return;
		}
		setLeaving(true);
		const timer = setTimeout(() => {
			setShown([]);
			setLeaving(false);
		}, BAR_EXIT_MS);
		return () => clearTimeout(timer);
	}, [ids, shown.length]);

	if (shown.length === 0) {
		return null;
	}

	const run = async (action: DocumentBulkAction, message: string) => {
		try {
			const result = await bulk.mutateAsync({ ids, action });
			await queryClient.invalidateQueries({ queryKey: orpc.document.key() });
			await queryClient.invalidateQueries({ queryKey: orpc.review.key() });
			toast.success(`${message} (${result.updated}).`);
			onClear();
		} catch (error) {
			toastApiError(error, "The bulk action failed.");
		}
	};

	const onSensitive = async () => {
		// Same rule as the document page: raising the flag revokes the public
		// links on the selection (and on the dossiers holding it).
		const selected = new Set(ids);
		const revoked = await activeShareLinks(
			(link) => link.documentId !== null && selected.has(link.documentId),
		);
		const warning = shareRevocationWarning(revoked.length);
		const ok = await confirm({
			title: `Mark ${countLabel(ids.length, "document")} as sensitive?`,
			description: (
				<>
					They will be encrypted at rest and hidden from MCP answers.
					{warning ? <span className="mt-2 block">{warning}</span> : null}
				</>
			),
			confirmLabel: "Mark sensitive",
		});
		if (ok) {
			await run(
				{ type: "setSensitive", sensitive: true },
				"Documents marked sensitive",
			);
		}
	};

	const onRegenerateTitle = async () => {
		const ok = await confirm({
			title: `Regenerate the title of ${countLabel(ids.length, "document")}?`,
			description:
				"Each document is renamed from the title template of the type it carries. Documents without a type, and titles set by hand, are left alone.",
			confirmLabel: "Regenerate title",
		});
		if (ok) {
			await run({ type: "regenerateTitle" }, "Titles regenerated");
		}
	};

	const onTrash = async () => {
		const ok = await confirm({
			title: `Move ${countLabel(ids.length, "document")} to the trash?`,
			description: 'They stay restorable from the "Trash" filter.',
			confirmLabel: "Move to trash",
			destructive: true,
		});
		if (ok) {
			await run({ type: "trash" }, "Documents moved to the trash");
		}
	};

	return (
		// Floating bar: `fixed` keeps it visible whatever the list height; the left
		// offset compensates for the 256 px sidebar.
		<div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-6 pb-6 lg:pl-72">
			<div
				className={cn(
					"shell pointer-events-auto",
					leaving ? "bar-out" : "bar-in",
				)}
			>
				<div className="flex flex-wrap items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-lift ring-1 ring-border">
					<span className="px-1 font-mono text-xs tabular-nums">
						{shown.length} selected
					</span>

					<Popover>
						<PopoverTrigger render={<Button variant="secondary" size="sm" />}>
							<FolderTreeIcon />
							Category
						</PopoverTrigger>
						<PopoverContent align="center" className="w-72">
							<CategoryPicker
								value={null}
								onValueChange={(categoryId) =>
									run({ type: "setCategory", categoryId }, "Category applied")
								}
								label="Category to apply"
							/>
						</PopoverContent>
					</Popover>

					<Popover>
						<PopoverTrigger render={<Button variant="secondary" size="sm" />}>
							<LayersIcon />
							Type
						</PopoverTrigger>
						<PopoverContent align="center" className="w-80">
							<DocumentTypePicker
								label="Document type to apply"
								placeholder="Search a document type…"
								value={null}
								allowCreate={false}
								onValueChange={(documentTypeId) =>
									run(
										{ type: "setDocumentType", documentTypeId },
										documentTypeId === null
											? "Document type removed"
											: "Document type applied",
									)
								}
							/>
						</PopoverContent>
					</Popover>

					<Popover>
						<PopoverTrigger render={<Button variant="secondary" size="sm" />}>
							<TagIcon />
							Tags
						</PopoverTrigger>
						<PopoverContent align="center" className="flex w-72 flex-col gap-3">
							<TagInput value={tagIds} onValueChange={setTagIds} />
							<div className="flex gap-2">
								<Button
									size="sm"
									disabled={tagIds.length === 0}
									onClick={() => run({ type: "addTags", tagIds }, "Tags added")}
								>
									Add
								</Button>
								<Button
									variant="outline"
									size="sm"
									disabled={tagIds.length === 0}
									onClick={() =>
										run({ type: "removeTags", tagIds }, "Tags removed")
									}
								>
									Remove
								</Button>
							</div>
						</PopoverContent>
					</Popover>

					<Button variant="secondary" size="sm" onClick={onRegenerateTitle}>
						<TypeIcon />
						Regenerate title
					</Button>

					<Button variant="secondary" size="sm" onClick={onSensitive}>
						<LockIcon />
						Sensitive
					</Button>

					{trashed ? (
						<Button
							variant="secondary"
							size="sm"
							onClick={() => run({ type: "restore" }, "Documents restored")}
						>
							<Undo2Icon />
							Restore
						</Button>
					) : (
						<Button variant="destructive" size="sm" onClick={onTrash}>
							<Trash2Icon />
							Trash
						</Button>
					)}

					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Clear selection"
						onClick={onClear}
					>
						<XIcon />
					</Button>
				</div>
			</div>
		</div>
	);
}
