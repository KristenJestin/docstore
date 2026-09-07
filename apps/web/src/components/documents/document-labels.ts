import type {
	AssignmentSource,
	DatePrecision,
	DateSource,
	DocumentFileKind,
	DocumentPartyRole,
	DocumentSort,
	DocumentStatus,
	ReviewReasonCode,
} from "@docstore/shared/document";
import type { DocumentRelationKind } from "@docstore/shared/relation";
import type { BadgeTone } from "@docstore/ui/components/badge";
import {
	AlertTriangleIcon,
	ArchiveIcon,
	ArrowDownAZIcon,
	ArrowDownIcon,
	ArrowUpAZIcon,
	ArrowUpIcon,
	AtSignIcon,
	BotIcon,
	CalendarClockIcon,
	CalendarDaysIcon,
	CalendarFoldIcon,
	CalendarRangeIcon,
	CircleCheckBigIcon,
	CircleCheckIcon,
	ClipboardCheckIcon,
	CopyIcon,
	FileQuestionMarkIcon,
	FileStackIcon,
	FolderXIcon,
	GaugeIcon,
	InboxIcon,
	LayersIcon,
	LayoutTemplateIcon,
	LinkIcon,
	LoaderIcon,
	type LucideIcon,
	PencilIcon,
	RepeatIcon,
	ReplaceIcon,
	ScanSearchIcon,
	ScanTextIcon,
	SendIcon,
	UserIcon,
	UserXIcon,
	WandSparklesIcon,
} from "lucide-react";

/**
 * English labels of the Document enums (SPEC §2), capitalised, each with the
 * Lucide icon shown next to it in the selects, comboboxes and badges.
 */
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
	processing: "Processing",
	review: "Review",
	active: "Active",
	archived: "Archived",
	failed: "Failed",
};

/**
 * Sentence shown next to the `failed` status: the pipeline gave up, and
 * `processingError` carries the reason.
 */
export const FAILED_STATUS_HINT =
	"The ingestion pipeline gave up on this document. Fix what it reports, then reprocess it.";

/**
 * Why `review.approve` would refuse this document, worded as the API words its
 * `CONFLICT` (`assertApprovable`): a half-computed suggestion must not be
 * frozen as if a human had accepted it. `null` when the approval is allowed.
 */
export function approvalBlockedReason(status: DocumentStatus): string | null {
	if (status === "processing") {
		return "This document is still being processed: wait for the end of the pipeline.";
	}
	if (status === "failed") {
		return "This document failed to process: reprocess it before approving.";
	}
	return null;
}

/** Kind of a file attached to a document, shown on every row of "Files". */
export const DOCUMENT_FILE_KIND_LABELS: Record<DocumentFileKind, string> = {
	original: "Original",
	archive: "Archive",
	attachment: "Attachment",
};

export const DOCUMENT_FILE_KIND_ICONS: Record<DocumentFileKind, LucideIcon> = {
	original: FileStackIcon,
	archive: ArchiveIcon,
	attachment: LinkIcon,
};

export const DOCUMENT_STATUS_ICONS: Record<DocumentStatus, LucideIcon> = {
	processing: LoaderIcon,
	review: ClipboardCheckIcon,
	active: CircleCheckIcon,
	archived: ArchiveIcon,
	failed: AlertTriangleIcon,
};

export const DOCUMENT_STATUS_TONES: Record<DocumentStatus, BadgeTone> = {
	processing: "info",
	review: "warning",
	active: "success",
	archived: "neutral",
	failed: "danger",
};

export const DOCUMENT_PARTY_ROLE_LABELS: Record<DocumentPartyRole, string> = {
	issuer: "Issuer",
	recipient: "Recipient",
	subject: "Subject",
	mentioned: "Mentioned",
};

export const DOCUMENT_PARTY_ROLE_ICONS: Record<DocumentPartyRole, LucideIcon> =
	{
		issuer: SendIcon,
		recipient: InboxIcon,
		subject: UserIcon,
		mentioned: AtSignIcon,
	};

export const ASSIGNMENT_SOURCE_LABELS: Record<AssignmentSource, string> = {
	manual: "Manual",
	rule: "Rule",
	mcp: "Agent",
};

export const ASSIGNMENT_SOURCE_ICONS: Record<AssignmentSource, LucideIcon> = {
	manual: PencilIcon,
	rule: WandSparklesIcon,
	mcp: BotIcon,
};

/**
 * Where the document date comes from. `manual` is the absence of a badge: a
 * date someone typed needs no explanation.
 */
export const DATE_SOURCE_LABELS: Record<DateSource, string> = {
	labelled: "labelled",
	period: "period",
	inferred: "inferred",
	manual: "manual",
};

export const DATE_SOURCE_HINTS: Record<DateSource, string> = {
	labelled: "Read from an explicit label in the text (“payé le”, “issued on”).",
	period: "Read from the period the document covers.",
	inferred: "First date found in the text: check it.",
	manual: "Date entered by hand.",
};

export const DATE_PRECISION_LABELS: Record<DatePrecision, string> = {
	day: "Day",
	month: "Month",
	year: "Year",
};

export const DATE_PRECISION_ICONS: Record<DatePrecision, LucideIcon> = {
	day: CalendarDaysIcon,
	month: CalendarRangeIcon,
	year: CalendarFoldIcon,
};

export const REVIEW_REASON_LABELS: Record<ReviewReasonCode, string> = {
	lowConfidence: "Low confidence",
	missingCategory: "Missing category",
	missingIssuer: "Missing issuer",
	extractionFailed: "Extraction failed",
	extractionMissed: "Nothing extracted",
	possibleDuplicate: "Possible duplicate",
	recurringCandidate: "Recurring document",
	unknownLayout: "Unknown layout",
	ambiguousLayout: "Several layouts match",
	typeCandidate: "Document type to confirm",
};

/**
 * Extra sentence shown under a review reason when its server message does not
 * say what actually happened to the document.
 */
export const REVIEW_REASON_HINTS: Partial<Record<ReviewReasonCode, string>> = {
	extractionMissed:
		"The rule is optional, so the document was not held back. Mark it required if the document is unusable without that value.",
	unknownLayout:
		"No layout matched this document: the default layout of the type was used, and its extraction rules ran all the same.",
	ambiguousLayout:
		"The first one by position was used and its extraction rules ran. Narrow the signatures or the date ranges so a single layout answers.",
};

export const REVIEW_REASON_ICONS: Record<ReviewReasonCode, LucideIcon> = {
	lowConfidence: GaugeIcon,
	missingCategory: FolderXIcon,
	missingIssuer: UserXIcon,
	extractionFailed: ScanTextIcon,
	extractionMissed: ScanSearchIcon,
	possibleDuplicate: CopyIcon,
	recurringCandidate: RepeatIcon,
	unknownLayout: LayoutTemplateIcon,
	ambiguousLayout: LayersIcon,
	typeCandidate: FileQuestionMarkIcon,
};

/**
 * Capitalised relation kinds. `DOCUMENT_RELATION_KIND_LABELS` of
 * `@docstore/shared` stays lowercase: it is also read by the MCP tools, where
 * the label is used inside a sentence.
 */
export const DOCUMENT_RELATION_KIND_TITLES: Record<
	DocumentRelationKind,
	string
> = {
	version_of: "Version of",
	page_of: "Page of",
	supersedes: "Supersedes",
	related_to: "Related to",
	fulfills: "Fulfills",
};

export const DOCUMENT_RELATION_KIND_ICONS: Record<
	DocumentRelationKind,
	LucideIcon
> = {
	version_of: LayersIcon,
	page_of: FileStackIcon,
	supersedes: ReplaceIcon,
	related_to: LinkIcon,
	fulfills: CircleCheckBigIcon,
};

export const DOCUMENT_SORT_LABELS: Record<DocumentSort, string> = {
	"documentDate:desc": "Newest first",
	"documentDate:asc": "Oldest first",
	"createdAt:desc": "Last added",
	"createdAt:asc": "First added",
	"title:asc": "Title A to Z",
	"title:desc": "Title Z to A",
	"validUntil:asc": "Expiring first",
};

export const DOCUMENT_SORT_ICONS: Record<DocumentSort, LucideIcon> = {
	"documentDate:desc": ArrowDownIcon,
	"documentDate:asc": ArrowUpIcon,
	"createdAt:desc": ArrowDownIcon,
	"createdAt:asc": ArrowUpIcon,
	"title:asc": ArrowDownAZIcon,
	"title:desc": ArrowUpAZIcon,
	"validUntil:asc": CalendarClockIcon,
};

/** Trash filter exposed in the URL, translated to `deleted` for the API. */
export const DOCUMENT_TRASH_LABEL = "Trash";

const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** "245 KB", "1.8 MB" — one decimal above the kilobyte. */
export function formatFileSize(bytes: number): string {
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const decimals = unit === 0 || value >= 100 ? 0 : 1;
	return `${value.toLocaleString("en-GB", {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	})} ${SIZE_UNITS[unit]}`;
}

/** "0.98" — confidence of an automatic assignment. */
export function formatConfidence(confidence: number | null): string | null {
	if (confidence === null) {
		return null;
	}
	return confidence.toLocaleString("en-GB", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

/** "1,240.50 EUR" — money custom field values, en-GB currency formatting. */
export function formatMoney(amount: number, currency: string): string {
	try {
		return new Intl.NumberFormat("en-GB", {
			style: "currency",
			currency,
		}).format(amount);
	} catch {
		// Unknown ISO code: fall back to a plain number plus the raw code.
		return `${new Intl.NumberFormat("en-GB", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(amount)} ${currency}`;
	}
}
