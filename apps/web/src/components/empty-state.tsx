import { cn } from "@docstore/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";

export interface EmptyStateProps {
	icon?: LucideIcon;
	title: string;
	description?: React.ReactNode;
	/** Action button or link, shown below the description. */
	action?: React.ReactNode;
	/** `sm` shrinks the height: dashboard panels, detail cards. */
	size?: "default" | "sm";
	className?: string;
}

/** Empty state: matte shell, framed icon, bold title (prototype B). */
export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	size = "default",
	className,
}: EmptyStateProps) {
	return (
		<div className={cn("shell", className)}>
			<div
				className={cn(
					"flex flex-col items-center justify-center gap-3 rounded-xl bg-card px-6 text-center shadow-soft ring-1 ring-border",
					size === "sm" ? "py-6" : "py-14",
				)}
			>
				{Icon ? (
					<span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border">
						<Icon className="size-5" strokeWidth={1.5} />
					</span>
				) : null}
				<p className="font-bold text-base text-foreground tracking-tight">
					{title}
				</p>
				{description ? (
					<p className="max-w-md text-muted-foreground text-sm leading-relaxed">
						{description}
					</p>
				) : null}
				{action ? <div className="mt-1">{action}</div> : null}
			</div>
		</div>
	);
}
