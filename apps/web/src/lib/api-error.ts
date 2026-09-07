import { FUTURE_EXPIRY_MESSAGE } from "@docstore/shared/common";
import { ORPCError } from "@orpc/client";
import { toast } from "sonner";

/**
 * Generic English message per oRPC error code, used as the headline whenever
 * the server did not attach a message of its own.
 */
const CODE_MESSAGES: Record<string, string> = {
	CONFLICT: "This conflicts with existing data.",
	NOT_FOUND: "This item no longer exists.",
	UNAUTHORIZED: "Your session has expired. Please sign in again.",
	BAD_REQUEST: "Some of the submitted values are invalid.",
	FORBIDDEN: "This API key is missing the scope for that.",
	SERVICE_UNAVAILABLE: "The service is temporarily unavailable.",
};

/** Headline of the guard that makes a trashed document read-only. */
export const TRASHED_DOCUMENT_MESSAGE =
	"This document is in the trash. Restore it first.";

/**
 * What the API answers when a review action lands on a document that left the
 * queue (`review.service.ts`). Copied rather than imported: `@docstore/api` is
 * server code, this bundle only borrows its router type.
 */
const NOT_IN_REVIEW_MESSAGE = "Document is not in review.";

export interface ApiErrorMessage {
	/** English headline, always safe to display. */
	message: string;
	/** Secondary line, only when the headline needs more context. */
	description?: string;
}

/** `true` when the API refused the write because the document is trashed. */
export function isTrashedDocumentError(error: unknown): boolean {
	return (
		error instanceof ORPCError &&
		error.code === "CONFLICT" &&
		error.message.includes("in the trash")
	);
}

/** The Party the API refused to duplicate, read back from its message. */
export interface PartyConflict {
	id: string;
	name: string;
}

/**
 * Reads `An equivalent Party already exists: "Free" (abc123).` back into its
 * parts, so the form can point at that Party instead of only naming it.
 *
 * Returns `null` for anything else, including a `CONFLICT` raised elsewhere.
 */
export function partyConflict(error: unknown): PartyConflict | null {
	if (!(error instanceof ORPCError) || error.code !== "CONFLICT") {
		return null;
	}
	const match = /equivalent Party already exists: "(.+)" \(([^)]+)\)/.exec(
		error.message,
	);
	return match?.[1] && match[2] ? { name: match[1], id: match[2] } : null;
}

/** `true` when `party.delete` was refused because documents still point at it. */
export function isPartyInUseError(error: unknown): boolean {
	return (
		error instanceof ORPCError &&
		error.code === "CONFLICT" &&
		error.message.includes("is linked to")
	);
}

/**
 * Messages the server phrases for itself ("Re-run with `force`…", "`endPeriod`
 * must be…") and that read better rewritten, keyed by what the API says.
 *
 * Everything else falls through: the API answers in English, so its own message
 * is usually the best headline there is.
 */
function knownMessage(detail: string): ApiErrorMessage | null {
	if (detail.includes("in the trash")) {
		return {
			message: TRASHED_DOCUMENT_MESSAGE,
			description:
				"A document in the trash is read-only: restore it before editing or reprocessing it, and its metadata comes back with it.",
		};
	}
	if (detail.includes(NOT_IN_REVIEW_MESSAGE)) {
		return {
			message: "This document has left the review queue.",
			description:
				"It was already approved, trashed or is still processing: reload the page to see where it stands.",
		};
	}
	if (detail.includes("set manually")) {
		return {
			message: "This value was entered by hand.",
			description:
				"Only an automatic assignment can be rejected: edit the value instead.",
		};
	}
	if (detail.includes("create a cycle")) {
		return {
			message: "This link would create a cycle.",
			description: detail,
		};
	}
	if (detail.includes(FUTURE_EXPIRY_MESSAGE)) {
		return {
			message: FUTURE_EXPIRY_MESSAGE,
			description: "Pick a date later than today, or leave it empty.",
		};
	}
	if (detail.startsWith("Unknown placeholder")) {
		return {
			message: "Unknown placeholder in the template.",
			description: detail,
		};
	}
	return null;
}

/** Message of the first validation issue oRPC attached to the rejection. */
function firstValidationIssue(
	error: ORPCError<string, unknown>,
): string | null {
	const data = error.data as { issues?: { message?: unknown }[] } | undefined;
	const issue = data?.issues?.find(
		(entry) => typeof entry.message === "string" && entry.message.length > 0,
	);
	return typeof issue?.message === "string" ? issue.message : null;
}

/**
 * Turns an unknown rejection into a displayable message. `fallback` is the
 * local, action-specific English wording used whenever the error carries no
 * code we recognise.
 *
 * The API answers in English (see `CLAUDE.md`), so its own message is the most
 * useful headline: "This dossier holds a sensitive document" says far more than
 * "Some of the submitted values are invalid". The generic per-code wording is
 * only a fallback for errors raised without a message.
 */
export function apiErrorMessage(
	error: unknown,
	fallback: string,
): ApiErrorMessage {
	if (!(error instanceof ORPCError)) {
		return { message: fallback };
	}
	const generic = CODE_MESSAGES[error.code];
	if (!generic) {
		return { message: fallback };
	}
	const detail = error.message.trim();
	// oRPC falls back to the code itself when no message was attached, and
	// answers "Input validation failed" for a schema rejection: the issue it
	// carries is what the user has to read.
	const useful =
		detail.length === 0 || detail === error.code || /validation/i.test(detail)
			? (firstValidationIssue(error) ?? "")
			: detail;
	if (useful.length === 0) {
		return { message: generic };
	}
	return knownMessage(useful) ?? { message: useful };
}

export interface ToastApiErrorOptions {
	/** Extra button of the toast, e.g. "Restore" on a trashed document. */
	action?: { label: string; onClick: () => void };
}

/** `apiErrorMessage` piped into a `sonner` toast. */
export function toastApiError(
	error: unknown,
	fallback: string,
	options: ToastApiErrorOptions = {},
): void {
	const { message, description } = apiErrorMessage(error, fallback);
	toast.error(message, { description, action: options.action });
}
