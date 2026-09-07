import type { LayoutSelectionReason } from "@docstore/shared/document-type";
import type {
	MembershipKind,
	Periodicity,
	PeriodStatus,
} from "@docstore/shared/recurrence";
import type { BadgeTone } from "@docstore/ui/components/badge";
import {
	CalendarClockIcon,
	CalendarDaysIcon,
	CalendarFoldIcon,
	CalendarIcon,
	CalendarRangeIcon,
	type LucideIcon,
} from "lucide-react";

/**
 * English labels of the document types (SPEC §9). They used to live in
 * `series-labels.ts`: types absorbed Series, then `weekly` and `semiannual`
 * joined the list.
 */

/** Capitalised periodicity labels, for selects and headers. */
export const PERIODICITY_TITLES: Record<Periodicity, string> = {
	weekly: "Weekly",
	monthly: "Monthly",
	quarterly: "Quarterly",
	semiannual: "Semiannual",
	yearly: "Yearly",
};

/** Icon shown next to the periodicity in the selects and the badges. */
export const PERIODICITY_ICONS: Record<Periodicity, LucideIcon> = {
	weekly: CalendarIcon,
	monthly: CalendarDaysIcon,
	quarterly: CalendarRangeIcon,
	semiannual: CalendarClockIcon,
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

/**
 * Tokens offered by the title template of a document type. On top of the ones
 * the rules already know, a type fills `{type}` with its own name and gives
 * `{period}` the key of the period the document falls into.
 *
 * A spelled-out month comes in three chips: the plain token, which follows the
 * content language, and one per language for a household that wants this one
 * type named in English or in French whatever the setting says.
 */
export const TYPE_TITLE_PLACEHOLDERS: { token: string; hint: string }[] = [
	{ token: "{type}", hint: "Name of the document type" },
	{ token: "{period}", hint: "Period key, 2026-03 or 2026-H1" },
	{
		token: "{period:MMMM yyyy}",
		hint: "Period in the content language, March 2026",
	},
	{ token: "{period:MMMM yyyy|en-GB}", hint: "Period in English, March 2026" },
	{ token: "{period:MMMM yyyy|fr-FR}", hint: "Period in French, mars 2026" },
	{ token: "{period:yyyy-MM}", hint: "Period, 2026-03" },
	{ token: "{date}", hint: "Document date, 2026-03-17" },
	{ token: "{date:YYYY-MM}", hint: "Document date, month only" },
	{ token: "{issuer}", hint: "Name of the issuing party" },
	{ token: "{category}", hint: "Category name" },
	{ token: "{title}", hint: "Current title" },
];
