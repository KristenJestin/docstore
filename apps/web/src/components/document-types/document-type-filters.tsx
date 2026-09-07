import { FolderTreeIcon, PowerIcon, RepeatIcon } from "lucide-react";
import { type Ref, useMemo } from "react";
import { z } from "zod";

import { FilterBar } from "@/components/filters/filter-bar";
import { booleanField, idField } from "@/components/filters/filter-fields";
import type { FilterField } from "@/components/filters/filter-types";
import { useCategoryFilterOptions } from "@/components/filters/use-filter-options";

/**
 * `/types` filters carried by the URL. `recurring` is the former "Recurring"
 * tab, now an ordinary pill: the dashboard and the reminders still link to
 * `/types?recurring=true`.
 */
export const documentTypeSearchSchema = z.object({
	q: z.string().trim().min(1).optional().catch(undefined),
	recurring: z.boolean().optional().catch(undefined),
	enabled: z.boolean().optional().catch(undefined),
	categoryId: z.string().min(1).optional().catch(undefined),
});

export type DocumentTypeSearch = z.infer<typeof documentTypeSearchSchema>;

function useFields(): FilterField<DocumentTypeSearch>[] {
	const categories = useCategoryFilterOptions();

	return useMemo(
		() => [
			booleanField<DocumentTypeSearch>(
				"recurring",
				"Recurring",
				RepeatIcon,
				"recurring",
			),
			booleanField<DocumentTypeSearch>(
				"enabled",
				"Enabled",
				PowerIcon,
				"enabled",
			),
			idField<DocumentTypeSearch>(
				"category",
				"Category",
				FolderTreeIcon,
				"categoryId",
				categories,
			),
		],
		[categories],
	);
}

export interface DocumentTypeFiltersProps {
	value: DocumentTypeSearch;
	onChange: (patch: Partial<DocumentTypeSearch>) => void;
	/** Draft of the search box, debounced by the page into `q`. */
	query: string;
	onQueryChange: (query: string) => void;
	searchRef?: Ref<HTMLInputElement>;
}

/** Filter bar of `/types`: search, recurring, enabled, category. */
export function DocumentTypeFilters({
	value,
	onChange,
	query,
	onQueryChange,
	searchRef,
}: DocumentTypeFiltersProps) {
	const fields = useFields();

	return (
		<FilterBar<DocumentTypeSearch>
			className="mt-6"
			fields={fields}
			value={value}
			onChange={onChange}
			search={{
				value: query,
				onValueChange: onQueryChange,
				placeholder: "Name of a document type…",
				label: "Search a document type",
				inputRef: searchRef,
			}}
		/>
	);
}
