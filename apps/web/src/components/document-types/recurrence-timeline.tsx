import type { RecurrencePeriod } from "@docstore/shared/recurrence";
import { cn } from "@docstore/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import { EmptyState } from "@/components/empty-state";

import { PERIOD_STATUS_LABELS } from "./document-type-labels";

/** Background and rim of a cell, by period status. */
const STATUS_CLASSES: Record<RecurrencePeriod["status"], string> = {
	present: "bg-tone-success text-tone-success-foreground",
	missing: "bg-tone-danger text-tone-danger-foreground",
	pending: "bg-muted text-muted-foreground",
};

export interface RecurrenceTimelineProps {
	timeline: RecurrencePeriod[];
}

/**
 * Period-by-period grid of a recurring document type: a filled period links to
 * its document, a missing one is red, a period that is not due yet stays muted.
 */
export function RecurrenceTimeline({ timeline }: RecurrenceTimelineProps) {
	if (timeline.length === 0) {
		return (
			<EmptyState
				size="sm"
				title="No period"
				description="The first period of this document type is in the future."
			/>
		);
	}

	return (
		<ul
			data-testid="recurrence-timeline"
			className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
		>
			{timeline.map((period, index) => {
				const body = (
					<>
						<span className="font-mono font-semibold text-sm tabular-nums">
							{period.period}
						</span>
						<span className="mt-0.5 block truncate text-xs opacity-80">
							{period.status === "present"
								? (period.documentTitle ?? "Filed")
								: PERIOD_STATUS_LABELS[period.status]}
						</span>
					</>
				);
				const frame = cn(
					"inset-ring inset-ring-current/20 row-in block w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-200 ease-premium",
					STATUS_CLASSES[period.status],
				);
				// Staggered fade-in, capped so a long timeline never crawls in.
				const delay = { animationDelay: `${Math.min(index, 12) * 20}ms` };

				return (
					<li key={period.period}>
						{period.status === "present" && period.documentId ? (
							<Link
								to="/documents/$documentId"
								params={{ documentId: period.documentId }}
								aria-label={`Open the document of period ${period.period}`}
								style={delay}
								className={cn(frame, "hover:opacity-80")}
							>
								{body}
							</Link>
						) : (
							<div
								className={frame}
								style={delay}
								title={`Due on ${period.dueDate}`}
							>
								{body}
							</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}
