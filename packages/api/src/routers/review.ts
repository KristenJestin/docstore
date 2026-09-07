import { documentDetailSchema } from "@docstore/shared/document";
import { paginatedSchema } from "@docstore/shared/pagination";
import {
	approveManyReviewInput,
	approveManyReviewResultSchema,
	approveReviewInput,
	listReviewInput,
	recomputeReviewInput,
	rejectAssignmentInput,
	requeueResultSchema,
	reviewCountSchema,
	reviewItemSchema,
} from "@docstore/shared/review";
import { z } from "zod";
import { protectedProcedure, writeProcedure } from "../index";
import {
	approveManyReview,
	approveReview,
	countReview,
	listReview,
	recomputeReview,
	rejectAssignment,
	requeueDocument,
} from "../services/review.service";

const TAGS = ["Review"];

export const reviewRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/review",
			tags: TAGS,
			summary: "Documents awaiting review, with their reasons",
		})
		.input(listReviewInput)
		.output(paginatedSchema(reviewItemSchema))
		.handler(({ input, context }) => listReview(context.db, input)),

	count: protectedProcedure
		.route({
			method: "GET",
			path: "/review/count",
			tags: TAGS,
			summary: "Number of documents to review (navigation badge)",
		})
		.input(z.object({}))
		.output(reviewCountSchema)
		.handler(({ context }) => countReview(context.db)),

	approve: writeProcedure
		.route({
			method: "POST",
			path: "/review/{id}/approve",
			tags: TAGS,
			summary: "Approve a document: automatic assignments become manual",
		})
		.input(approveReviewInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) =>
			approveReview(context.db, input.id, input.patch),
		),

	approveMany: writeProcedure
		.route({
			method: "POST",
			path: "/review/approve-many",
			tags: TAGS,
			summary:
				"Approve a batch of documents (transactional per document); missing or failing ids are reported in `failed`",
		})
		.input(approveManyReviewInput)
		.output(approveManyReviewResultSchema)
		.handler(({ input, context }) => approveManyReview(context.db, input)),

	rejectAssignment: writeProcedure
		.route({
			method: "POST",
			path: "/review/{id}/reject",
			tags: TAGS,
			summary: "Reject an automatic assignment (Party, tag, category, field)",
		})
		.input(rejectAssignmentInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) => rejectAssignment(context.db, input)),

	recompute: writeProcedure
		.route({
			method: "POST",
			path: "/review/{id}/recompute",
			tags: TAGS,
			summary:
				"Refresh the review reasons of a document (e.g. after a manual rule run)",
		})
		.input(recomputeReviewInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) => recomputeReview(context.db, input.id)),

	requeue: writeProcedure
		.route({
			method: "POST",
			path: "/review/{id}/requeue",
			tags: TAGS,
			summary: "Re-run the full pipeline on a document",
		})
		.input(z.object({ id: z.string().min(1) }))
		.output(requeueResultSchema)
		.handler(({ input, context }) =>
			requeueDocument(context.db, input.id, context.ingestion, {
				resetReview: true,
			}),
		),
};
