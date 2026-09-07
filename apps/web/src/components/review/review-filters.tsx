import { REVIEW_REASON_CODES } from "@docstore/shared/document";
import type { ReviewItem } from "@docstore/shared/review";
import { FolderTreeIcon, TriangleAlertIcon, UsersIcon } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import {
	REVIEW_REASON_ICONS,
	REVIEW_REASON_LABELS,
} from "@/components/documents/document-labels";
import { FilterBar } from "@/components/filters/filter-bar";
import { idField } from "@/components/filters/filter-fields";
import {
	type FilterField,
	OP_HAS_ALL,
} from "@/components/filters/filter-types";
import {
	useCategoryFilterOptions,
	usePartyFilterOptions,
} from "@/components/filters/use-filter-options";

/** `/review` filters carried by the URL. */
export const reviewSearchSchema = z.object({
	reasons: z.array(z.string().min(1)).optional().catch(undefined),
	partyId: z.string().min(1).optional().catch(undefined),
	categoryId: z.string().min(1).optional().catch(undefined),
	page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export type ReviewSearch = z.infer<typeof reviewSearchSchema>;

/** `true` when the queue has to be narrowed here rather than by the API. */
export function hasReviewFilters(search: ReviewSearch): boolean {
	return Boolean(
		(search.reasons && search.reasons.length > 0) ||
			search.partyId ||
			search.categoryId,
	);
}

/** Keeps the queue entries matching the filters of the URL. */
export function matchesReviewFilters(
	item: ReviewItem,
	search: ReviewSearch,
): boolean {
	if (search.reasons && search.reasons.length > 0) {
		const codes = new Set(item.reviewReasons.map((reason) => reason.code));
		if (!search.reasons.every((code) => codes.has(code as never))) {
			return false;
		}
	}
	if (
		search.partyId &&
		!item.parties.some((party) => party.id === search.partyId)
	) {
		return false;
	}
	if (search.categoryId && item.category?.id !== search.categoryId) {
		return false;
	}
	return true;
}

function useFields(): FilterField<ReviewSearch>[] {
	const categories = useCategoryFilterOptions();
	const parties = usePartyFilterOptions();

	return useMemo(
		() => [
			{
				id: "reasons",
				label: "Reasons",
				icon: TriangleAlertIcon,
				type: "multiSelect",
				operators: [OP_HAS_ALL],
				options: REVIEW_REASON_CODES.map((code) => {
					const Icon = REVIEW_REASON_ICONS[code];
					return {
						value: code,
						label: REVIEW_REASON_LABELS[code],
						adornment: (
							<Icon aria-hidden className="size-4 text-muted-foreground" />
						),
					};
				}),
				read: (search) =>
					search.reasons && search.reasons.length > 0
						? { operator: "hasAll", values: search.reasons }
						: null,
				write: (value) => ({
					reasons: value && value.values.length > 0 ? value.values : undefined,
				}),
			},
			idField<ReviewSearch>("party", "Party", UsersIcon, "partyId", parties),
			idField<ReviewSearch>(
				"category",
				"Category",
				FolderTreeIcon,
				"categoryId",
				categories,
			),
		],
		[categories, parties],
	);
}

export interface ReviewFiltersProps {
	value: ReviewSearch;
	onChange: (patch: Partial<ReviewSearch>) => void;
}

/** Filter bar of `/review`: review reasons, party, category. */
export function ReviewFilters({ value, onChange }: ReviewFiltersProps) {
	return (
		<FilterBar<ReviewSearch>
			className="mt-6"
			fields={useFields()}
			value={value}
			onChange={onChange}
		/>
	);
}
