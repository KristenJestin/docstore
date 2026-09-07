import type { DocumentDetail } from "@docstore/shared/document";
import type { ReviewAssignmentKind } from "@docstore/shared/review";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { CheckIcon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import {
	AssignmentSourceBadge,
	CategoryBadge,
	TagChip,
} from "@/components/documents/document-badges";
import { DOCUMENT_PARTY_ROLE_LABELS } from "@/components/documents/document-labels";
import { PartyAvatar } from "@/components/party-avatar";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

/** One line of the "auto-assigned" list. */
interface AssignmentRow {
	key: string;
	kind: ReviewAssignmentKind;
	ref?: string;
	role?: DocumentDetail["parties"][number]["role"];
	label: string;
	content: ReactNode;
}

/**
 * Marks the "reject" buttons: the `r` shortcut of the review sheet focuses the
 * first one.
 */
export const REVIEW_REJECT_ATTRIBUTE = "data-review-reject";

function buildRows(document: DocumentDetail): AssignmentRow[] {
	const rows: AssignmentRow[] = [];

	if (document.category) {
		rows.push({
			key: "category",
			kind: "category",
			label: `category ${document.category.name}`,
			content: (
				<span className="flex min-w-0 items-center gap-2">
					<CategoryBadge category={document.category} />
					<AssignmentSourceBadge
						source={document.category.source}
						confidence={document.category.confidence}
						confirmedAt={document.category.confirmedAt}
					/>
				</span>
			),
		});
	}

	for (const tag of document.tags) {
		rows.push({
			key: `tag:${tag.id}`,
			kind: "tag",
			ref: tag.id,
			label: `tag ${tag.name}`,
			content: (
				<span className="flex min-w-0 items-center gap-2">
					<TagChip tag={tag} />
					<AssignmentSourceBadge
						source={tag.source}
						confidence={tag.confidence}
						confirmedAt={tag.confirmedAt}
					/>
				</span>
			),
		});
	}

	for (const party of document.parties) {
		rows.push({
			key: `party:${party.id}:${party.role}`,
			kind: "party",
			ref: party.id,
			role: party.role,
			label: `party ${party.name}`,
			content: (
				<span className="flex min-w-0 items-center gap-2">
					<PartyAvatar
						name={party.name}
						logoKey={party.logoKey}
						partyId={party.id}
						size="sm"
					/>
					<span className="truncate">{party.name}</span>
					<Badge tone={party.role === "issuer" ? "primary" : "neutral"}>
						{DOCUMENT_PARTY_ROLE_LABELS[party.role]}
					</Badge>
					<AssignmentSourceBadge
						source={party.source}
						confidence={party.confidence}
						confirmedAt={party.confirmedAt}
					/>
				</span>
			),
		});
	}

	for (const value of document.fieldValues) {
		rows.push({
			key: `field:${value.fieldId}`,
			kind: "field",
			ref: value.fieldId,
			label: `field ${value.field.name}`,
			content: (
				<span className="flex min-w-0 items-center gap-2">
					<span className="truncate font-medium">{value.field.name}</span>
					<AssignmentSourceBadge
						source={value.source}
						confidence={value.confidence}
						confirmedAt={value.confirmedAt}
					/>
				</span>
			),
		});
	}

	return rows;
}

export interface ReviewAssignmentsProps {
	document: DocumentDetail;
}

/**
 * Metadata set during ingestion, each line with a "keep" tick and a "reject"
 * cross (`review.rejectAssignment`). Keeping is a local mark: approving the
 * document is what stamps every automatic assignment "confirmed". They stay
 * automatic, so a later rule run may still refresh them.
 */
export function ReviewAssignments({ document }: ReviewAssignmentsProps) {
	const [kept, setKept] = useState<string[]>([]);
	const reject = useMutation(orpc.review.rejectAssignment.mutationOptions());

	const rows = buildRows(document);

	const onReject = async (row: AssignmentRow) => {
		try {
			await reject.mutateAsync({
				id: document.id,
				kind: row.kind,
				ref: row.ref,
				role: row.role,
			});
			toast.success(`Rejected the ${row.label}.`);
		} catch (error) {
			toastApiError(error, "The assignment could not be rejected.");
		}
	};

	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				Nothing was assigned automatically.
			</p>
		);
	}

	return (
		<ul data-testid="review-assignments" className="flex flex-col gap-1.5">
			{rows.map((row) => {
				const isKept = kept.includes(row.key);
				return (
					<li
						key={row.key}
						className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm ring-1 ring-border"
					>
						<span className="min-w-0 flex-1">{row.content}</span>
						{isKept ? <Badge tone="success">Kept</Badge> : null}
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Keep the ${row.label}`}
							onClick={() =>
								setKept((current) =>
									current.includes(row.key)
										? current.filter((item) => item !== row.key)
										: [...current, row.key],
								)
							}
						>
							<CheckIcon />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Reject the ${row.label}`}
							disabled={reject.isPending}
							onClick={() => onReject(row)}
							{...{ [REVIEW_REJECT_ATTRIBUTE]: "" }}
						>
							<XIcon />
						</Button>
					</li>
				);
			})}
		</ul>
	);
}
