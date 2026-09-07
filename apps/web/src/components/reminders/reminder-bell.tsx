import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellIcon } from "lucide-react";

import { counterPollOptions, orpc } from "@/utils/orpc";

/**
 * Bell of the top bar: number of pending reminders due within 30 days
 * (`reminder.count`), linking to `/reminders`. Polled like the sidebar
 * counters so a reminder that comes due shows up without a reload.
 */
export function ReminderBell() {
	const count = useQuery({
		...orpc.reminder.count.queryOptions({ input: {} }),
		...counterPollOptions,
	});
	const value = count.data?.count ?? 0;

	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={value > 0 ? `Reminders (${value} due)` : "Reminders"}
			className="relative"
			nativeButton={false}
			render={<Link to="/reminders" />}
		>
			<BellIcon />
			{value > 0 ? (
				<Badge
					tone="warning"
					className="absolute -top-1 -right-1 px-1.5 py-0 text-xs tabular-nums leading-4"
				>
					{value}
				</Badge>
			) : null}
		</Button>
	);
}
