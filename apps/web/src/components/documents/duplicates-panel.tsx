import type {
	DatePrecision,
	DocumentDuplicate,
	DuplicateReason,
} from "@docstore/shared/document";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { Switch } from "@docstore/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CopyCheckIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { DateText } from "@/components/date-text";
import { DocumentThumbnail } from "@/components/documents/document-thumbnail";
import { EmptyState } from "@/components/empty-state";
import { MonoLabel } from "@/components/mono-label";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

/** Why the pair is flagged. */
export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
	sameOriginalHash: "Identical file",
	sameTitleAndDate: "Same title and date",
};

function pairKey(pair: DocumentDuplicate): string {
	return `${pair.documentId}:${pair.duplicateOfId}`;
}

/**
 * "Duplicates" panel of `/documents`: pairs returned by `document.duplicates`
 * with their reason, then "Merge into" (`document.mergeAsVersion`) or "Ignore"
 * (`document.ignoreDuplicate`, persisted server side). "Show ignored" brings the
 * dismissed pairs back with an "Unignore" button.
 */
export function DuplicatesPanel({ onClose }: { onClose: () => void }) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const ids = useId();
	const [includeIgnored, setIncludeIgnored] = useState(false);

	const duplicates = useQuery(
		orpc.document.duplicates.queryOptions({ input: { includeIgnored } }),
	);
	const merge = useMutation(orpc.document.mergeAsVersion.mutationOptions());
	const ignore = useMutation(orpc.document.ignoreDuplicate.mutationOptions());
	const unignore = useMutation(
		orpc.document.unignoreDuplicate.mutationOptions(),
	);

	const pairs = duplicates.data ?? [];

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.document.key() });

	const onMerge = async (pair: DocumentDuplicate) => {
		const ok = await confirm({
			title: "Merge this duplicate?",
			description:
				"The files of the duplicate are moved as attachments, a “version of” relation is recorded and the duplicate goes to the trash.",
			confirmLabel: "Merge",
		});
		if (!ok) {
			return;
		}
		try {
			await merge.mutateAsync({
				documentId: pair.documentId,
				intoDocumentId: pair.duplicateOfId,
			});
			await invalidate();
			toast.success("Duplicate merged as a version.");
		} catch (error) {
			toastApiError(error, "The duplicate could not be merged.");
		}
	};

	const onIgnore = async (pair: DocumentDuplicate) => {
		try {
			await ignore.mutateAsync({
				documentId: pair.documentId,
				otherDocumentId: pair.duplicateOfId,
			});
			await invalidate();
			toast.success("Pair ignored.");
		} catch (error) {
			toastApiError(error, "The pair could not be ignored.");
		}
	};

	const onUnignore = async (pair: DocumentDuplicate) => {
		try {
			await unignore.mutateAsync({
				documentId: pair.documentId,
				otherDocumentId: pair.duplicateOfId,
			});
			await invalidate();
			toast.success("Pair reported again.");
		} catch (error) {
			toastApiError(error, "The pair could not be restored.");
		}
	};

	return (
		<div className="shell mx-6 mt-6 lg:mx-8">
			<div className="overflow-hidden rounded-xl bg-card shadow-soft ring-1 ring-border">
				<div className="flex flex-wrap items-center gap-2 border-border border-b px-4 py-3">
					<CopyCheckIcon
						aria-hidden
						className="size-4 text-muted-foreground"
						strokeWidth={1.5}
					/>
					<MonoLabel>Duplicates</MonoLabel>
					<p className="text-muted-foreground text-xs">
						Pairs sharing a file or a title and a date.
					</p>
					<div className="ml-auto flex items-center gap-2">
						<label
							htmlFor={`${ids}-ignored`}
							className="text-muted-foreground text-xs"
						>
							Show ignored
						</label>
						<Switch
							id={`${ids}-ignored`}
							aria-label="Show ignored"
							checked={includeIgnored}
							onCheckedChange={setIncludeIgnored}
						/>
						<Button variant="ghost" size="sm" onClick={onClose}>
							Hide
						</Button>
					</div>
				</div>

				{duplicates.isLoading ? (
					<div className="flex flex-col gap-2 p-4">
						{[0, 1].map((index) => (
							<Skeleton key={index} className="h-12 w-full" />
						))}
					</div>
				) : pairs.length === 0 ? (
					<div className="p-3">
						<EmptyState
							size="sm"
							title="No duplicate"
							description="Every document in the library looks unique."
						/>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{pairs.map((pair) => (
							<li
								key={pairKey(pair)}
								className="flex flex-wrap items-center gap-3 px-4 py-3"
							>
								<div className="flex min-w-0 flex-1 items-center gap-2">
									<DuplicateSide
										documentId={pair.documentId}
										title={pair.title}
										documentDate={pair.documentDate}
										datePrecision={pair.datePrecision}
										thumbnailFileId={pair.thumbnailFileId}
									/>
									<ArrowRightIcon
										aria-hidden
										className="size-4 shrink-0 text-muted-foreground"
									/>
									<DuplicateSide
										documentId={pair.duplicateOfId}
										title={pair.duplicateOfTitle}
										documentDate={pair.duplicateOfDate}
										datePrecision={pair.duplicateOfDatePrecision}
										thumbnailFileId={pair.duplicateOfThumbnailFileId}
									/>
								</div>
								<Badge tone="warning">
									{DUPLICATE_REASON_LABELS[pair.reason]}
								</Badge>
								{pair.ignored ? <Badge tone="neutral">Ignored</Badge> : null}
								<Button
									variant="outline"
									size="sm"
									onClick={() => onMerge(pair)}
								>
									Merge into
								</Button>
								{pair.ignored ? (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => onUnignore(pair)}
									>
										Unignore
									</Button>
								) : (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => onIgnore(pair)}
									>
										Ignore
									</Button>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

/** One side of a pair: everything comes from `document.duplicates`. */
function DuplicateSide({
	documentId,
	title,
	documentDate,
	datePrecision,
	thumbnailFileId,
}: {
	documentId: string;
	title: string;
	documentDate: string | null;
	datePrecision: DatePrecision | null;
	thumbnailFileId: string | null;
}) {
	return (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			<DocumentThumbnail fileId={thumbnailFileId} size="sm" />
			<div className="min-w-0">
				<Link
					to="/documents/$documentId"
					params={{ documentId }}
					className="block truncate text-sm hover:underline"
				>
					{title}
				</Link>
				{documentDate ? (
					<DateText value={documentDate} precision={datePrecision} />
				) : null}
			</div>
		</div>
	);
}
