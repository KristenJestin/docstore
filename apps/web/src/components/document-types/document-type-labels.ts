import type { LayoutSelectionReason } from "@docstore/shared/document-type";
import type {
	MembershipKind,
	Periodicity,
	PeriodStatus,
} from "@docstore/shared/recurrence";
import type { BadgeTone } from "@docstore/ui/components/badge";
import {
	CalendarDaysIcon,
	CalendarFoldIcon,
	CalendarIcon,
	CalendarRangeIcon,
	type LucideIcon,
} from "lucide-react";

/**
 * English labels of the document types (SPEC §9). They used to live in
 * `series-labels.ts`: types absorbed Series, and `weekly` joined the list.
 */

/** Capitalised periodicity labels, for selects and headers. */
export const PERIODICITY_TITLES: Record<Periodicity, string> = {
	weekly: "Weekly",
	monthly: "Monthly",
	quarterly: "Quarterly",
	yearly: "Yearly",
};

/** Icon shown next to the periodicity in the selects and the badges. */
export const PERIODICITY_ICONS: Record<Periodicity, LucideIcon> = {
	weekly: CalendarIcon,
	monthly: CalendarDaysIcon,
	quarterly: CalendarRangeIcon,
	yearly: CalendarFoldIcon,
};

/** Status of one period of the timeline. */
export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
	present: "Filed",
	missing: "Missing",
	pending: "Not due yet",
};

export const PERIOD_STATUS_TONES: Record<PeriodStatus, BadgeTone> = {
	present: "success",
	missing: "danger",
	pending: "neutral",
};

/** Why the layout of a document was picked (`applyDocumentType`). */
export const LAYOUT_REASON_LABELS: Record<LayoutSelectionReason, string> = {
	forced: "Forced",
	signature: "Signature",
	dateRange: "Date range",
	bestConfidence: "Best confidence",
	only: "Only layout",
	default: "Default layout",
	none: "No layout",
};

/** How a document belongs to the recurrence of its type. */
export const MEMBERSHIP_LABELS: Record<MembershipKind, string> = {
	computed: "Computed",
	forced: "Forced in",
	excluded: "Excluded",
};

export const MEMBERSHIP_TONES: Record<MembershipKind, BadgeTone> = {
	computed: "neutral",
	forced: "success",
	excluded: "danger",
};
