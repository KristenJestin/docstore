import type { CategoryNode } from "@docstore/shared/category";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@docstore/ui/components/combobox";
import { cn } from "@docstore/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { orpc } from "@/utils/orpc";

/** Flattened category: depth drives indentation, path drives search. */
export interface CategoryOption {
	id: string;
	name: string;
	color: string | null;
	depth: number;
	/** "Invoice › Subscription". */
	path: string;
	documentCount: number;
}

function flatten(
	nodes: CategoryNode[],
	parentPath: string,
	out: CategoryOption[],
): void {
	for (const node of nodes) {
		const path = parentPath ? `${parentPath} › ${node.name}` : node.name;
		out.push({
			id: node.id,
			name: node.name,
			color: node.color,
			depth: node.depth,
			path,
			documentCount: node.documentCount,
		});
		flatten(node.children, path, out);
	}
}

/**
 * Category tree flattened into an ordered list (parents before children),
 * shared by the picker, the filters and the full-path display.
 */
export function useCategoryOptions(): {
	options: CategoryOption[];
	byId: Map<string, CategoryOption>;
	isLoading: boolean;
} {
	const categories = useQuery(orpc.category.list.queryOptions({ input: {} }));

	return useMemo(() => {
		const options: CategoryOption[] = [];
		flatten(categories.data ?? [], "", options);
		return {
			options,
			byId: new Map(options.map((option) => [option.id, option])),
			isLoading: categories.isLoading,
		};
	}, [categories.data, categories.isLoading]);
}

/** Walks the tree down to `id`, collecting the ids met on the way. */
function lineageOf(
	nodes: CategoryNode[],
	id: string,
	trail: string[],
): string[] | null {
	for (const node of nodes) {
		const path = [...trail, node.id];
		if (node.id === id) {
			return path;
		}
		const found = lineageOf(node.children, id, path);
		if (found) {
			return found;
		}
	}
	return null;
}

/**
 * A category **and its ancestors**, root first.
 *
 * This is what a category-scoped custom field is checked against: a field
 * offered on a parent category stays offered on its children (SPEC §2, mirrored
 * by `customFieldCategoryIssue`).
 */
export function useCategoryLineage(categoryId: string | null): string[] {
	const categories = useQuery(orpc.category.list.queryOptions({ input: {} }));

	return useMemo(() => {
		if (!categoryId) {
			return [];
		}
		return lineageOf(categories.data ?? [], categoryId, []) ?? [categoryId];
	}, [categories.data, categoryId]);
}

/** Indentation of one tree level (maximum depth: 3). */
const DEPTH_CLASSES = ["", "pl-6", "pl-10"] as const;

export interface CategoryPickerProps {
	value: string | null;
	onValueChange: (categoryId: string | null) => void;
	placeholder?: string;
	/** Accessible label of the field. */
	label?: string;
	id?: string;
	className?: string;
}

/**
 * Tree combobox of categories: descendants are indented and the query filters
 * on the full path. Clearing the field removes the category.
 */
export function CategoryPicker({
	value,
	onValueChange,
	placeholder = "Choose a category…",
	label = "Category",
	id,
	className,
}: CategoryPickerProps) {
	const { options, byId } = useCategoryOptions();
	const selected = value ? (byId.get(value) ?? null) : null;

	return (
		<Combobox
			items={options}
			value={selected}
			onValueChange={(next: CategoryOption | null) =>
				onValueChange(next?.id ?? null)
			}
			itemToStringLabel={(item: CategoryOption) => item.path}
			isItemEqualToValue={(item: CategoryOption, current: CategoryOption) =>
				item.id === current.id
			}
		>
			<ComboboxInput
				id={id}
				placeholder={placeholder}
				aria-label={label}
				showClear
				className={cn("w-full", className)}
			/>
			<ComboboxContent>
				<ComboboxEmpty>No category found.</ComboboxEmpty>
				<ComboboxList>
					{(item: CategoryOption) => (
						<ComboboxItem key={item.id} value={item}>
							<span
								className={cn(
									"min-w-0 flex-1 truncate",
									DEPTH_CLASSES[item.depth - 1],
								)}
							>
								{item.name}
							</span>
							<span className="font-mono text-muted-foreground text-xs tabular-nums">
								{item.documentCount}
							</span>
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
