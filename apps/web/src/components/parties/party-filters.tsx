import type { PartyType } from "@docstore/shared/party";
import { PARTY_TYPES, partyTypeSchema } from "@docstore/shared/party";
import { ArchiveIcon, HouseIcon, ShapesIcon } from "lucide-react";
import { type Ref, useMemo } from "react";
import { z } from "zod";

import { FilterBar } from "@/components/filters/filter-bar";
import { booleanField } from "@/components/filters/filter-fields";
import { type FilterField, OP_IS } from "@/components/filters/filter-types";
import {
	PARTY_TYPE_ICONS,
	PARTY_TYPE_LABELS,
} from "@/components/party-type-badge";

/**
 * `/parties` filters carried by the URL, same shape as `/documents`: every
 * field falls back to `undefined` when invalid, so a roughly copy-pasted link
 * never breaks the screen.
 */
export const partySearchSchema = z.object({
	q: z.string().trim().min(1).optional().catch(undefined),
	type: partyTypeSchema.optional().catch(undefined),
	/** `true`: only the archived parties; `false`: only the active ones. */
	archived: z.boolean().optional().catch(undefined),
	household: z.boolean().optional().catch(undefined),
	page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export type PartySearch = z.infer<typeof partySearchSchema>;

/**
 * `true` when a filter `party.list` cannot express is on: the page then loads
 * one large page and narrows it itself.
 */
export function needsClientFilter(search: PartySearch): boolean {
	return search.archived !== undefined || search.household !== undefined;
}

function useFields(): FilterField<PartySearch>[] {
	return useMemo(
		() => [
			{
				id: "type",
				label: "Type",
				icon: ShapesIcon,
				type: "select",
				operators: [OP_IS],
				options: PARTY_TYPES.map((type) => {
					const Icon = PARTY_TYPE_ICONS[type];
					return {
						value: type,
						label: PARTY_TYPE_LABELS[type],
						adornment: (
							<Icon aria-hidden className="size-4 text-muted-foreground" />
						),
					};
				}),
				read: (search) =>
					search.type ? { operator: "is", values: [search.type] } : null,
				write: (value) => ({
					type: (value?.values[0] as PartyType) || undefined,
				}),
			},
			booleanField<PartySearch>(
				"archived",
				"Archived",
				ArchiveIcon,
				"archived",
			),
			booleanField<PartySearch>(
				"household",
				"Household",
				HouseIcon,
				"household",
			),
		],
		[],
	);
}

export interface PartyFiltersProps {
	value: PartySearch;
	onChange: (patch: Partial<PartySearch>) => void;
	/** Draft of the search box, debounced by the page into `q`. */
	query: string;
	onQueryChange: (query: string) => void;
	searchRef?: Ref<HTMLInputElement>;
}

/** Filter bar of `/parties`: search, type, archived, household. */
export function PartyFilters({
	value,
	onChange,
	query,
	onQueryChange,
	searchRef,
}: PartyFiltersProps) {
	const fields = useFields();

	return (
		<FilterBar<PartySearch>
			className="mt-6"
			fields={fields}
			value={value}
			onChange={onChange}
			search={{
				value: query,
				onValueChange: onQueryChange,
				placeholder: "Name, alias, SIREN, domain, email…",
				label: "Search a party",
				inputRef: searchRef,
			}}
		/>
	);
}
