import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@docstore/ui/components/sheet";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CheckIcon,
	ChevronRightIcon,
	RefreshCwIcon,
	Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import {
	approvalBlockedReason,
	REVIEW_REASON_LABELS,
} from "@/components/documents/document-labels";
import { DocumentMetaPanel } from "@/components/documents/document-meta-panel";
import { FileFrame } from "@/components/documents/document-preview";
import { MonoLabel } from "@/components/mono-label";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

import {
	REVIEW_REJECT_ATTRIBUTE,
	ReviewAssignments,
} from "./review-assignments";

export interface ReviewSheetProps {
	documentId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Moves the selection inside the queue (`j` / `k`). */
	onNext: () => void;
	onPrevious: () => void;
	/** Called after "Approve & next": closes or advances. */
	onApproved: (next: boolean) => void;
	hasNext: boolean;
}

/**
 * Review panel of one document: preview, automatic assignments to keep or
 * reject, the full editable metadata, then approve / reprocess / trash.
 * Shortcuts: `j` and `k` walk the queue, `a` approves, `r` jumps to the first
 * rejection, `Esc` closes.
 */
export function ReviewSheet({
	documentId,
	open,
	onOpenChange,
	onNext,
	onPrevious,
	onApproved,
	hasNext,
}: ReviewSheetProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();

	const document_ = useQuery({
		...orpc.document.get.queryOptions({ input: { id: documentId ?? "" } }),
		enabled: open && Boolean(documentId),
	});

	const approve = useMutation(orpc.review.approve.mutationOptions());
	const requeue = useMutation(orpc.review.requeue.mutationOptions());
	const trash = useMutation(orpc.document.trash.mutationOptions());

	const detail = document_.data ?? null;

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.document.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.review.key() }),
		]);

	/** `null` while the document can be approved (see `approvalBlockedReason`). */
	const approvalBlocked = detail ? approvalBlockedReason(detail.status) : null;

	const onApprove = async (advance: boolean) => {
		if (!documentId || approvalBlocked) {
			return;
		}
		try {
			await approve.mutateAsync({ id: documentId });
			await invalidate();
			toast.success("Document approved.");
			onApproved(advance);
		} catch (error) {
			toastApiError(error, "The document could not be approved.");
		}
	};

	const onRequeue = async () => {
		if (!documentId) {
			return;
		}
		try {
			await requeue.mutateAsync({ id: documentId });
			await invalidate();
			toast.success("Analysis restarted.");
		} catch (error) {
			toastApiError(error, "The analysis could not be restarted.");
		}
	};

	const onTrash = async () => {
		if (!documentId) {
			return;
		}
		const ok = await confirm({
			title: "Move this document to the trash?",
			description: 'It stays restorable from the "Trash" filter.',
			confirmLabel: "Move to trash",
		});
		if (!ok) {
			return;
		}
		try {
			await trash.mutateAsync({ id: documentId });
			await invalidate();
			toast.success("Document moved to the trash.");
			onApproved(false);
		} catch (error) {
			toastApiError(error, "The operation failed.");
		}
	};

	useHotkeys(
		[
			{ keys: "j", handler: onNext, description: "Next document" },
			{ keys: "k", handler: onPrevious, description: "Previous document" },
			{
				keys: "a",
				handler: () => void onApprove(true),
				description: "Approve and move on",
			},
			{
				keys: "r",
				handler: () => {
					const button = window.document.querySelector<HTMLButtonElement>(
						`[${REVIEW_REJECT_ATTRIBUTE}]`,
					);
					button?.focus();
				},
				description: "Focus the first rejection",
			},
		],
		open,
	);

	const previewFile = detail?.files[0] ?? null;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				size="xl"
				className="w-full gap-0"
				aria-label="Review document"
			>
				<SheetHeader className="shrink-0 border-border border-b px-6 py-5">
					<SheetTitle>{detail?.title ?? "Loading…"}</SheetTitle>
					<SheetDescription>
						Check what was filled in automatically, correct it, then approve.
					</SheetDescription>
					{detail && detail.reviewReasons.length > 0 ? (
						<div className="mt-2 flex flex-wrap gap-1">
							{detail.reviewReasons.map((reason) => (
								<Badge
									key={`${reason.code}:${reason.field ?? ""}`}
									tone="warning"
									title={reason.message}
								>
									{REVIEW_REASON_LABELS[reason.code]}
								</Badge>
							))}
						</div>
					) : null}
				</SheetHeader>

				<div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-6 lg:grid-cols-2">
					{/*
					 * The preview sticks to the top of the scrolling area while the
					 * assignments and the metadata panel scroll next to it.
					 */}
					<div className="flex flex-col gap-4 lg:sticky lg:top-0 lg:h-fit">
						{document_.isLoading ? (
							<Skeleton className="h-160 w-full" />
						) : previewFile ? (
							<div className="overflow-hidden rounded-xl ring-1 ring-border">
								{/* Same renderer as the document page: an image in a bare
								    iframe was shown at its natural size and overflowed. */}
								<FileFrame file={previewFile} />
							</div>
						) : (
							<p className="text-muted-foreground text-sm">
								This document has no file to preview.
							</p>
						)}
						{detail ? (
							<Link
								to="/documents/$documentId"
								params={{ documentId: detail.id }}
								className="text-muted-foreground text-xs hover:underline"
							>
								Open the full document page
							</Link>
						) : null}
					</div>

					<div className="flex min-w-0 flex-col gap-5">
						{detail ? (
							<>
								<Card>
									<CardHeader>
										<MonoLabel>Automatic assignments</MonoLabel>
									</CardHeader>
									<CardContent>
										<ReviewAssignments document={detail} />
									</CardContent>
								</Card>
								<DocumentMetaPanel document={detail} />
							</>
						) : (
							<Skeleton className="h-96 w-full" />
						)}
					</div>
				</div>

				<SheetFooter className="shrink-0 flex-row flex-wrap items-center justify-end gap-2 border-border border-t px-6 py-4">
					{/*
					 * A document still in the pipeline, or one it gave up on, cannot be
					 * approved: the API answers `CONFLICT`. The panel says why and
					 * points at "Reprocess" rather than letting the click fail.
					 */}
					{approvalBlocked ? (
						<p
							data-testid="review-approval-blocked"
							className="mr-auto text-muted-foreground text-xs"
						>
							{approvalBlocked}
						</p>
					) : null}
					<Button variant="ghost" onClick={onTrash} disabled={!detail}>
						<Trash2Icon />
						Trash
					</Button>
					<Button variant="outline" onClick={onRequeue} disabled={!detail}>
						<RefreshCwIcon />
						Reprocess
					</Button>
					<Button
						data-testid="review-approve"
						variant="outline"
						onClick={() => onApprove(false)}
						disabled={!detail || approve.isPending || approvalBlocked !== null}
					>
						<CheckIcon />
						Approve
					</Button>
					<Button
						data-testid="review-approve-next"
						onClick={() => onApprove(true)}
						disabled={
							!detail ||
							approve.isPending ||
							!hasNext ||
							approvalBlocked !== null
						}
					>
						Approve &amp; next
						<ChevronRightIcon />
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
