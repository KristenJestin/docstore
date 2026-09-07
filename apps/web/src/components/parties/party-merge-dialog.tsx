import type { MergePartiesResult, PartyDetail } from "@docstore/shared/party";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/form-field";
import { PartyPicker } from "@/components/parties/party-picker";
import { PartyAvatar } from "@/components/party-avatar";
import { toastApiError } from "@/lib/api-error";
import {
	PARTY_IDENTIFIER_LABELS,
	PARTY_IDENTIFIER_ORDER,
} from "@/lib/party-form";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

export interface PartyMergeDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Party being absorbed: it is archived once everything has moved. */
	sourceId: string;
	/** Survivor, preselected by the caller (duplicate pair, conflict notice). */
	initialTargetId?: string | null;
	/** Called after `party.mergeInto` succeeded; the caller decides where to go. */
	onMerged?: (result: MergePartiesResult) => void;
}

/**
 * "Merge into…" of a party: a picker for the survivor, then the summary of
 * what `party.mergeInto` is about to move — documents, relations, identifiers
 * and the absorbed name kept as an alias — before the write.
 *
 * The dialog is the confirmation: nothing leaves until "Merge" is pressed, and
 * both sides are read from `party.get` so the counts shown are the real ones.
 */
export function PartyMergeDialog({
	open,
	onOpenChange,
	sourceId,
	initialTargetId,
	onMerged,
}: PartyMergeDialogProps) {
	const ids = useId();
	const queryClient = useQueryClient();
	const merge = useMutation(orpc.party.mergeInto.mutationOptions());

	const [targetId, setTargetId] = useState<string | null>(
		initialTargetId ?? null,
	);
	// The dialog stays mounted: the choice is rebuilt every time it reopens.
	const draftKey = `${sourceId}:${initialTargetId ?? ""}`;
	const [loadedFor, setLoadedFor] = useState<string | null>(null);
	if (open && loadedFor !== draftKey) {
		setLoadedFor(draftKey);
		setTargetId(initialTargetId ?? null);
	}
	if (!open && loadedFor !== null) {
		setLoadedFor(null);
	}

	const source = useQuery({
		...orpc.party.get.queryOptions({ input: { id: sourceId } }),
		enabled: open && sourceId.length > 0,
	});
	const target = useQuery({
		...orpc.party.get.queryOptions({ input: { id: targetId ?? "" } }),
		enabled: open && Boolean(targetId),
	});

	const onMerge = async () => {
		if (!targetId) {
			return;
		}
		try {
			const result = await merge.mutateAsync({ sourceId, targetId });
			await queryClient.invalidateQueries({ queryKey: orpc.party.key() });
			// Every document linked to the source now points at the target.
			await queryClient.invalidateQueries({ queryKey: orpc.document.key() });
			toast.success(`Merged into "${result.target.name}".`, {
				description: `${countLabel(
					result.movedDocuments,
					"document",
				)} and ${countLabel(result.movedRelations, "relation")} moved.`,
			});
			onOpenChange(false);
			onMerged?.(result);
		} catch (error) {
			toastApiError(error, "The parties could not be merged.");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Merge this party</DialogTitle>
					<DialogDescription>
						Everything recorded on {source.data?.name ?? "this party"} moves to
						the party you pick; the absorbed one is archived, never deleted.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<FormField
						label="Merge into"
						htmlFor={`${ids}-target`}
						hint="Pick the party that keeps everything."
					>
						<PartyPicker
							id={`${ids}-target`}
							label="Merge into"
							placeholder="Search a party…"
							value={targetId}
							onValueChange={setTargetId}
							excludeIds={[sourceId]}
							allowCreate={false}
						/>
					</FormField>

					{source.data ? (
						<div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
							<div className="flex flex-wrap items-center gap-2">
								<PartySide
									name={source.data.name}
									logoKey={source.data.logoKey}
									partyId={source.data.id}
								/>
								<ArrowRightIcon
									aria-hidden
									className="size-4 shrink-0 text-muted-foreground"
								/>
								{target.data ? (
									<PartySide
										name={target.data.name}
										logoKey={target.data.logoKey}
										partyId={target.data.id}
									/>
								) : (
									<span className="text-muted-foreground text-sm">
										No party picked yet
									</span>
								)}
							</div>
							<ul className="flex flex-col gap-1 text-muted-foreground text-xs">
								{movedSummary(source.data).map((line) => (
									<li key={line}>{line}</li>
								))}
							</ul>
						</div>
					) : (
						<Skeleton className="h-24 w-full" />
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={onMerge}
						disabled={!targetId || merge.isPending || !source.data}
					>
						{merge.isPending ? "Merging…" : "Merge"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Avatar + name of one side of the merge. */
function PartySide({
	name,
	logoKey,
	partyId,
}: {
	name: string;
	logoKey: string | null;
	partyId: string;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			<PartyAvatar name={name} logoKey={logoKey} partyId={partyId} size="sm" />
			<span className="min-w-0 truncate font-medium text-sm">{name}</span>
		</span>
	);
}

/** Plain sentences describing what `party.mergeInto` moves. */
function movedSummary(source: PartyDetail): string[] {
	const relations = source.relationsFrom.length + source.relationsTo.length;
	const identifiers = PARTY_IDENTIFIER_ORDER.filter((key) => {
		const value = source.identifiers[key];
		return Array.isArray(value) ? value.length > 0 : Boolean(value);
	}).map((key) => PARTY_IDENTIFIER_LABELS[key]);

	return [
		`${countLabel(source.documentCount, "document")} are relinked.`,
		`${countLabel(relations, "relation")} with other parties are repointed.`,
		identifiers.length > 0
			? `Identifiers move over: ${identifiers.join(", ")}.`
			: "No identifier to move.",
		`The name “${source.name}” and its aliases are kept as aliases.`,
	];
}
