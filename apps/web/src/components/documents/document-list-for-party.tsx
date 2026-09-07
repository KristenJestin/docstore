import { Button } from "@docstore/ui/components/button";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileTextIcon } from "lucide-react";

import { orpc } from "@/utils/orpc";

import { DateText } from "../date-text";
import { EmptyState } from "../empty-state";
import { CategoryBadge } from "./document-badges";
import { DocumentRow } from "./document-row";

/** Number of documents shown on a party detail page. */
const PREVIEW_SIZE = 8;

export interface DocumentListForPartyProps {
	partyId: string;
	partyName: string;
}

/**
 * Documents linked to a party, whatever the role. Rendered on the
 * `/parties/$partyId` page; the button opens a filtered `/documents`.
 */
export function DocumentListForParty({
	partyId,
	partyName,
}: DocumentListForPartyProps) {
	const navigate = useNavigate();
	const documents = useQuery(
		orpc.document.list.queryOptions({
			input: {
				partyId,
				page: 1,
				pageSize: PREVIEW_SIZE,
				sort: "documentDate:desc",
				deleted: "exclude",
			},
		}),
	);

	if (documents.isLoading) {
		return (
			<div className="flex flex-col gap-2">
				{[0, 1, 2].map((index) => (
					<Skeleton key={index} className="h-12 w-full" />
				))}
			</div>
		);
	}

	const items = documents.data?.items ?? [];

	if (items.length === 0) {
		return (
			<EmptyState
				size="sm"
				icon={FileTextIcon}
				title="No document"
				description={`No document is linked to ${partyName}.`}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<ul className="-mx-4 divide-y divide-border">
				{items.map((item) => (
					<li key={item.id}>
						<DocumentRow
							item={item}
							onOpen={() =>
								navigate({
									to: "/documents/$documentId",
									params: { documentId: item.id },
								})
							}
							trailing={
								<span className="flex items-center gap-2">
									<CategoryBadge category={item.category} />
									<DateText
										value={item.documentDate}
										precision={item.datePrecision}
									/>
								</span>
							}
						/>
					</li>
				))}
			</ul>
			{(documents.data?.total ?? 0) > items.length ? (
				<Link to="/documents" search={{ partyId }} className="self-start">
					<Button variant="outline" size="sm">
						View all {documents.data?.total} documents
					</Button>
				</Link>
			) : null}
		</div>
	);
}
