import { formatDateValue } from "@/components/date-picker";

import {
	BOOLEAN_OPTIONS,
	DATE_RANGE_OPERATORS,
	type FilterField,
	type FilterOption,
	type FilterValue,
	OP_CONTAINS,
	OP_HAS_ALL,
	OP_IS,
} from "./filter-types";

/**
 * Builders of the filter shapes every screen reuses. They only know how to
 * read and write one or two keys of a URL search object: what a key means is
 * the business of the screen that declares the field.
 */

/** Reference field on a single id: `Party · is · EDF`. */
export function idField<S>(
	id: string,
	label: string,
	icon: FilterField<S>["icon"],
	key: keyof S,
	source: { options: FilterOption[]; isLoading: boolean },
): FilterField<S> {
	return {
		id,
		label,
		icon,
		type: "select",
		operators: [OP_IS],
		options: source.options,
		optionsLoading: source.isLoading,
		read: (search) => {
			const current = search[key];
			return typeof current === "string" && current.length > 0
				? { operator: "is", values: [current] }
				: null;
		},
		write: (value) => ({ [key]: value?.values[0] || undefined }) as Partial<S>,
	};
}

/** Multi-selection of ids written into an array key. */
export function idsField<S>(
	id: string,
	label: string,
	icon: FilterField<S>["icon"],
	key: keyof S,
	source: { options: FilterOption[]; isLoading: boolean },
): FilterField<S> {
	return {
		id,
		label,
		icon,
		type: "multiSelect",
		operators: [OP_HAS_ALL],
		options: source.options,
		optionsLoading: source.isLoading,
		read: (search) => {
			const current = search[key];
			return Array.isArray(current) && current.length > 0
				? { operator: "hasAll", values: current as string[] }
				: null;
		},
		write: (value) =>
			({
				[key]: value && value.values.length > 0 ? value.values : undefined,
			}) as Partial<S>,
	};
}

/** Yes / No field backed by a boolean search key. */
export function booleanField<S>(
	id: string,
	label: string,
	icon: FilterField<S>["icon"],
	key: keyof S,
): FilterField<S> {
	return {
		id,
		label,
		icon,
		type: "boolean",
		operators: [OP_IS],
		options: BOOLEAN_OPTIONS,
		read: (search) => {
			const current = search[key];
			return typeof current === "boolean"
				? { operator: "is", values: [String(current)] }
				: null;
		},
		write: (value) =>
			({
				[key]: value?.values[0] ? value.values[0] === "true" : undefined,
			}) as Partial<S>,
	};
}

/** Free-text field written into a single search key. */
export function textField<S>(
	id: string,
	label: string,
	icon: FilterField<S>["icon"],
	key: keyof S,
	placeholder?: string,
): FilterField<S> {
	return {
		id,
		label,
		icon,
		type: "text",
		operators: [OP_CONTAINS],
		placeholder,
		read: (search) => {
			const current = search[key];
			return typeof current === "string" && current.length > 0
				? { operator: "contains", values: [current] }
				: null;
		},
		write: (value) =>
			({ [key]: value?.values[0]?.trim() || undefined }) as Partial<S>,
	};
}

/**
 * Date range over two `YYYY-MM-DD` keys. The operator decides which bound a
 * single value fills: "is on or after" writes the lower one, "is on or before"
 * the upper one, "is between" both.
 */
export function dateRangeField<S>(
	id: string,
	label: string,
	icon: FilterField<S>["icon"],
	fromKey: keyof S,
	toKey: keyof S,
): FilterField<S> {
	const show = (iso: string | undefined) =>
		iso ? formatDateValue(iso, "day") : "…";

	return {
		id,
		label,
		icon,
		type: "dateRange",
		operators: DATE_RANGE_OPERATORS,
		read: (search) => {
			const from = search[fromKey];
			const to = search[toKey];
			const hasFrom = typeof from === "string" && from.length > 0;
			const hasTo = typeof to === "string" && to.length > 0;
			if (hasFrom && hasTo) {
				return { operator: "between", values: [from, to] };
			}
			if (hasFrom) {
				return { operator: "after", values: [from as string] };
			}
			if (hasTo) {
				return { operator: "before", values: [to as string] };
			}
			return null;
		},
		write: (value) => {
			if (!value) {
				return { [fromKey]: undefined, [toKey]: undefined } as Partial<S>;
			}
			if (value.operator === "after") {
				return {
					[fromKey]: value.values[0] || undefined,
					[toKey]: undefined,
				} as Partial<S>;
			}
			if (value.operator === "before") {
				return {
					[fromKey]: undefined,
					[toKey]: value.values[0] || undefined,
				} as Partial<S>;
			}
			return {
				[fromKey]: value.values[0] || undefined,
				[toKey]: value.values[1] || undefined,
			} as Partial<S>;
		},
		format: (value: FilterValue) =>
			value.operator === "between"
				? `${show(value.values[0])} → ${show(value.values[1])}`
				: show(value.values[0]),
	};
}
