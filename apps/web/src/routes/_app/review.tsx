import type { ReviewItem } from "@docstore/shared/review";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Checkbox } from "@docstore/ui/components/checkbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckIcon, InboxIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { DataList } from "@/components/data-list";
import { DateText } from "@/components/date-text";
import {
	formatConfidence,
	REVIEW_REASON_LABELS,
} from "@/components/documents/document-labels";
import { DocumentTitleCell } from "@/components/documents/document-row";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
	hasReviewFilters,
	matchesReviewFilters,
	ReviewFilters,
	type ReviewSearch,
	reviewSearchSchema,
} from "@/components/review/review-filters";
import { ReviewSheet } from "@/components/review/review-sheet";
import { toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

/** Page size of the review queue. */
const PAGE_SIZE = 25;

/**
 * `review.list` carries no filter: when one is on, the queue is loaded in one
 * large page and narrowed here. A household review queue never gets longer.
 */
const FILTERED_PAGE_SIZE = 100;

export const Route = createFileRoute("/_app/review")({
	component: ReviewPage,
	validateSearch: (search): ReviewSearch => reviewSearchSchema.parse(search),
});

/** Lowest confidence carried by the review reasons, `null` when there is none. */
function lowestConfidence(item: ReviewItem): number | null {
	const scores = item.reviewReasons
		.map((reason) => reason.confidence)
		.filter((score): score is number => typeof score === "number");
	return scores.length > 0 ? Math.min(...scores) : null;
}

function ReviewPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const queryClient = useQueryClient();
	const [selected, setSelected] = useState<string[]>([]);
	const [openId, setOpenId] = useState<string | null>(null);

	const filtered = hasReviewFilters(search);
	const page = search.page ?? 1;

	const setSearch = useCallback(
		(patch: Partial<ReviewSearch>) => {
			navigate({
				search: (current) => ({ ...current, ...patch, page: undefined }),
				replace: true,
			});
			setSelected([]);
		},
		[navigate],
	);

	const review = useQuery(
		orpc.review.list.queryOptions({
			input: {
				page: filtered ? 1 : page,
				pageSize: filtered ? FILTERED_PAGE_SIZE : PAGE_SIZE,
			},
		}),
	);
	const approve = useMutation(orpc.review.approve.mutationOptions());

	const matching = (review.data?.items ?? []).filter((item) =>
		matchesReviewFilters(item, search),
	);
	const items = filtered
		? matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
		: matching;
	const total = filtered ? matching.length : (review.data?.total ?? 0);
	const totalPages = filtered
		? Math.max(Math.ceil(total / PAGE_SIZE), 1)
		: (review.data?.totalPages ?? 1);
	const index = openId ? items.findIndex((item) => item.id === openId) : -1;
	const hasNext = index >= 0 && index < items.length - 1;

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.document.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.review.key() }),
		]);

	const step = (direction: -1 | 1) => {
		if (index < 0) {
			return;
		}
		const target = items[index + direction];
		if (target) {
			setOpenId(target.id);
		}
	};

	const onApproveSelected = async () => {
		try {
			for (const id of selected) {
				await approve.mutateAsync({ id });
			}
			await invalidate();
			toast.success(`${countLabel(selected.length, "document")} approved.`);
			setSelected([]);
		} catch (error) {
			toastApiError(error, "The documents could not be approved.");
		}
	};

	const toggle = (id: string) =>
		setSelected((current) =>
			current.includes(id)
				? current.filter((item) => item !== id)
				: [...current, id],
		);

	return (
		<>
			<PageHeader
				kicker="Processing queue"
				title="Review queue"
				description="Documents whose ingestion produced suggestions below the confidence threshold."
				actions={
					selected.length > 0 ? (
						<Button onClick={onApproveSelected} disabled={approve.isPending}>
							<CheckIcon />
							Approve {selected.length} selected
						</Button>
					) : undefined
				}
			>
				<ReviewFilters value={search} onChange={setSearch} />
			</PageHeader>

			<DataList<ReviewItem>
				items={items}
				isLoading={review.isLoading}
				getKey={(item) => item.id}
				onRowClick={(item) => setOpenId(item.id)}
				getRowLabel={(item) => `Review ${item.title}`}
				headerLeading={
					<Checkbox
						aria-label="Select every document"
						checked={selected.length > 0 && selected.length === items.length}
						onCheckedChange={(checked) =>
							setSelected(checked === true ? items.map((item) => item.id) : [])
						}
					/>
				}
				rowLeading={(item) => (
					<Checkbox
						aria-label={`Select ${item.title}`}
						checked={selected.includes(item.id)}
						onCheckedChange={() => toggle(item.id)}
					/>
				)}
				columns={[
					{
						id: "title",
						header: "Document",
						span: 5,
						cell: (item) => <DocumentTitleCell item={item} />,
					},
					{
						id: "reasons",
						header: "Reasons",
						span: 4,
						cell: (item) => (
							<div className="flex flex-wrap items-center gap-1">
								{item.reviewReasons.map((reason) => (
									<Badge
										key={`${reason.code}:${reason.field ?? ""}`}
										tone="warning"
										title={reason.message}
									>
										{REVIEW_REASON_LABELS[reason.code]}
									</Badge>
								))}
							</div>
						),
					},
					{
						id: "confidence",
						header: "Confidence",
						span: 1,
						cell: (item) => {
							const score = lowestConfidence(item);
							return score === null ? (
								<span className="text-muted-foreground text-xs">—</span>
							) : (
								<Badge tone={score < 0.75 ? "warning" : "success"}>
									{formatConfidence(score)}
								</Badge>
							);
						},
					},
					{
						id: "date",
						header: "Date",
						span: 2,
						align: "end",
						hideBelowLg: true,
						cell: (item) => (
							<DateText
								value={item.documentDate}
								precision={item.datePrecision ?? undefined}
							/>
						),
					},
				]}
				empty={
					<EmptyState
						icon={InboxIcon}
						title={filtered ? "No match" : "Nothing to review"}
						description={
							filtered
								? "No document in the queue matches these filters."
								: "Every extraction scored above the confidence threshold."
						}
					/>
				}
				pagination={
					review.data
						? {
								page,
								pageSize: PAGE_SIZE,
								total,
								totalPages,
								onPageChange: (next) =>
									navigate({
										search: (current) => ({ ...current, page: next }),
									}),
								itemLabel: "document",
							}
						: undefined
				}
			/>

			<ReviewSheet
				documentId={openId}
				open={openId !== null}
				onOpenChange={(open) => {
					if (!open) {
						setOpenId(null);
					}
				}}
				onNext={() => step(1)}
				onPrevious={() => step(-1)}
				onApproved={(advance) => {
					const next = advance ? items[index + 1] : null;
					setOpenId(next?.id ?? null);
				}}
				hasNext={hasNext}
			/>
		</>
	);
}
