import type { Db } from "@docstore/db";
import { documentFieldValue } from "@docstore/db/schema/custom-field";
import {
	document,
	documentFile,
	documentParty,
} from "@docstore/db/schema/document";
import { documentTag } from "@docstore/db/schema/tag";
import {
	computeReviewReasons,
	type IngestionBinding,
} from "@docstore/ingestion";
import type {
	AssignmentSource,
	DocumentDetail,
	DocumentStatus,
	ReviewReason,
	UpdateDocumentInput,
} from "@docstore/shared/document";
import type { Paginated } from "@docstore/shared/pagination";
import type {
	ApproveManyReviewInput,
	ApproveManyReviewResult,
	ListReviewInput,
	RejectAssignmentInput,
	RequeueResult,
	ReviewItem,
} from "@docstore/shared/review";
import { ORPCError } from "@orpc/server";
import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import {
	assertNotTrashed,
	getDocument,
	listDocuments,
	TRASHED_DOCUMENT_MESSAGE,
	updateDocument,
} from "./document.service";

/**
 * Review queue (SPEC §4).
 *
 * A document enters it when `analyze` recorded at least one reason
 * (`document.review_reasons`): insufficient confidence, missing category or
 * Issuer, failed extraction, likely duplicate.
 */

export async function listReview(
	db: Db,
	input: ListReviewInput,
): Promise<Paginated<ReviewItem>> {
	const page = await listDocuments(db, {
		status: "review",
		deleted: "exclude",
		page: input.page,
		pageSize: input.pageSize,
		sort: "createdAt:desc",
	});

	const ids = page.items.map((item) => item.id);
	const reasons = new Map<string, ReviewReason[]>();
	if (ids.length > 0) {
		const rows = await db
			.select({ id: document.id, reviewReasons: document.reviewReasons })
			.from(document)
			.where(inArray(document.id, ids));
		for (const row of rows) reasons.set(row.id, row.reviewReasons);
	}

	return {
		...page,
		items: page.items.map((item) => ({
			...item,
			reviewReasons: reasons.get(item.id) ?? [],
		})),
	};
}

export async function countReview(db: Db): Promise<{ count: number }> {
	const rows = await db
		.select({ value: count() })
		.from(document)
		.where(and(eq(document.status, "review"), isNull(document.deletedAt)));
	return { count: rows[0]?.value ?? 0 };
}

async function requireReviewDocument(
	db: Db,
	id: string,
): Promise<{
	status: DocumentStatus;
	categoryId: string | null;
	categorySource: AssignmentSource;
	deletedAt: Date | null;
}> {
	const rows = await db
		.select({
			status: document.status,
			categoryId: document.categoryId,
			categorySource: document.categorySource,
			deletedAt: document.deletedAt,
		})
		.from(document)
		.where(eq(document.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${id}" not found.`,
		});
	}
	return row;
}

/** Message returned when the document is not (or no longer) in the queue. */
export const NOT_IN_REVIEW_MESSAGE = "Document is not in review.";

/**
 * Only a document sitting in the queue can be approved.
 *
 * Approving one that is still being processed (or whose pipeline gave up) would
 * freeze half-computed suggestions as if a human had accepted them; approving an
 * `active` or `archived` one used to succeed and do nothing, which reads as a
 * confirmation the caller never earned — typically after someone else already
 * cleared the queue.
 */
function assertApprovable(status: DocumentStatus): void {
	if (status === "review") return;
	if (status === "processing") {
		throw new ORPCError("CONFLICT", {
			message:
				"This document is still being processed: wait for the end of the pipeline.",
		});
	}
	if (status === "failed") {
		throw new ORPCError("CONFLICT", {
			message:
				"This document failed to process: reprocess it before approving.",
		});
	}
	throw new ORPCError("BAD_REQUEST", { message: NOT_IN_REVIEW_MESSAGE });
}

/** Message returned when the rejected assignment was entered by a human. */
export const MANUAL_ASSIGNMENT_MESSAGE =
	"This assignment was set manually; edit it instead.";

function assertAutomatic(sources: AssignmentSource[]): void {
	if (sources.length === 0) {
		throw new ORPCError("NOT_FOUND", {
			message: "No such assignment on this document.",
		});
	}
	if (sources.every((source) => source === "manual")) {
		throw new ORPCError("BAD_REQUEST", {
			message: MANUAL_ASSIGNMENT_MESSAGE,
		});
	}
}

/**
 * Approves the automatic suggestions: the optional patch is applied, the
 * assignments coming from rules become manual (confidence cleared) and the
 * document goes back to `active`.
 */
export async function approveReview(
	db: Db,
	id: string,
	patch?: Omit<UpdateDocumentInput, "status">,
): Promise<DocumentDetail> {
	const current = await requireReviewDocument(db, id);
	// Approving freezes the automatic proposals as if a human had accepted them:
	// nothing the trash holds is accepted (SPEC §2).
	assertNotTrashed(current);
	assertApprovable(current.status);

	if (patch && Object.keys(patch).length > 0) {
		await updateDocument(db, id, patch);
	}

	await db.transaction(async (tx) => {
		await tx
			.update(documentParty)
			.set({ source: "manual", confidence: null })
			.where(
				and(eq(documentParty.documentId, id), eq(documentParty.source, "rule")),
			);
		await tx
			.update(documentTag)
			.set({ source: "manual", confidence: null })
			.where(
				and(eq(documentTag.documentId, id), eq(documentTag.source, "rule")),
			);
		await tx
			.update(documentFieldValue)
			.set({ source: "manual", confidence: null })
			.where(
				and(
					eq(documentFieldValue.documentId, id),
					eq(documentFieldValue.source, "rule"),
				),
			);
		await tx
			.update(document)
			.set({ categorySource: "manual", categoryConfidence: null })
			.where(and(eq(document.id, id), eq(document.categorySource, "rule")));
		await tx
			.update(document)
			.set({ status: "active", reviewReasons: [] })
			.where(eq(document.id, id));
	});

	return getDocument(db, id);
}

/**
 * Approves a batch of documents (SPEC): each document is approved in its own
 * transaction, so a problem on one does not roll back the others. A missing
 * id is reported in `failed` rather than raised as an error.
 */
export async function approveManyReview(
	db: Db,
	input: ApproveManyReviewInput,
): Promise<ApproveManyReviewResult> {
	const ids = [...new Set(input.ids)];
	const existing = await db
		.select({ id: document.id, deletedAt: document.deletedAt })
		.from(document)
		.where(inArray(document.id, ids));
	const found = new Set(existing.map((row) => row.id));

	// A trashed document in the selection is a caller mistake, not a per-item
	// failure: reported as such rather than buried in `failed` (SPEC §2).
	const trashed = existing
		.filter((row) => row.deletedAt !== null)
		.map((row) => row.id);
	if (trashed.length > 0) {
		throw new ORPCError("CONFLICT", {
			message: `${TRASHED_DOCUMENT_MESSAGE} (${trashed.join(", ")})`,
		});
	}

	let approved = 0;
	const failed: string[] = [];
	for (const id of ids) {
		if (!found.has(id)) {
			failed.push(id);
			continue;
		}
		try {
			await approveReview(db, id, input.patch);
			approved += 1;
		} catch {
			failed.push(id);
		}
	}

	return { approved, failed };
}

/** Review reasons to drop when an assignment is rejected. */
function reasonMatchesRejection(
	reason: ReviewReason,
	input: RejectAssignmentInput,
): boolean {
	switch (input.kind) {
		case "party":
			return reason.field === "party" || reason.field === "issuer";
		case "category":
			return reason.field === "category";
		case "tag":
			return reason.field === input.ref;
		default:
			return reason.field === input.ref;
	}
}

/**
 * Rejects an automatic assignment: it is removed from the document.
 *
 * Only an assignment produced by a rule or by an agent (`source` `rule` or
 * `mcp`) can be rejected — a value entered by a human is edited, never
 * "rejected", and clearing it here would silently undo their work. An
 * assignment that does not exist is a `NOT_FOUND`, never a silent no-op.
 */
export async function rejectAssignment(
	db: Db,
	input: RejectAssignmentInput,
): Promise<DocumentDetail> {
	const current = await requireReviewDocument(db, input.id);
	assertNotTrashed(current);

	if (input.kind !== "category" && !input.ref) {
		throw new ORPCError("BAD_REQUEST", {
			message: "`ref` is required to reject a Party, a tag or a custom field.",
		});
	}

	switch (input.kind) {
		case "party": {
			const conditions = [
				eq(documentParty.documentId, input.id),
				eq(documentParty.partyId, input.ref ?? ""),
			];
			if (input.role) conditions.push(eq(documentParty.role, input.role));
			const links = await db
				.select({ source: documentParty.source })
				.from(documentParty)
				.where(and(...conditions));
			assertAutomatic(links.map((link) => link.source));
			await db
				.delete(documentParty)
				.where(and(...conditions, ne(documentParty.source, "manual")));
			break;
		}
		case "tag": {
			const conditions = [
				eq(documentTag.documentId, input.id),
				eq(documentTag.tagId, input.ref ?? ""),
			];
			const links = await db
				.select({ source: documentTag.source })
				.from(documentTag)
				.where(and(...conditions));
			assertAutomatic(links.map((link) => link.source));
			await db
				.delete(documentTag)
				.where(and(...conditions, ne(documentTag.source, "manual")));
			break;
		}
		case "category": {
			assertAutomatic(current.categoryId ? [current.categorySource] : []);
			await db
				.update(document)
				.set({
					categoryId: null,
					categorySource: "manual",
					categoryConfidence: null,
				})
				.where(eq(document.id, input.id));
			break;
		}
		default: {
			const conditions = [
				eq(documentFieldValue.documentId, input.id),
				eq(documentFieldValue.fieldId, input.ref ?? ""),
			];
			const values = await db
				.select({ source: documentFieldValue.source })
				.from(documentFieldValue)
				.where(and(...conditions));
			assertAutomatic(values.map((value) => value.source));
			await db
				.delete(documentFieldValue)
				.where(and(...conditions, ne(documentFieldValue.source, "manual")));
			break;
		}
	}

	const rows = await db
		.select({ reviewReasons: document.reviewReasons })
		.from(document)
		.where(eq(document.id, input.id))
		.limit(1);
	const remaining = (rows[0]?.reviewReasons ?? []).filter(
		(reason) => !reasonMatchesRejection(reason, input),
	);
	await db
		.update(document)
		.set({ reviewReasons: remaining })
		.where(eq(document.id, input.id));

	return getDocument(db, input.id);
}

/**
 * Recomputes the review reasons of a document without re-running the whole
 * pipeline: used after a manual rule run may have filled in what was missing.
 * Only drops reasons that no longer apply and moves the document back to
 * `active` if none remain; never auto-approves it.
 */
export async function recomputeReview(
	db: Db,
	id: string,
): Promise<DocumentDetail> {
	// Recomputing may move the document back to `active`: a status change is a
	// write, and the trash takes none (SPEC §2).
	assertNotTrashed(await requireReviewDocument(db, id));
	await computeReviewReasons(db, id);
	return getDocument(db, id);
}

/**
 * Republishes the `document.process` job: the whole pipeline is replayed
 * (extraction, analysis, rules, status).
 */
export async function requeueDocument(
	db: Db,
	id: string,
	ingestion: IngestionBinding | undefined,
	options: { resetReview?: boolean } = {},
): Promise<RequeueResult> {
	// Replaying the pipeline on a trashed document would rewrite its metadata and
	// put it back into `processing`: the trash is read-only (SPEC §2).
	assertNotTrashed(await requireReviewDocument(db, id));

	const queue = ingestion?.queue;
	if (!queue) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message:
				"The ingestion queue is not available: processing cannot be restarted.",
		});
	}

	const files = await db
		.select({ id: documentFile.id, kind: documentFile.kind })
		.from(documentFile)
		.where(eq(documentFile.documentId, id))
		.orderBy(asc(documentFile.createdAt), asc(documentFile.id));
	const file = files.find((row) => row.kind === "original") ?? files[0];
	if (!file) {
		throw new ORPCError("BAD_REQUEST", {
			message: "This document has no file to reprocess.",
		});
	}

	await db
		.update(document)
		.set({
			status: "processing",
			processingError: null,
			...(options.resetReview ? { reviewReasons: [] } : {}),
		})
		.where(eq(document.id, id));

	const jobId = await queue.publishDocumentProcess({
		documentId: id,
		fileId: file.id,
	});

	return { id, jobId };
}
