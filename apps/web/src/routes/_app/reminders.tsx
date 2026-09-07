import type { ReminderStatus } from "@docstore/shared/reminder";
import { REMINDER_STATUSES } from "@docstore/shared/reminder";
import { Button } from "@docstore/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { RemindersSkeleton } from "@/components/page-skeletons";
import { ReminderList } from "@/components/reminders/reminder-list";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

/** Reminders pulled in one page: a household never has more than a few. */
const REMINDER_LIMIT = 200;

export const Route = createFileRoute("/_app/reminders")({
	component: RemindersPage,
	pendingComponent: RemindersSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.reminder.list.queryOptions({
				input: { status: "pending", limit: REMINDER_LIMIT },
			}),
		),
});

/** English labels of the reminder statuses, plus the "everything" entry. */
const STATUS_ITEMS: Record<string, string> = {
	pending: "Pending",
	snoozed: "Snoozed",
	done: "Done",
	dismissed: "Dismissed",
	all: "All statuses",
};

function RemindersPage() {
	const [status, setStatus] = useState<ReminderStatus | "all">("pending");

	const reminders = useQuery(
		orpc.reminder.list.queryOptions({
			input: {
				status: status === "all" ? undefined : status,
				limit: REMINDER_LIMIT,
			},
		}),
	);
	const generate = useMutation(orpc.reminder.generate.mutationOptions());

	const regenerate = async () => {
		try {
			const result = await generate.mutateAsync({});
			toast.success("Reminders recomputed.", {
				description: `${result.created} created, ${result.updated} updated, ${result.removed} removed.`,
			});
		} catch (error) {
			toastApiError(error, "The reminders could not be recomputed.");
		}
	};

	return (
		<>
			<PageHeader
				kicker="Follow-up"
				title="Reminders"
				description="Documents about to expire and periods still missing from a recurring type. They are recomputed, never entered by hand."
				actions={
					<Button
						variant="outline"
						disabled={generate.isPending}
						onClick={regenerate}
					>
						<RefreshCwIcon />
						{generate.isPending ? "Recomputing…" : "Regenerate"}
					</Button>
				}
			>
				<div className="mt-6 flex flex-wrap items-center gap-3">
					<Select
						items={STATUS_ITEMS}
						value={status}
						onValueChange={(value) =>
							setStatus(value as ReminderStatus | "all")
						}
					>
						<SelectTrigger aria-label="Filter by status" className="w-48">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{REMINDER_STATUSES.map((value) => (
								<SelectItem key={value} value={value}>
									{STATUS_ITEMS[value]}
								</SelectItem>
							))}
							<SelectItem value="all">{STATUS_ITEMS.all}</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</PageHeader>

			<ReminderList items={reminders.data} isLoading={reminders.isLoading} />
		</>
	);
}
