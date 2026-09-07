import { Button } from "@docstore/ui/components/button";
import { Checkbox } from "@docstore/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@docstore/ui/components/dialog";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DateText } from "@/components/date-text";
import { DocumentTitleCell } from "@/components/documents/document-row";
import { EmptyState } from "@/components/empty-state";
import { SearchInput } from "@/components/search-input";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

/** How many candidates the dialog shows at once. */
const PAGE_SIZE = 25;

export interface DossierDocumentPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	dossierId: string;
	/** Ids already in the dossier: they are shown ticked and disabled. */
	memberIds: string[];
}

/**
 * "Add documents" dialog of a Dossier: full-text search through
 * `document.list`, multi-selection, then `dossier.addDocuments`.
 */
export function DossierDocumentPicker({
	open,
	onOpenChange,
	dossierId,
	memberIds,
}: DossierDocumentPickerProps) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string[]>([]);

	useEffect(() => {
		if (open) {
			setQuery("");
			setSelected([]);
		}
	}, [open]);

	const needle = query.trim();
	const documents = useQuery({
		...orpc.document.list.queryOptions({
			input: {
				query: needle.length > 0 ? needle : undefined,
				page: 1,
				pageSize: PAGE_SIZE,
				sort: "createdAt:desc",
				deleted: "exclude",
			},
		}),
		enabled: open,
	});

	const addDocuments = useMutation(orpc.dossier.addDocuments.mutationOptions());

	const members = new Set(memberIds);
	const items = documents.data?.items ?? [];

	const submit = async () => {
		if (selected.length === 0) {
			return;
		}
		try {
			await addDocuments.mutateAsync({ id: dossierId, documentIds: selected });
			toast.success(`${countLabel(selected.length, "document")} added.`);
			onOpenChange(false);
		} catch (error) {
			toastApiError(error, "The documents could not be added.");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Add documents</DialogTitle>
					<DialogDescription>
						Search the library and tick the documents to attach to this dossier.
					</DialogDescription>
				</DialogHeader>

				<SearchInput
					value={query}
					onValueChange={setQuery}
					placeholder="Search a document…"
					label="Search a document"
				/>

				<div className="max-h-96 overflow-y-auto rounded-lg ring-1 ring-border">
					{documents.isLoading ? (
						<div className="flex flex-col gap-2 p-3">
							{[0, 1, 2].map((index) => (
								<Skeleton key={index} className="h-12 w-full" />
							))}
						</div>
					) : items.length === 0 ? (
						<div className="p-3">
							<EmptyState
								size="sm"
								title="No document"
								description="No document matches this search."
							/>
						</div>
					) : (
						<ul className="divide-y divide-border">
							{items.map((item) => {
								const isMember = members.has(item.id);
								return (
									<li
										key={item.id}
										className="flex items-center gap-3 px-3 py-2"
									>
										<Checkbox
											aria-label={`Select ${item.title}`}
											disabled={isMember}
											checked={isMember || selected.includes(item.id)}
											onCheckedChange={(checked) =>
												setSelected((current) =>
													checked
														? [...current, item.id]
														: current.filter((id) => id !== item.id),
												)
											}
										/>
										<span className="min-w-0 flex-1">
											<DocumentTitleCell item={item} size="sm" />
										</span>
										<DateText
											value={item.documentDate}
											precision={item.datePrecision}
										/>
									</li>
								);
							})}
						</ul>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={selected.length === 0 || addDocuments.isPending}
						onClick={submit}
					>
						{addDocuments.isPending
							? "Adding…"
							: `Add ${countLabel(selected.length, "document")}`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
