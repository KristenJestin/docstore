import { cn } from "@docstore/ui/lib/utils";
import type { ReactNode } from "react";

import { MonoLabel } from "../mono-label";

export interface SettingsPanelProps {
	title: ReactNode;
	description?: ReactNode;
	/** Buttons aligned to the right of the title. */
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}

/**
 * Double-rimmed block of a settings page (same frame as `DataList`, without
 * the row grid): mono title, description, actions and free content.
 */
export function SettingsPanel({
	title,
	description,
	actions,
	children,
	className,
}: SettingsPanelProps) {
	return (
		<section className={cn("shell", className)}>
			<div className="rounded-xl bg-card shadow-soft ring-1 ring-border">
				<div className="flex flex-wrap items-start justify-between gap-3 border-border border-b px-4 py-3">
					<div className="min-w-0">
						<MonoLabel className="block">{title}</MonoLabel>
						{description ? (
							<p className="mt-1 max-w-2xl text-muted-foreground text-sm">
								{description}
							</p>
						) : null}
					</div>
					{actions ? (
						<div className="flex flex-wrap items-center gap-2">{actions}</div>
					) : null}
				</div>
				{children}
			</div>
		</section>
	);
}

/** Vertical stack of panels with the page margins of `DataList`. */
export function SettingsStack({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("mx-6 my-6 flex flex-col gap-6 lg:mx-8", className)}>
			{children}
		</div>
	);
}

/** Row of a settings list: label + description on the left, control on the right. */
export function SettingsRow({
	label,
	htmlFor,
	description,
	control,
	className,
}: {
	label: ReactNode;
	htmlFor?: string;
	description?: ReactNode;
	control: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-center justify-between gap-4 px-4 py-4",
				className,
			)}
		>
			<div className="min-w-0 max-w-md">
				{htmlFor ? (
					<label htmlFor={htmlFor} className="font-medium text-sm">
						{label}
					</label>
				) : (
					<p className="font-medium text-sm">{label}</p>
				)}
				{description ? (
					<p className="mt-0.5 text-muted-foreground text-xs">{description}</p>
				) : null}
			</div>
			<div className="flex min-w-0 shrink-0 items-center gap-2">{control}</div>
		</div>
	);
}
