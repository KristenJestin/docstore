import { buttonVariants } from "@docstore/ui/components/button";
import { Card, CardContent, CardHeader } from "@docstore/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

import { MonoLabel } from "@/components/mono-label";
import { orpc } from "@/utils/orpc";

import { ActivityList } from "./activity-list";

/** Entries shown on the document page; the rest is one click away. */
const DOCUMENT_ACTIVITY_LIMIT = 8;

export interface DocumentActivityCardProps {
	documentId: string;
	/**
	 * `updatedAt` of the document: when it moves (a change made from this very
	 * page), the history is read again.
	 */
	version: string | Date;
}

/** "Activity" section of the document page: who changed or read it, and when. */
export function DocumentActivityCard({
	documentId,
	version,
}: DocumentActivityCardProps) {
	const activity = useQuery(
		orpc.activity.list.queryOptions({
			input: { objectId: documentId, pageSize: DOCUMENT_ACTIVITY_LIMIT },
		}),
	);
	const { refetch } = activity;
	const stamp = new Date(version).getTime();

	// biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is the trigger, not an input.
	useEffect(() => {
		void refetch();
	}, [stamp, refetch]);

	const total = activity.data?.total ?? 0;

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-2">
				<MonoLabel>Activity</MonoLabel>
				{total > DOCUMENT_ACTIVITY_LIMIT ? (
					<Link
						to="/activity"
						search={{ objectId: documentId }}
						className={buttonVariants({ variant: "ghost", size: "sm" })}
					>
						All {total} entries
					</Link>
				) : null}
			</CardHeader>
			<CardContent className="-mx-4 -mb-4 p-0">
				<ActivityList
					size="sm"
					hideObject
					items={activity.data?.items}
					isLoading={activity.isLoading}
					isError={activity.isError}
					emptyTitle="No activity yet"
					emptyDescription="Changes and reads of this document will show up here."
				/>
			</CardContent>
		</Card>
	);
}
