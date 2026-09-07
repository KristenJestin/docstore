import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Declarative filter model shared by every list screen (`FilterBar`).
 *
 * A field says what it is (label, icon, kind of value), which operators it
 * accepts and — the only page-specific part — how it reads itself from the URL
 * search object and writes itself back. Nothing here talks to the API: the
 * options of a reference field (party, category, tag…) are resolved by the page
 * through the hooks of `use-filter-options.ts` and handed over as plain data.
 */

export type FilterFieldType =
	| "text"
	| "select"
	| "multiSelect"
	| "date"
	| "dateRange"
	| "number"
	| "boolean";

/** One entry of a `select` / `multiSelect` / `boolean` field. */
export interface FilterOption {
	value: string;
	label: string;
	/** Small mark drawn before the label (avatar, colour dot, icon…). */
	adornment?: ReactNode;
	/** Extra words matched by the search box of the value editor. */
	keywords?: string;
	/** Indentation level, for a tree of categories. */
	depth?: number;
}

export interface FilterOperator {
	id: string;
	/** Lowercase, it reads inside the pill: "Category · is · Invoice". */
	label: string;
	/** Number of values the editor collects. */
	arity: 0 | 1 | 2;
}

/** Operator plus its operands; `values` is always the serialised form. */
export interface FilterValue {
	operator: string;
	values: string[];
}

export interface FilterField<S> {
	id: string;
	label: string;
	icon: LucideIcon;
	type: FilterFieldType;
	/** Offered operators; the first one is the default. */
	operators: FilterOperator[];
	/** Choices of a `select`, `multiSelect` or `boolean` field. */
	options?: FilterOption[];
	optionsLoading?: boolean;
	placeholder?: string;
	/** Current value, or `null` when the filter is not active. */
	read: (search: S) => FilterValue | null;
	/** Patch applied to the search; `null` clears the filter. */
	write: (value: FilterValue | null) => Partial<S>;
	/** Overrides the pill text (dates, ranges…). */
	format?: (value: FilterValue) => string;
}

/* ------------------------------------------------------------------ */
/* Operator presets                                                     */
/* ------------------------------------------------------------------ */

export const OP_IS: FilterOperator = { id: "is", label: "is", arity: 1 };
export const OP_CONTAINS: FilterOperator = {
	id: "contains",
	label: "contains",
	arity: 1,
};
export const OP_HAS_ALL: FilterOperator = {
	id: "hasAll",
	label: "has all of",
	arity: 1,
};
export const OP_BETWEEN: FilterOperator = {
	id: "between",
	label: "is between",
	arity: 2,
};
export const OP_AFTER: FilterOperator = {
	id: "after",
	label: "is on or after",
	arity: 1,
};
export const OP_BEFORE: FilterOperator = {
	id: "before",
	label: "is on or before",
	arity: 1,
};

/** Operators of a date range field, in the order of the menu. */
export const DATE_RANGE_OPERATORS: FilterOperator[] = [
	OP_BETWEEN,
	OP_AFTER,
	OP_BEFORE,
];

/** Yes / No choices of a `boolean` field. */
export const BOOLEAN_OPTIONS: FilterOption[] = [
	{ value: "true", label: "Yes" },
	{ value: "false", label: "No" },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** Operator of a value, falling back to the default one of the field. */
export function operatorOf<S>(
	field: FilterField<S>,
	value: FilterValue,
): FilterOperator {
	return (
		field.operators.find((item) => item.id === value.operator) ??
		field.operators[0]
	);
}

/** Blank value of a field: its default operator and no operand yet. */
export function emptyValue<S>(field: FilterField<S>): FilterValue {
	return { operator: field.operators[0].id, values: [] };
}

/** `true` once the value carries everything its operator needs. */
export function isComplete<S>(
	field: FilterField<S>,
	value: FilterValue,
): boolean {
	const operator = operatorOf(field, value);
	const filled = value.values.filter((item) => item.length > 0);
	if (field.type === "multiSelect") {
		return filled.length > 0;
	}
	return filled.length >= operator.arity;
}

/** Label of an option, falling back to the raw value. */
export function optionLabel<S>(field: FilterField<S>, value: string): string {
	return (
		field.options?.find((option) => option.value === value)?.label ?? value
	);
}

/** Text shown in the value slot of a pill. */
export function formatValue<S>(
	field: FilterField<S>,
	value: FilterValue,
): string {
	if (field.format) {
		return field.format(value);
	}
	const labels = value.values.map((item) => optionLabel(field, item));
	if (labels.length === 0) {
		return "…";
	}
	if (labels.length <= 2) {
		return labels.join(" and ");
	}
	return `${labels.length} selected`;
}

/** Active fields of a search, in the declaration order. */
export function activeFilters<S>(
	fields: FilterField<S>[],
	search: S,
): { field: FilterField<S>; value: FilterValue }[] {
	const active: { field: FilterField<S>; value: FilterValue }[] = [];
	for (const field of fields) {
		const value = field.read(search);
		if (value) {
			active.push({ field, value });
		}
	}
	return active;
}
