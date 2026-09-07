import type { DocumentTypeDetail } from "@docstore/shared/document-type";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarArrowUpIcon, MinusIcon } from "lucide-react";
import { toast } from "sonner";

import { MonoLabel } from "@/components/mono-label";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

export interface OutOfRangeNoticeProps {
	detail: DocumentTypeDetail;
}

/**
 * Members older than `startPeriod` (`documentType.get().outOfRange`).
 *
 * They belong to the type but sit before the window the timeline enumerates, so
 * nothing else would ever show them (`docs/document-types.md` §2). Each row
 * offers the two ways out: widen the recurrence down to that period, or exclude
 * the document from it.
 */
export function OutOfRangeNotice({ detail }: OutOfRangeNoticeProps) {
	const update = useMutation(orpc.documentType.update.mutationOptions());
	const setOverride = useMutation(
		orpc.documentType.setDocumentOverride.mutationOptions(),
	);

	if (detail.outOfRange.length === 0 || detail.periodicity === null) {
		return null;
	}

	const periodicity = detail.periodicity;
	const busy = update.isPending || setOverride.isPending;

	/** Moves `startPeriod` down to the period of the document. */
	const extendTo = async (periodStart: string, period: string) => {
		try {
			// `update` takes the recurrence as a whole: the untouched fields are
			// sent back as they are.
			await update.mutateAsync({
				id: detail.id,
				recurrence: {
					periodicity,
					startPeriod: periodStart,
					endPeriod: detail.endPeriod,
					expectedDay: detail.expectedDay,
					graceDays: detail.graceDays ?? undefined,
				},
			});
			toast.success(`First period moved to ${period}.`);
		} catch (error) {
			toastApiError(error, "The first period could not be changed.");
		}
	};

	const exclude = async (documentId: string) => {
		try {
			await setOverride.mutateAsync({
				documentTypeId: detail.id,
				documentId,
				included: false,
			});
			toast.success("Document excluded from the recurrence.");
		} catch (error) {
			toastApiError(error, "The membership could not be changed.");
		}
	};

	return (
		<Card data-testid="out-of-range">
			<CardHeader className="flex flex-wrap items-center justify-between gap-2">
				<MonoLabel>Out of range</MonoLabel>
				<Badge tone="warning">
					{countLabel(detail.outOfRange.length, "document")}
				</Badge>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<p className="text-muted-foreground text-xs">
					These documents belong to the type but fall before its first period (
					{detail.startPeriod ?? "—"}), so the timeline never shows them.
				</p>
				<ul className="flex flex-col gap-2">
					{detail.outOfRange.map((item) => (
						<li
							key={item.documentId}
							className="row-in flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 ring-1 ring-border"
						>
							<Link
								to="/documents/$documentId"
								params={{ documentId: item.documentId }}
								className="min-w-0 flex-1 truncate font-semibold text-sm hover:underline"
							>
								{item.title}
							</Link>
							<Badge tone="outline">{item.period}</Badge>
							<Button
								variant="outline"
								size="sm"
								disabled={busy}
								onClick={() => extendTo(item.periodStart, item.period)}
							>
								<CalendarArrowUpIcon />
								Extend start period to {item.period}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								aria-label={`Exclude ${item.title} from the recurrence`}
								onClick={() => exclude(item.documentId)}
							>
								<MinusIcon />
								Exclude
							</Button>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
