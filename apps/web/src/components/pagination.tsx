import { Button } from "@docstore/ui/components/button";
import { cn } from "@docstore/ui/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { plural } from "@/lib/plural";

export interface PaginationProps {
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
	onPageChange: (page: number) => void;
	/** Singular name of the counted object ("document", "party"). */
	itemLabel?: string;
	itemLabelPlural?: string;
	className?: string;
}

/** List footer: mono counter on the left, previous / next on the right. */
export function Pagination({
	page,
	pageSize,
	total,
	totalPages,
	onPageChange,
	itemLabel = "result",
	itemLabelPlural,
	className,
}: PaginationProps) {
	const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const last = Math.min(page * pageSize, total);
	const noun = plural(total, itemLabel, itemLabelPlural);

	return (
		<div
			className={cn(
				"flex items-center justify-between gap-4 border-border border-t bg-muted/40 px-4 py-2.5",
				className,
			)}
		>
			<p className="font-mono text-muted-foreground text-xs tabular-nums">
				{total === 0
					? `No ${itemLabel}`
					: `${first}–${last} of ${total} ${noun}`}
			</p>
			<div className="flex items-center gap-1">
				<Button
					variant="outline"
					size="icon-sm"
					aria-label="Previous page"
					disabled={page <= 1}
					onClick={() => onPageChange(page - 1)}
				>
					<ChevronLeftIcon />
				</Button>
				<span className="px-2 font-mono text-muted-foreground text-xs tabular-nums">
					{page} / {Math.max(totalPages, 1)}
				</span>
				<Button
					variant="outline"
					size="icon-sm"
					aria-label="Next page"
					disabled={page >= totalPages}
					onClick={() => onPageChange(page + 1)}
				>
					<ChevronRightIcon />
				</Button>
			</div>
		</div>
	);
}
