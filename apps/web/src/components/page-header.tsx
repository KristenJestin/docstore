import { cn } from "@docstore/ui/lib/utils";
import type * as React from "react";

import { MonoLabel } from "./mono-label";

export interface PageHeaderProps {
	/** Mono overline in small caps (e.g. "Library"). */
	kicker?: string;
	title: React.ReactNode;
	description?: React.ReactNode;
	/** Buttons aligned to the right of the title. */
	actions?: React.ReactNode;
	/** Breadcrumb rendered above the kicker. */
	breadcrumb?: React.ReactNode;
	/** Extra content below the title (search, filters…). */
	children?: React.ReactNode;
	className?: string;
}

/** Page header: mono kicker, tight bold title, description, actions. */
export function PageHeader({
	kicker,
	title,
	description,
	actions,
	breadcrumb,
	children,
	className,
}: PageHeaderProps) {
	return (
		<header
			className={cn(
				"border-border border-b px-6 pt-6 pb-6 lg:px-8 lg:pt-8",
				className,
			)}
		>
			{breadcrumb}
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div className="min-w-0">
					{kicker ? <MonoLabel className="block">{kicker}</MonoLabel> : null}
					<h1 className="mt-2 font-extrabold text-3xl leading-tight tracking-tight">
						{title}
					</h1>
					{description ? (
						<p className="mt-1.5 max-w-xl text-muted-foreground text-sm">
							{description}
						</p>
					) : null}
				</div>
				{actions ? (
					<div className="flex flex-wrap items-center gap-2">{actions}</div>
				) : null}
			</div>
			{children}
		</header>
	);
}
