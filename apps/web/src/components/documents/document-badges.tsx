import type { CategorySummary } from "@docstore/shared/category";
import type {
	AssignmentSource,
	DateSource,
	DocumentStatus,
} from "@docstore/shared/document";
import type { TagSummary } from "@docstore/shared/tag";
import { Badge } from "@docstore/ui/components/badge";
import { cn } from "@docstore/ui/lib/utils";
import { CalendarSearchIcon } from "lucide-react";

import {
	ASSIGNMENT_SOURCE_ICONS,
	ASSIGNMENT_SOURCE_LABELS,
	DATE_SOURCE_HINTS,
	DATE_SOURCE_LABELS,
	DOCUMENT_STATUS_ICONS,
	DOCUMENT_STATUS_LABELS,
	DOCUMENT_STATUS_TONES,
	formatConfidence,
} from "./document-labels";

/** Under this, an automatic value is shown as a warning rather than a fact. */
const LOW_CONFIDENCE = 0.75;

/**
 * Colour dot of a category or a tag. The hue comes from the database (free-form
 * hexadecimal), so it goes through `style` rather than a class.
 */
function ColorDot({ color }: { color: string | null }) {
	if (!color) {
		return null;
	}
	return (
		<span
			aria-hidden
			className="size-1.5 shrink-0 rounded-full"
			style={{ backgroundColor: color }}
		/>
	);
}

/** Document status badge; `processing` carries an animated spinner. */
export function DocumentStatusBadge({
	status,
	className,
}: {
	status: DocumentStatus;
	className?: string;
}) {
	const Icon = DOCUMENT_STATUS_ICONS[status];
	return (
		<Badge tone={DOCUMENT_STATUS_TONES[status]} className={className}>
			<Icon
				aria-hidden
				className={cn(status === "processing" && "animate-spin")}
			/>
			{DOCUMENT_STATUS_LABELS[status]}
		</Badge>
	);
}

/** Coloured badge of a category. */
export function CategoryBadge({
	category,
	className,
}: {
	category: CategorySummary | null;
	className?: string;
}) {
	if (!category) {
		return (
			<span className={cn("text-muted-foreground text-xs", className)}>—</span>
		);
	}
	return (
		<Badge tone="outline" className={className}>
			<ColorDot color={category.color} />
			{category.name}
		</Badge>
	);
}

/**
 * Chip of a tag. Only the display fields are required, so the same component
 * serves a `TagSummary` (link on a document) and a `TagWithCount` (`tag.list`).
 */
export function TagChip({
	tag,
	className,
}: {
	tag: Pick<TagSummary, "id" | "name" | "color">;
	className?: string;
}) {
	return (
		<Badge tone="neutral" className={className}>
			<ColorDot color={tag.color} />
			{tag.name}
		</Badge>
	);
}

/**
 * Origin of an assignment: nothing for manual input, an "auto" badge carrying
 * the confidence for a rule or an MCP agent.
 */
export function AssignmentSourceBadge({
	source,
	confidence,
	className,
}: {
	source: AssignmentSource;
	confidence: number | null;
	className?: string;
}) {
	if (source === "manual") {
		return null;
	}
	const score = formatConfidence(confidence);
	const Icon = ASSIGNMENT_SOURCE_ICONS[source];
	return (
		<Badge
			tone={
				confidence !== null && confidence < LOW_CONFIDENCE
					? "warning"
					: "success"
			}
			className={className}
			title={`Automatic assignment (${ASSIGNMENT_SOURCE_LABELS[source]})`}
		>
			<Icon aria-hidden />
			auto{score ? ` · ${score}` : ""}
		</Badge>
	);
}

/**
 * Where the date of a document comes from, with the confidence that went with
 * it. Nothing is shown for a date someone typed, nor for a document ingested
 * before the pipeline started recording the provenance.
 */
export function DateSourceBadge({
	source,
	confidence,
	className,
}: {
	source: DateSource | null;
	confidence: number | null;
	className?: string;
}) {
	if (source === null || source === "manual") {
		return null;
	}
	const score = formatConfidence(confidence);
	return (
		<Badge
			data-testid="date-source-badge"
			tone={
				confidence !== null && confidence < LOW_CONFIDENCE
					? "warning"
					: "neutral"
			}
			className={className}
			title={DATE_SOURCE_HINTS[source]}
		>
			<CalendarSearchIcon aria-hidden />
			{DATE_SOURCE_LABELS[source]}
			{score ? ` · ${score}` : ""}
		</Badge>
	);
}
