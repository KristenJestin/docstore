import type { ApiKeyScope } from "@docstore/shared/api-key";
import type { CustomFieldType } from "@docstore/shared/custom-field";
import type {
	FolderAfterImport,
	IntakeOutcome,
	IntakeSourceType,
	MailAfterImport,
} from "@docstore/shared/intake";
import type { DeliverableEvent, WebhookEvent } from "@docstore/shared/webhook";
import type { BadgeTone } from "@docstore/ui/components/badge";

/** English labels of the enums used across the settings screens. */

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
	text: "Text",
	number: "Number",
	money: "Amount",
	date: "Date",
	boolean: "Yes / no",
	select: "Choice list",
	url: "Link",
	party_ref: "Party",
};

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
	read: "Read",
	write: "Write",
	sensitive: "Sensitive documents",
	admin: "Administration",
};

export const API_KEY_SCOPE_HINTS: Record<ApiKeyScope, string> = {
	read: "List and read documents, parties and taxonomy.",
	write: "Create and change documents and their metadata.",
	sensitive: "Read the text of documents flagged as sensitive.",
	admin: "Settings, keys, intake sources and webhooks. Implies every scope.",
};

export const INTAKE_SOURCE_TYPE_LABELS: Record<IntakeSourceType, string> = {
	folder: "Watched folder",
	mail: "Mailbox",
};

export const FOLDER_AFTER_IMPORT_LABELS: Record<FolderAfterImport, string> = {
	keep: "Leave the file in place",
	move: "Move the file",
	delete: "Delete the file",
};

export const MAIL_AFTER_IMPORT_LABELS: Record<MailAfterImport, string> = {
	mark_seen: "Mark the message as read",
	move: "Move the message",
	delete: "Delete the message",
};

export const INTAKE_OUTCOME_LABELS: Record<IntakeOutcome, string> = {
	imported: "Imported",
	duplicate: "Duplicate",
	error: "Error",
	skipped: "Skipped",
};

export const INTAKE_OUTCOME_TONES: Record<IntakeOutcome, BadgeTone> = {
	imported: "success",
	duplicate: "info",
	error: "danger",
	skipped: "neutral",
};

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
	"document.created": "Document created",
	"document.processed": "Document processed",
	"document.review": "Document sent to review",
	"document.updated": "Document updated",
	"reminder.due": "Reminder due",
};

/** Deliveries also carry `ping` and the ad-hoc `rule.webhook` action. */
export const DELIVERABLE_EVENT_LABELS: Record<DeliverableEvent, string> = {
	...WEBHOOK_EVENT_LABELS,
	ping: "Test ping",
	"rule.webhook": "Rule action",
};

/** Badge tone of an HTTP status code: 2xx green, 4xx amber, the rest red. */
export function statusTone(status: number | null): BadgeTone {
	if (status === null) {
		return "neutral";
	}
	if (status >= 200 && status < 300) {
		return "success";
	}
	return status >= 400 && status < 500 ? "warning" : "danger";
}

/** "Never" when the date is missing, otherwise the relative wording. */
export function formatDateTime(value: Date | null): string {
	if (!value) {
		return "—";
	}
	return new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(value);
}
