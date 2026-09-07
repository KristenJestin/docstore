import { Skeleton } from "@docstore/ui/components/skeleton";
import { cn } from "@docstore/ui/lib/utils";
import type { ReactNode } from "react";

import { MonoLabel } from "./mono-label";
import { Pagination, type PaginationProps } from "./pagination";

/** Allowed widths, expressed in twelfths of the row grid. */
const SPAN_CLASSES = {
	1: "col-span-1",
	2: "col-span-2",
	3: "col-span-3",
	4: "col-span-4",
	5: "col-span-5",
	6: "col-span-6",
	7: "col-span-7",
	8: "col-span-8",
	9: "col-span-9",
	10: "col-span-10",
	11: "col-span-11",
	12: "col-span-12",
} as const;

export type DataListSpan = keyof typeof SPAN_CLASSES;

export interface DataListColumn<T> {
	id: string;
	/** Column header (rendered as a `MonoLabel`). */
	header?: ReactNode;
	/** Width in twelfths (default: 3). */
	span?: DataListSpan;
	align?: "start" | "end";
	/** Hides the column below the `lg` breakpoint. */
	hideBelowLg?: boolean;
	cell: (item: T) => ReactNode;
}

export interface DataListProps<T> {
	items: T[] | undefined;
	columns: DataListColumn<T>[];
	getKey: (item: T) => string;
	isLoading?: boolean;
	/** Makes every row clickable (mouse + Enter / Space). */
	onRowClick?: (item: T) => void;
	/** Accessible row label, used when the row is clickable. */
	getRowLabel?: (item: T) => string;
	/** Block shown when the list is empty (typically an `EmptyState`). */
	empty?: ReactNode;
	/**
	 * Control rendered before the grid, outside the clickable area: this is
	 * where the multi-selection checkbox goes.
	 */
	rowLeading?: (item: T) => ReactNode;
	/** Matching control in the header bar ("select all"). */
	headerLeading?: ReactNode;
	/** Hides the column header bar. */
	hideHeader?: boolean;
	skeletonRows?: number;
	pagination?: Omit<PaginationProps, "className">;
	className?: string;
}

function columnClasses<T>(column: DataListColumn<T>): string {
	return cn(
		SPAN_CLASSES[column.span ?? 3],
		column.align === "end" && "flex justify-end text-right",
		column.hideBelowLg && "hidden lg:block",
	);
}

/**
 * Dense list of clickable rows with declarative columns (12-column grid), laid
 * inside a double-rimmed card (`.shell` + core). 56 px rows, mono column
 * headers on a `muted` background. Row actions are revealed on hover through
 * the `row` group: `opacity-0 transition-opacity group-hover/row:opacity-100`.
 * Handles the loading state (`Skeleton`), the empty state and pagination.
 */
export function DataList<T>({
	items,
	columns,
	getKey,
	isLoading = false,
	onRowClick,
	getRowLabel,
	empty,
	rowLeading,
	headerLeading,
	hideHeader = false,
	skeletonRows = 6,
	pagination,
	className,
}: DataListProps<T>) {
	const showEmpty = !isLoading && (items?.length ?? 0) === 0;
	const hasLeading = Boolean(rowLeading);

	return (
		<div className={cn("shell mx-6 my-6 lg:mx-8", className)}>
			<div className="overflow-hidden rounded-xl bg-card shadow-soft ring-1 ring-border">
				{hideHeader ? null : (
					<div className="flex items-center gap-3 border-border border-b bg-muted/40 px-4 py-2">
						{hasLeading ? (
							<div className="flex w-5 shrink-0 items-center justify-center">
								{headerLeading}
							</div>
						) : null}
						<div className="grid min-w-0 flex-1 grid-cols-12 items-center gap-4">
							{columns.map((column) => (
								<div key={column.id} className={columnClasses(column)}>
									{column.header ? (
										<MonoLabel>{column.header}</MonoLabel>
									) : null}
								</div>
							))}
						</div>
					</div>
				)}

				{isLoading ? (
					<div className="divide-y divide-border">
						{Array.from({ length: skeletonRows }, (_, index) => index).map(
							(index) => (
								<div key={index} className="flex h-14 items-center gap-3 px-4">
									{hasLeading ? <div className="w-5 shrink-0" /> : null}
									<div className="grid min-w-0 flex-1 grid-cols-12 items-center gap-4">
										{columns.map((column) => (
											<div key={column.id} className={columnClasses(column)}>
												<Skeleton className="h-4 w-full max-w-40" />
											</div>
										))}
									</div>
								</div>
							),
						)}
					</div>
				) : null}

				{showEmpty ? <div className="p-3">{empty}</div> : null}

				{!isLoading && items && items.length > 0 ? (
					<div className="divide-y divide-border">
						{items.map((item) => {
							const cells = columns.map((column) => (
								<div
									key={column.id}
									className={cn(columnClasses(column), "min-w-0")}
								>
									{column.cell(item)}
								</div>
							));
							const gridClass =
								"grid h-14 min-w-0 flex-1 grid-cols-12 items-center gap-4 text-left";

							return (
								<div
									key={getKey(item)}
									className={cn(
										"group/row flex items-center gap-3 px-4 transition-colors duration-200 ease-premium",
										onRowClick && "focus-within:bg-accent hover:bg-muted/70",
									)}
								>
									{rowLeading ? (
										<div className="flex w-5 shrink-0 items-center justify-center">
											{rowLeading(item)}
										</div>
									) : null}
									{onRowClick ? (
										<button
											type="button"
											aria-label={getRowLabel?.(item)}
											onClick={() => onRowClick(item)}
											className={cn(gridClass, "cursor-pointer outline-none")}
										>
											{cells}
										</button>
									) : (
										<div className={gridClass}>{cells}</div>
									)}
								</div>
							);
						})}
					</div>
				) : null}

				{pagination && !isLoading && (items?.length ?? 0) > 0 ? (
					<Pagination {...pagination} />
				) : null}
			</div>
		</div>
	);
}
