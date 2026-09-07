import type { DocumentSort } from "@docstore/shared/document";
import { DOCUMENT_SORTS, DOCUMENT_STATUSES } from "@docstore/shared/document";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import {
	CalendarClockIcon,
	CalendarRangeIcon,
	FolderTreeIcon,
	HashIcon,
	LayersIcon,
	LockIcon,
	MapPinIcon,
	TagIcon,
	Trash2Icon,
	UsersIcon,
	WorkflowIcon,
} from "lucide-react";
import { type Ref, useEffect, useMemo, useState } from "react";

import { FilterBar } from "@/components/filters/filter-bar";
import {
	booleanField,
	dateRangeField,
	idField,
	idsField,
	textField,
} from "@/components/filters/filter-fields";
import { type FilterField, OP_IS } from "@/components/filters/filter-types";
import {
	useCategoryFilterOptions,
	useDocumentTypeFilterOptions,
	usePartyFilterOptions,
	useTagFilterOptions,
} from "@/components/filters/use-filter-options";
import { IconLabel, iconLabelItems } from "@/components/icon-label";
import type { DocumentSearch } from "@/lib/document-search";
import { plural } from "@/lib/plural";
import {
	DOCUMENT_SORT_ICONS,
	DOCUMENT_SORT_LABELS,
	DOCUMENT_STATUS_ICONS,
	DOCUMENT_STATUS_LABELS,
} from "./document-labels";

/** Delay before the query is written back to the URL. */
const SEARCH_DEBOUNCE_MS = 300;

/** Depth of the year picker (beyond that, full-text search is enough). */
const YEAR_SPAN = 15;

const SORT_ITEMS = iconLabelItems(
	DOCUMENT_SORTS,
	DOCUMENT_SORT_LABELS,
	DOCUMENT_SORT_ICONS,
);

/* ------------------------------------------------------------------ */
/* `/documents`                                                         */
/* ------------------------------------------------------------------ */

/** Declarative filters of `/documents`, in the order of the "Add filter" menu. */
export function useDocumentFilterFields(): FilterField<DocumentSearch>[] {
	const categories = useCategoryFilterOptions();
	const parties = usePartyFilterOptions();
	const types = useDocumentTypeFilterOptions();
	const tags = useTagFilterOptions();

	return useMemo(() => {
		const currentYear = new Date().getFullYear();
		const years = Array.from({ length: YEAR_SPAN }, (_, offset) => {
			const year = String(currentYear - offset);
			return { value: year, label: year };
		});

		return [
			idField<DocumentSearch>(
				"category",
				"Category",
				FolderTreeIcon,
				"categoryId",
				categories,
			),
			idField<DocumentSearch>("party", "Party", UsersIcon, "partyId", parties),
			idField<DocumentSearch>(
				"documentType",
				"Document type",
				LayersIcon,
				"documentTypeId",
				types,
			),
			idsField<DocumentSearch>("tags", "Tags", TagIcon, "tags", tags),
			{
				id: "status",
				label: "Status",
				icon: WorkflowIcon,
				type: "select",
				operators: [OP_IS],
				options: DOCUMENT_STATUSES.map((status) => {
					const StatusIcon = DOCUMENT_STATUS_ICONS[status];
					return {
						value: status,
						label: DOCUMENT_STATUS_LABELS[status],
						adornment: (
							<StatusIcon
								aria-hidden
								className="size-4 text-muted-foreground"
							/>
						),
					};
				}),
				read: (search) =>
					search.status ? { operator: "is", values: [search.status] } : null,
				write: (value) => ({
					status: (value?.values[0] as DocumentSearch["status"]) || undefined,
				}),
			},
			{
				id: "year",
				label: "Year",
				icon: CalendarRangeIcon,
				type: "select",
				operators: [OP_IS],
				options: years,
				read: (search) =>
					search.year
						? { operator: "is", values: [String(search.year)] }
						: null,
				write: (value) => ({
					year: value?.values[0] ? Number(value.values[0]) : undefined,
				}),
			},
			dateRangeField<DocumentSearch>(
				"date",
				"Document date",
				CalendarRangeIcon,
				"dateFrom",
				"dateTo",
			),
			dateRangeField<DocumentSearch>(
				"validUntil",
				"Valid until",
				CalendarClockIcon,
				"validUntilFrom",
				"validUntilTo",
			),
			booleanField<DocumentSearch>(
				"sensitive",
				"Sensitive",
				LockIcon,
				"sensitive",
			),
			booleanField<DocumentSearch>("hasAsn", "Has an ASN", HashIcon, "hasAsn"),
			textField<DocumentSearch>(
				"physicalLocation",
				"Physical location",
				MapPinIcon,
				"physicalLocation",
				'Blue "Payroll" binder',
			),
			booleanField<DocumentSearch>("trash", "Trash", Trash2Icon, "trash"),
		];
	}, [categories, parties, types, tags]);
}

export interface DocumentFiltersProps {
	value: DocumentSearch;
	/** Applies a filter patch (the caller resets the page to 1). */
	onChange: (patch: Partial<DocumentSearch>) => void;
	searchRef?: Ref<HTMLInputElement>;
	/** Result count shown on the right of the bar. */
	total?: number;
}

/**
 * Filters of `/documents`: the shared `FilterBar` fed with the declarative
 * fields above, plus the sort select and the result count on the right.
 */
export function DocumentFilters({
	value,
	onChange,
	searchRef,
	total,
}: DocumentFiltersProps) {
	const fields = useDocumentFilterFields();
	const [draft, setDraft] = useState(value.q ?? "");

	useEffect(() => {
		setDraft(value.q ?? "");
	}, [value.q]);

	useEffect(() => {
		const current = value.q ?? "";
		if (draft === current) {
			return;
		}
		const timer = setTimeout(() => {
			onChange({ q: draft.trim().length > 0 ? draft.trim() : undefined });
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [draft, value.q, onChange]);

	return (
		<FilterBar<DocumentSearch>
			className="mt-6"
			fields={fields}
			value={value}
			onChange={onChange}
			search={{
				value: draft,
				onValueChange: setDraft,
				placeholder: "Full-text search in the OCR content…",
				label: "Search a document",
				inputRef: searchRef,
			}}
			trailing={
				<>
					{total !== undefined ? (
						<p className="text-muted-foreground text-xs">
							<span className="font-mono font-semibold text-foreground tabular-nums">
								{total}
							</span>{" "}
							{plural(total, "result")}
						</p>
					) : null}
					<Select
						items={SORT_ITEMS}
						value={value.sort ?? "documentDate:desc"}
						onValueChange={(next) => onChange({ sort: next as DocumentSort })}
					>
						<SelectTrigger aria-label="Sort documents" className="w-44">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{DOCUMENT_SORTS.map((sort) => (
								<SelectItem key={sort} value={sort}>
									<IconLabel
										icon={DOCUMENT_SORT_ICONS[sort]}
										label={DOCUMENT_SORT_LABELS[sort]}
									/>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</>
			}
		/>
	);
}
