import type {
	DossierSummary,
	DossierWithCount,
} from "@docstore/shared/dossier";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@docstore/ui/components/combobox";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

export interface DocumentDossiersCardProps {
	documentId: string;
	/**
	 * Membership already carried by `document.get().dossiers`. Passing it avoids
	 * the extra `dossier.listForDocument` round trip; the card falls back to that
	 * read when it is absent (it is then its own source of truth).
	 */
	dossiers?: DossierSummary[];
}

/** "Dossiers" card of the document metadata panel: membership, add and remove. */
export function DocumentDossiersCard({
	documentId,
	dossiers,
}: DocumentDossiersCardProps) {
	const queryClient = useQueryClient();
	const [target, setTarget] = useState<DossierWithCount | null>(null);

	// Read only when the caller has nothing to hand over: `document.get` already
	// embeds the membership.
	const membership = useQuery({
		...orpc.dossier.listForDocument.queryOptions({ input: { documentId } }),
		enabled: dossiers === undefined,
	});
	const current = dossiers ?? membership.data ?? [];

	const all = useQuery(
		orpc.dossier.list.queryOptions({ input: { includeClosed: true } }),
	);

	const currentIds = new Set(current.map((dossier) => dossier.id));
	const candidates = (all.data ?? []).filter(
		(dossier) => !currentIds.has(dossier.id),
	);

	const addDocuments = useMutation(orpc.dossier.addDocuments.mutationOptions());
	const removeDocument = useMutation(
		orpc.dossier.removeDocument.mutationOptions(),
	);

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.dossier.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.document.key() }),
		]);

	const add = async () => {
		if (!target) {
			return;
		}
		try {
			await addDocuments.mutateAsync({
				id: target.id,
				documentIds: [documentId],
			});
			await invalidate();
			toast.success(`Added to "${target.name}".`);
			setTarget(null);
		} catch (error) {
			toastApiError(error, "The document could not be added.");
		}
	};

	const remove = async (dossier: DossierSummary) => {
		try {
			await removeDocument.mutateAsync({ id: dossier.id, documentId });
			await invalidate();
			toast.success(`Removed from "${dossier.name}".`);
		} catch (error) {
			toastApiError(error, "The document could not be removed.");
		}
	};

	return (
		<div className="flex flex-col gap-3">
			{dossiers === undefined && membership.isLoading ? (
				<Skeleton className="h-8 w-full" />
			) : current.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					This document is not in any dossier.
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-border border-border border-t">
					{current.map((dossier) => (
						<li key={dossier.id} className="flex items-center gap-2 py-2">
							<Link
								to="/dossiers/$dossierId"
								params={{ dossierId: dossier.id }}
								className="min-w-0 flex-1 truncate text-sm hover:underline"
							>
								{dossier.name}
							</Link>
							{dossier.status === "closed" ? (
								<Badge tone="neutral">Closed</Badge>
							) : null}
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Remove from ${dossier.name}`}
								onClick={() => remove(dossier)}
							>
								<XIcon />
							</Button>
						</li>
					))}
				</ul>
			)}

			<div className="flex items-center gap-2">
				<Combobox
					items={candidates}
					value={target}
					onValueChange={setTarget}
					itemToStringLabel={(item: DossierWithCount) => item.name}
					isItemEqualToValue={(
						item: DossierWithCount,
						value: DossierWithCount,
					) => item.id === value.id}
				>
					<ComboboxInput
						aria-label="Add to a dossier"
						placeholder="Add to a dossier…"
						showClear
						className="w-full"
					/>
					<ComboboxContent>
						<ComboboxEmpty>No dossier found.</ComboboxEmpty>
						<ComboboxList>
							{(item: DossierWithCount) => (
								<ComboboxItem key={item.id} value={item}>
									<span className="min-w-0 flex-1 truncate">{item.name}</span>
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
				<Button
					variant="outline"
					size="icon"
					aria-label="Add to the selected dossier"
					disabled={!target}
					onClick={add}
				>
					<PlusIcon />
				</Button>
			</div>
		</div>
	);
}
