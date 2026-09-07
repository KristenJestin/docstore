import type { LayoutSelectionReason } from "@docstore/shared/document-type";
import type {
	MembershipKind,
	Periodicity,
	RecurrenceStats,
} from "@docstore/shared/recurrence";
import { Badge } from "@docstore/ui/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@docstore/ui/components/tooltip";
import { cn } from "@docstore/ui/lib/utils";

import { CategoryIcon } from "@/components/settings/taxonomy-pickers";

import {
	LAYOUT_REASON_LABELS,
	MEMBERSHIP_LABELS,
	MEMBERSHIP_TONES,
	PERIODICITY_ICONS,
	PERIODICITY_TITLES,
} from "./document-type-labels";

/** How many missing periods are listed before the "+N" chip. */
const MISSING_PREVIEW = 2;
/** Above this count, the "+N" tooltip scrolls instead of growing forever. */
const MISSING_TOOLTIP_SCROLL_THRESHOLD = 24;

export interface PeriodicityBadgeProps {
	periodicity: Periodicity;
	className?: string;
}

/** Icon + capitalised periodicity, the badge every recurring type shows. */
export function PeriodicityBadge({
	periodicity,
	className,
}: PeriodicityBadgeProps) {
	const Icon = PERIODICITY_ICONS[periodicity];
	return (
		<Badge tone="info" className={className}>
			<Icon aria-hidden />
			{PERIODICITY_TITLES[periodicity]}
		</Badge>
	);
}

export interface DocumentTypeMarkProps {
	icon: string | null;
	color: string | null;
	size?: "sm" | "md";
	className?: string;
}

/**
 * Square icon tile of a document type: the same fixed icon list as the
 * categories, tinted with the colour of the type.
 */
export function DocumentTypeMark({
	icon,
	color,
	size = "md",
	className,
}: DocumentTypeMarkProps) {
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center rounded-lg bg-muted ring-1 ring-border",
				size === "sm" ? "size-6" : "size-8",
				className,
			)}
			style={color ? { color } : undefined}
		>
			<CategoryIcon
				name={icon}
				className={size === "sm" ? "size-3.5" : "size-4"}
			/>
		</span>
	);
}

export interface RecurrenceProgressProps {
	stats: RecurrenceStats;
	/** Also lists the first missing periods as chips. */
	showMissing?: boolean;
}

/**
 * "8/12" plus the first missing period keys, capped to `MISSING_PREVIEW` and
 * a "+N" chip. Stays on a single line: this renders inside a fixed-width
 * table column, so the overflow lives in the "+N" tooltip rather than in
 * extra wrapped rows.
 */
export function RecurrenceProgress({
	stats,
	showMissing = true,
}: RecurrenceProgressProps) {
	const overflowCount = stats.missing.length - MISSING_PREVIEW;
	return (
		<div className="flex min-w-0 items-center gap-1 whitespace-nowrap">
			<span className="shrink-0 font-mono text-sm tabular-nums">
				{stats.present}
				<span className="text-muted-foreground">/{stats.expected}</span>
			</span>
			{showMissing && stats.missing.length > 0 ? (
				<>
					{stats.missing.slice(0, MISSING_PREVIEW).map((period) => (
						<Badge key={period} tone="danger" className="shrink-0 px-1.5">
							{period}
						</Badge>
					))}
					{overflowCount > 0 ? (
						<Tooltip>
							<TooltipTrigger
								render={
									<Badge
										tone="outline"
										className="shrink-0 cursor-default px-1.5"
									/>
								}
							>
								+{overflowCount}
							</TooltipTrigger>
							<TooltipContent
								side="top"
								className={cn(
									"flex-col items-start gap-1 whitespace-normal",
									stats.missing.length > MISSING_TOOLTIP_SCROLL_THRESHOLD &&
										"max-h-56 overflow-y-auto",
								)}
							>
								<div className="flex flex-wrap gap-1 font-mono text-xs">
									{stats.missing.map((period) => (
										<span key={period}>{period}</span>
									))}
								</div>
							</TooltipContent>
						</Tooltip>
					) : null}
				</>
			) : null}
		</div>
	);
}

/** Why the layout of a document was selected. */
export function LayoutReasonBadge({
	reason,
}: {
	reason: LayoutSelectionReason;
}) {
	return (
		<Badge tone={reason === "none" ? "neutral" : "outline"}>
			{LAYOUT_REASON_LABELS[reason]}
		</Badge>
	);
}

/** How a document belongs to the recurrence of its type. */
export function MembershipBadge({
	membership,
}: {
	membership: MembershipKind;
}) {
	return (
		<Badge tone={MEMBERSHIP_TONES[membership]}>
			{MEMBERSHIP_LABELS[membership]}
		</Badge>
	);
}
