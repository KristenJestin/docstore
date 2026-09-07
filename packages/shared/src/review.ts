import { z } from "zod";
import {
	documentListItemSchema,
	documentPartyRoleSchema,
	reviewReasonSchema,
	updateDocumentInput,
} from "./document";

/**
 * Review queue (SPEC §4/§5): documents whose ingestion produced low-confidence
 * suggestions, which the user approves or corrects.
 */

export const reviewItemSchema = documentListItemSchema.extend({
	reviewReasons: z.array(reviewReasonSchema),
});
export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const listReviewInput = z.object({
	page: z.int().min(1).default(1),
	pageSize: z.int().min(1).max(100).default(25),
});
export type ListReviewInput = z.infer<typeof listReviewInput>;

export const approveReviewInput = z.object({
	id: z.string().min(1),
	/** Corrections applied before the approval. */
	patch: updateDocumentInput.omit({ status: true }).optional(),
});
export type ApproveReviewInput = z.infer<typeof approveReviewInput>;

/**
 * Batch approval: each document is approved in its own transaction, so one
 * missing or failing id does not block the others (reported in `failed`).
 */
export const approveManyReviewInput = z.object({
	ids: z.array(z.string().min(1)).min(1).max(500),
	/** Same corrections applied to every document before its approval. */
	patch: updateDocumentInput.omit({ status: true }).optional(),
});
export type ApproveManyReviewInput = z.infer<typeof approveManyReviewInput>;

export const approveManyReviewResultSchema = z.object({
	approved: z.int().min(0),
	/** Ids skipped: missing, or that failed to approve. */
	failed: z.array(z.string()),
});
export type ApproveManyReviewResult = z.infer<
	typeof approveManyReviewResultSchema
>;

/** Nature of the rejected automatic assignment. */
export const REVIEW_ASSIGNMENT_KINDS = [
	"party",
	"tag",
	"category",
	"field",
] as const;
export const reviewAssignmentKindSchema = z.enum(REVIEW_ASSIGNMENT_KINDS);
export type ReviewAssignmentKind = z.infer<typeof reviewAssignmentKindSchema>;

export const rejectAssignmentInput = z.object({
	id: z.string().min(1),
	kind: reviewAssignmentKindSchema,
	/**
	 * Target of the rejection: `partyId`, `tagId` or `fieldId`. Useless (and
	 * ignored) for `category`, which only exists once.
	 */
	ref: z.string().min(1).optional(),
	/** Role of the Party link to remove; all of them when absent. */
	role: documentPartyRoleSchema.optional(),
});
export type RejectAssignmentInput = z.infer<typeof rejectAssignmentInput>;

export const reviewCountSchema = z.object({ count: z.int().min(0) });
export type ReviewCount = z.infer<typeof reviewCountSchema>;

export const requeueResultSchema = z.object({
	id: z.string(),
	jobId: z.string().nullable(),
});
export type RequeueResult = z.infer<typeof requeueResultSchema>;

/** Recomputes the review reasons of a document (e.g. after a manual rule run). */
export const recomputeReviewInput = z.object({ id: z.string().min(1) });
export type RecomputeReviewInput = z.infer<typeof recomputeReviewInput>;
