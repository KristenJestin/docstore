import type { DocumentSource } from "@docstore/shared/document";
import type {
	AnchorPosition,
	ExtractionTargetKind,
	SimplePostprocessStep,
} from "@docstore/shared/extraction";
import type {
	RuleActionType,
	RuleComparator,
	RuleConditionField,
	RuleConditionOp,
	RuleTrigger,
} from "@docstore/shared/rule";
import {
	FolderIcon,
	LinkIcon,
	type LucideIcon,
	MailIcon,
	PlugIcon,
	UploadIcon,
} from "lucide-react";

/**
 * English labels of the rule engine enums (SPEC §3 and §4) and the small
 * helpers that drive the builders: which comparators a field accepts, which
 * kind of value input it needs.
 */

export const RULE_TRIGGER_LABELS: Record<RuleTrigger, string> = {
	ingest: "On ingestion",
	update: "On update",
	manual: "Manual run",
	scheduled: "Scheduled",
};

/** Compact form used by the badges of the rule list. */
export const RULE_TRIGGER_SHORT: Record<RuleTrigger, string> = {
	ingest: "Ingest",
	update: "Update",
	manual: "Manual",
	scheduled: "Scheduled",
};

export const RULE_TRIGGER_HINTS: Record<RuleTrigger, string> = {
	ingest: "Right after a document is imported and analysed.",
	update: "Every time the metadata of a document changes.",
	manual: 'When you press "Run" here or on a document.',
	scheduled: "During the nightly maintenance pass.",
};

export const RULE_CONDITION_OP_LABELS: Record<RuleConditionOp, string> = {
	and: "All of",
	or: "Any of",
	not: "None of",
};

/** Short form used inside the condition tree chips. */
export const RULE_CONDITION_OP_SHORT: Record<RuleConditionOp, string> = {
	and: "AND",
	or: "OR",
	not: "NOT",
};

export const RULE_CONDITION_FIELD_LABELS: Record<RuleConditionField, string> = {
	content: "Text content",
	filename: "File name",
	mime: "MIME type",
	page_count: "Page count",
	source: "Source",
	"mail.from": "Mail sender",
	"mail.subject": "Mail subject",
	"detected_identifiers.siren": "Detected SIREN",
	"detected_identifiers.siret": "Detected SIRET",
	"detected_identifiers.vat": "Detected VAT number",
	"detected_identifiers.iban": "Detected IBAN",
	"detected_identifiers.email": "Detected email",
	"detected_identifiers.domain": "Detected domain",
	"detected_identifiers.phone": "Detected phone",
	"party.id": "Party",
	"party.name": "Party name",
	category: "Category",
	tags: "Tags",
	document_date: "Document date",
	title: "Title",
};

/** Prefix shared by the `detected_identifiers.*` fields. */
export const DETECTED_IDENTIFIER_PREFIX = "detected_identifiers.";

/** Identifier kinds offered by the second select of the field picker. */
export const DETECTED_IDENTIFIER_KIND_LABELS: Record<string, string> = {
	siren: "SIREN",
	siret: "SIRET",
	vat: "VAT number",
	iban: "IBAN",
	email: "Email",
	domain: "Domain",
	phone: "Phone",
};

export const RULE_COMPARATOR_LABELS: Record<RuleComparator, string> = {
	eq: "Is",
	neq: "Is not",
	contains: "Contains",
	icontains: "Contains (ignoring case)",
	startsWith: "Starts with",
	endsWith: "Ends with",
	regex: "Matches the regex",
	in: "Is one of",
	gt: "Is greater than",
	lt: "Is less than",
	between: "Is between",
	exists: "Exists",
};

/** One-line pitch of the "Automations" tab of the settings. */
export const AUTOMATIONS_DESCRIPTION =
	"Cross-cutting rules: tags, sensitivity, parties, webhooks. To classify similar documents, use Document types.";

/**
 * Actions offered by the automation editor, in the order of the picker.
 *
 * Filing a recurring document is the job of a document type: `set_category` is
 * gone, and extracting into a field belongs to the extraction rules of a layout
 * (`run_extraction` gone, `set_field` literal only).
 */
export const UI_RULE_ACTION_TYPES = [
	"set_document_type",
	"add_tag",
	"remove_tag",
	"link_party",
	"set_field",
	"set_document_date",
	"set_period",
	"set_valid_until",
	"set_title",
	"set_sensitive",
	"webhook",
] as const satisfies readonly RuleActionType[];
export type UiRuleActionType = (typeof UI_RULE_ACTION_TYPES)[number];

export const RULE_ACTION_TYPE_LABELS: Record<UiRuleActionType, string> = {
	set_document_type: "Set the document type",
	add_tag: "Add a tag",
	remove_tag: "Remove a tag",
	link_party: "Link a party",
	set_field: "Set a custom field",
	set_document_date: "Set the document date",
	set_period: "Set the covered period",
	set_valid_until: "Set the expiry date",
	set_title: "Rename with a template",
	set_sensitive: "Flag as sensitive",
	webhook: "Call a webhook",
};

/**
 * Label of any action, including one saved before its type left the editor:
 * an old automation keeps rendering rather than blanking out.
 */
export function ruleActionLabel(type: RuleActionType): string {
	return (RULE_ACTION_TYPE_LABELS as Record<string, string>)[type] ?? type;
}

export const EXTRACTION_TARGET_LABELS: Record<ExtractionTargetKind, string> = {
	field: "Custom field",
	document_date: "Document date",
	period: "Covered period",
	valid_until: "Expiry date",
	title: "Title",
};

export const ANCHOR_POSITION_LABELS: Record<AnchorPosition, string> = {
	sameLine: "Same line, after the label",
	nextLine: "Next line",
	right: "To the right of the label",
	below: "Below the label",
};

export const POSTPROCESS_STEP_LABELS: Record<SimplePostprocessStep, string> = {
	trim: "Trim whitespace",
	number_fr: "French number (1234.56)",
	date_fr: "French date (2025-10-12)",
	month_fr: "French month (2025-10)",
	uppercase: "Uppercase",
};

/** Label of the only non-scalar step. */
export const REGEX_REPLACE_LABEL = "Replace with a regex";

/** English labels of the document sources, for the `source` field values. */
export const DOCUMENT_SOURCE_LABELS: Record<DocumentSource, string> = {
	upload: "Manual upload",
	mail: "Mailbox",
	folder: "Watched folder",
	link: "Public upload link",
	api: "API / agent",
};

export const DOCUMENT_SOURCE_ICONS: Record<DocumentSource, LucideIcon> = {
	upload: UploadIcon,
	mail: MailIcon,
	folder: FolderIcon,
	link: LinkIcon,
	api: PlugIcon,
};

/* ------------------------------------------------------------------ */
/* Field typing                                                         */
/* ------------------------------------------------------------------ */

/**
 * How the value of a field must be entered. Drives both the comparator list
 * and the shape of the value control.
 */
export type RuleFieldKind =
	| "text"
	| "number"
	| "date"
	| "source"
	| "party"
	| "category"
	| "tags";

const FIELD_KINDS: Partial<Record<RuleConditionField, RuleFieldKind>> = {
	page_count: "number",
	document_date: "date",
	source: "source",
	"party.id": "party",
	category: "category",
	tags: "tags",
};

export function ruleFieldKind(field: RuleConditionField): RuleFieldKind {
	return FIELD_KINDS[field] ?? "text";
}

const TEXT_COMPARATORS: RuleComparator[] = [
	"icontains",
	"contains",
	"eq",
	"neq",
	"startsWith",
	"endsWith",
	"regex",
	"in",
	"exists",
];

const ORDERED_COMPARATORS: RuleComparator[] = [
	"eq",
	"neq",
	"gt",
	"lt",
	"between",
	"exists",
];

const REFERENCE_COMPARATORS: RuleComparator[] = ["eq", "neq", "in", "exists"];

/** Comparators that make sense for a field, in the order shown in the select. */
export function comparatorsForField(
	field: RuleConditionField,
): RuleComparator[] {
	switch (ruleFieldKind(field)) {
		case "number":
		case "date":
			return ORDERED_COMPARATORS;
		case "source":
		case "party":
		case "category":
		case "tags":
			return REFERENCE_COMPARATORS;
		default:
			return TEXT_COMPARATORS;
	}
}

/** Shape of the value control required by a (field, comparator) pair. */
export type RuleValueControl =
	| "none"
	| "presence"
	| "text"
	| "number"
	| "date"
	| "regex"
	| "list"
	| "range"
	| "party"
	| "category"
	| "tag"
	| "source";

export function valueControlFor(
	field: RuleConditionField,
	cmp: RuleComparator,
): RuleValueControl {
	if (cmp === "exists") {
		return "presence";
	}
	if (cmp === "regex") {
		return "regex";
	}
	if (cmp === "between") {
		return "range";
	}

	const kind = ruleFieldKind(field);
	if (cmp === "in") {
		switch (kind) {
			case "party":
				return "party";
			case "category":
				return "category";
			case "tags":
				return "tag";
			default:
				return "list";
		}
	}
	switch (kind) {
		case "number":
			return "number";
		case "date":
			return "date";
		case "source":
			return "source";
		case "party":
			return "party";
		case "category":
			return "category";
		case "tags":
			return "tag";
		default:
			return "text";
	}
}

/** Placeholder chips offered by the title template helper (SPEC §3). */
export const TITLE_PLACEHOLDERS: { token: string; hint: string }[] = [
	{ token: "{date}", hint: "Document date, 2025-10-12" },
	{ token: "{date:YYYY-MM}", hint: "Document date, month only" },
	{ token: "{date:YYYY}", hint: "Document date, year only" },
	{ token: "{issuer}", hint: "Name of the issuing party" },
	{ token: "{category}", hint: "Category name" },
	{ token: "{title}", hint: "Current title" },
	{ token: "{period}", hint: "Covered period" },
	{ token: "{filename}", hint: "Original file name" },
];

/** `null` when the pattern compiles, the error message otherwise. */
export function regexError(
	pattern: string,
	flags: string | undefined,
): string | null {
	if (pattern.length === 0) {
		return null;
	}
	try {
		new RegExp(pattern, flags && flags.length > 0 ? flags : "i");
		return null;
	} catch (error) {
		return error instanceof Error
			? error.message
			: "Invalid regular expression";
	}
}
