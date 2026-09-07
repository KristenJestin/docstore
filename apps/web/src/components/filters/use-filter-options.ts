import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useCategoryOptions } from "@/components/documents/category-picker";
import { orpc } from "@/utils/orpc";

import type { FilterOption } from "./filter-types";

/**
 * Option sources of the reference filters (category, party, document type,
 * tag). They are plain hooks called once by the page that builds its
 * `FilterField[]`, so `FilterBar` never talks to the API itself.
 */

/** How many parties and tags the pickers of the bar offer. */
const OPTION_PAGE_SIZE = 100;

/** Category tree, flattened and indented; the path feeds the search box. */
export function useCategoryFilterOptions(): {
	options: FilterOption[];
	isLoading: boolean;
} {
	const { options, isLoading } = useCategoryOptions();
	return useMemo(
		() => ({
			isLoading,
			options: options.map((option) => ({
				value: option.id,
				label: option.name,
				keywords: option.path,
				depth: option.depth,
			})),
		}),
		[options, isLoading],
	);
}

export function usePartyFilterOptions(): {
	options: FilterOption[];
	isLoading: boolean;
} {
	const parties = useQuery(
		orpc.party.list.queryOptions({
			input: { page: 1, pageSize: OPTION_PAGE_SIZE, includeArchived: false },
		}),
	);
	return useMemo(
		() => ({
			isLoading: parties.isLoading,
			options: (parties.data?.items ?? []).map((party) => ({
				value: party.id,
				label: party.name,
				keywords: party.aliases.join(" "),
			})),
		}),
		[parties.data, parties.isLoading],
	);
}

export function useDocumentTypeFilterOptions(): {
	options: FilterOption[];
	isLoading: boolean;
} {
	const types = useQuery(
		orpc.documentType.list.queryOptions({
			input: { recurringOnly: false, includeDisabled: true },
		}),
	);
	return useMemo(
		() => ({
			isLoading: types.isLoading,
			options: (types.data ?? []).map((type) => ({
				value: type.id,
				label: type.name,
				keywords: [type.issuerName, type.categoryName]
					.filter(Boolean)
					.join(" "),
			})),
		}),
		[types.data, types.isLoading],
	);
}

export function useTagFilterOptions(): {
	options: FilterOption[];
	isLoading: boolean;
} {
	const tags = useQuery(orpc.tag.list.queryOptions({ input: {} }));
	return useMemo(
		() => ({
			isLoading: tags.isLoading,
			options: (tags.data ?? []).map((tag) => ({
				value: tag.id,
				label: tag.name,
			})),
		}),
		[tags.data, tags.isLoading],
	);
}
