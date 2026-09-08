import type { DocumentTypeSuggestion } from "@docstore/shared/document-type";
import { suggestedDocumentTypeName } from "@docstore/shared/document-type";
import { periodKeyOf } from "@docstore/shared/recurrence";
import { Button } from "@docstore/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, DotIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { MonoLabel } from "@/components/mono-label";
import { PartyAvatar } from "@/components/party-avatar";
import { toastApiError } from "@/lib/api-error";
import { plural } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

import { PeriodicityBadge } from "./document-type-badges";

function suggestionKey(suggestion: DocumentTypeSuggestion): string {
	return `${suggestion.partyId}:${suggestion.categoryId}`;
}

/**
 * `documentType.suggest` plus the one-click acceptance
 * (`documentType.createFromSuggestion`), shared by the panel of `/types` and
 * the "Suggested types" card of the dashboard.
 */
function useSuggestions() {
	const suggestions = useQuery(
		orpc.documentType.suggest.queryOptions({ input: {} }),
	);
	const create = useMutation(
		orpc.documentType.createFromSuggestion.mutationOptions(),
	);
	const [pending, setPending] = useState<string | null>(null);

	const accept = async (suggestion: DocumentTypeSuggestion) => {
		setPending(suggestionKey(suggestion));
		try {
			await create.mutateAsync({
				partyId: suggestion.partyId,
				categoryId: suggestion.categoryId,
				periodicity: suggestion.periodicity,
				// No first period is written down: the timeline starts at the oldest
				// document behind the suggestion, and follows it if an older one
				// turns up later.
				endPeriod: suggestion.endPeriod,
			});
			toast.success("Document type created from the suggestion.");
		} catch (error) {
			toastApiError(error, "The document type could not be created.");
		} finally {
			setPending(null);
		}
	};

	return {
		items: suggestions.data ?? [],
		isLoading: suggestions.isLoading,
		accept,
		pending,
	};
}

interface SuggestionRowProps {
	suggestion: DocumentTypeSuggestion;
	pending: boolean;
	/** Hides the observed range, too dense for the dashboard column. */
	compact?: boolean;
	onAccept: () => void;
}

function SuggestionRow({
	suggestion,
	pending,
	compact = false,
	onAccept,
}: SuggestionRowProps) {
	return (
		<li className="row-in flex flex-wrap items-center gap-3 px-4 py-3">
			<PartyAvatar
				name={suggestion.partyName}
				logoKey={suggestion.partyLogoKey}
				partyId={suggestion.partyId}
				size="sm"
			/>
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">
					{suggestedDocumentTypeName(
						suggestion.partyName,
						suggestion.categoryName,
					)}
				</p>
				<p className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
					<span className="font-mono tabular-nums">
						{suggestion.sampleCount}
					</span>
					{plural(suggestion.sampleCount, "document")} observed
					{compact ? null : (
						<>
							<DotIcon aria-hidden className="size-3" />
							<span className="font-mono tabular-nums">
								{periodKeyOf(suggestion.periodicity, suggestion.startPeriod)}
							</span>
							<ArrowRightIcon aria-hidden className="size-3" />
							<span className="font-mono tabular-nums">
								{periodKeyOf(suggestion.periodicity, suggestion.endPeriod)}
							</span>
						</>
					)}
				</p>
			</div>
			<PeriodicityBadge periodicity={suggestion.periodicity} />
			<Button size="sm" variant="outline" disabled={pending} onClick={onAccept}>
				<PlusIcon />
				Create
			</Button>
		</li>
	);
}

/**
 * "Suggestions" panel of `/types`: recurrences spotted in the documents already
 * filed (`documentType.suggest`), each turned into a recurring type in one
 * click through `documentType.createFromSuggestion`.
 */
export function DocumentTypeSuggestions() {
	const { items, isLoading, accept, pending } = useSuggestions();

	if (isLoading || items.length === 0) {
		return null;
	}

	return (
		<div className="shell mx-6 mt-6 lg:mx-8">
			<div className="overflow-hidden rounded-xl bg-card shadow-soft ring-1 ring-border">
				<div className="flex items-center gap-2 border-border border-b px-4 py-3">
					<SparklesIcon
						aria-hidden
						className="size-4 text-primary"
						strokeWidth={1.5}
					/>
					<MonoLabel>Suggestions</MonoLabel>
					<p className="text-muted-foreground text-xs">
						Recurrences spotted in the documents already filed.
					</p>
				</div>
				<ul className="divide-y divide-border">
					{items.map((suggestion) => (
						<SuggestionRow
							key={suggestionKey(suggestion)}
							suggestion={suggestion}
							pending={pending === suggestionKey(suggestion)}
							onAccept={() => accept(suggestion)}
						/>
					))}
				</ul>
			</div>
		</div>
	);
}

export interface DocumentTypeSuggestionListProps {
	/** How many suggestions the dashboard card shows. */
	limit?: number;
}

/**
 * Body of the "Suggested types" card of the dashboard: the same suggestions,
 * capped, with an empty state explaining what a document type is for.
 */
export function DocumentTypeSuggestionList({
	limit = 4,
}: DocumentTypeSuggestionListProps) {
	const { items, isLoading, accept, pending } = useSuggestions();

	if (isLoading) {
		return (
			<div className="px-4 pb-4 text-muted-foreground text-xs">Looking…</div>
		);
	}

	if (items.length === 0) {
		return (
			<EmptyState
				size="sm"
				title="No suggestion"
				description="A document type files the documents you keep receiving. One will be suggested here as soon as an issuer sends the same kind of document over two periods."
			/>
		);
	}

	return (
		<ul className="divide-y divide-border border-border border-t">
			{items.slice(0, limit).map((suggestion) => (
				<SuggestionRow
					key={suggestionKey(suggestion)}
					suggestion={suggestion}
					pending={pending === suggestionKey(suggestion)}
					compact
					onAccept={() => accept(suggestion)}
				/>
			))}
		</ul>
	);
}
