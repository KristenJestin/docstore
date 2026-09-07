import type { ReminderItem, ReminderKind } from "@docstore/shared/reminder";
import {
	REMINDER_KIND_LABELS,
	REMINDER_KINDS,
} from "@docstore/shared/reminder";
import type { BadgeTone } from "@docstore/ui/components/badge";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@docstore/ui/components/popover";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlarmClockIcon, BellIcon, CheckIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { DatePicker } from "@/components/date-picker";
import { DateText } from "@/components/date-text";
import { EmptyState } from "@/components/empty-state";
import { MonoLabel } from "@/components/mono-label";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

/** Icon tone per reminder kind. */
const KIND_TONES: Record<ReminderKind, BadgeTone> = {
	expiry: "warning",
	period_gap: "danger",
	review_pending: "info",
};

/** Section heading per reminder kind. */
const KIND_HEADINGS: Record<ReminderKind, string> = {
	expiry: "Expiring documents",
	period_gap: "Missing documents",
	review_pending: "Waiting for review",
};

export interface ReminderListProps {
	items: ReminderItem[] | undefined;
	isLoading?: boolean;
}

/** Reminders grouped by kind, with snooze / dismiss / done on every row. */
export function ReminderList({ items, isLoading = false }: ReminderListProps) {
	const snooze = useMutation(orpc.reminder.snooze.mutationOptions());
	const dismiss = useMutation(orpc.reminder.dismiss.mutationOptions());
	const complete = useMutation(orpc.reminder.done.mutationOptions());

	const run = async (
		action: Promise<unknown>,
		message: string,
		fallback: string,
	) => {
		try {
			await action;
			toast.success(message);
		} catch (error) {
			toastApiError(error, fallback);
		}
	};

	if (isLoading) {
		return (
			<div className="flex flex-col gap-3 px-6 py-6 lg:px-8">
				{[0, 1, 2].map((index) => (
					<Skeleton key={index} className="h-16 w-full" />
				))}
			</div>
		);
	}

	const all = items ?? [];
	if (all.length === 0) {
		return (
			<div className="px-6 py-6 lg:px-8">
				<EmptyState
					icon={BellIcon}
					title="Nothing to remember"
					description="No document is about to expire and no recurring type has a gap. Use “Regenerate” after a bulk import."
				/>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6 px-6 py-6 lg:px-8">
			{REMINDER_KINDS.map((kind) => {
				const group = all.filter((item) => item.kind === kind);
				if (group.length === 0) {
					return null;
				}
				return (
					<section key={kind} className="shell">
						<div className="overflow-hidden rounded-xl bg-card shadow-soft ring-1 ring-border">
							<div className="flex items-center gap-2 border-border border-b px-4 py-3">
								<MonoLabel>{KIND_HEADINGS[kind]}</MonoLabel>
								<Badge tone={KIND_TONES[kind]}>{group.length}</Badge>
							</div>
							<ul className="divide-y divide-border">
								{group.map((reminder) => (
									<li
										key={reminder.id}
										className="group/row row-in flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-200 ease-premium hover:bg-muted/70"
									>
										<div className="min-w-0 flex-1">
											<p className="truncate font-medium text-sm">
												{reminder.documentId ? (
													<Link
														to="/documents/$documentId"
														params={{ documentId: reminder.documentId }}
														className="hover:underline"
													>
														{reminder.documentTitle ?? reminder.message}
													</Link>
												) : reminder.documentTypeId ? (
													<Link
														to="/types/$typeId"
														params={{ typeId: reminder.documentTypeId }}
														search={{}}
														className="hover:underline"
													>
														{reminder.documentTypeName ?? reminder.message}
													</Link>
												) : (
													reminder.message
												)}
											</p>
											<p className="truncate text-muted-foreground text-xs">
												{reminder.message}
											</p>
										</div>

										{reminder.periodKey ? (
											<Badge tone="outline">{reminder.periodKey}</Badge>
										) : null}
										{reminder.status === "snoozed" ? (
											<Badge tone="neutral">
												Snoozed until {reminder.snoozedUntil}
											</Badge>
										) : null}
										<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
											<span className="mono-label">due</span>
											<DateText value={reminder.dueDate} />
										</span>

										<div className="flex items-center gap-1">
											<SnoozeButton
												onSnooze={(until) =>
													run(
														snooze.mutateAsync({ id: reminder.id, until }),
														"Reminder snoozed.",
														"The reminder could not be snoozed.",
													)
												}
											/>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label="Mark as done"
												onClick={() =>
													run(
														complete.mutateAsync({ id: reminder.id }),
														"Reminder marked as done.",
														"The reminder could not be updated.",
													)
												}
											>
												<CheckIcon />
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label="Dismiss"
												onClick={() =>
													run(
														dismiss.mutateAsync({ id: reminder.id }),
														"Reminder dismissed.",
														"The reminder could not be dismissed.",
													)
												}
											>
												<XIcon />
											</Button>
										</div>
									</li>
								))}
							</ul>
						</div>
					</section>
				);
			})}
		</div>
	);
}

/** Date picker in a popover: snoozes the reminder until the chosen day. */
function SnoozeButton({ onSnooze }: { onSnooze: (until: string) => void }) {
	const ids = useId();
	const [open, setOpen] = useState(false);
	const [until, setUntil] = useState<string | null>(null);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={<Button variant="ghost" size="icon-sm" aria-label="Snooze" />}
			>
				<AlarmClockIcon />
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64">
				<label htmlFor={`${ids}-until`} className="mono-label">
					Snooze until
				</label>
				<DatePicker
					id={`${ids}-until`}
					label="Snooze until"
					className="mt-2 w-full"
					value={until}
					onValueChange={(next) => setUntil(next)}
				/>
				<Button
					size="sm"
					className="mt-3 w-full"
					disabled={!until}
					onClick={() => {
						if (!until) {
							return;
						}
						onSnooze(until);
						setOpen(false);
						setUntil(null);
					}}
				>
					Snooze
				</Button>
			</PopoverContent>
		</Popover>
	);
}

/** Kind labels re-exported for the screens that show a legend. */
export { REMINDER_KIND_LABELS };
