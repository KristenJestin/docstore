import {
	addDocumentParty,
	getDocument,
	getDocumentStats,
	ignoreDuplicate,
	listDocuments,
	removeDocumentParty,
	setDocumentCategory,
	setDocumentFieldValue,
	setDocumentTags,
	trashDocument,
	updateDocument,
} from "@docstore/api/services/document.service";
import {
	approveReview,
	countReview,
	listReview,
	rejectAssignment,
	requeueDocument,
} from "@docstore/api/services/review.service";
import { setSensitive } from "@docstore/ingestion";
import { dateOnlySchema } from "@docstore/shared/common";
import { customFieldValueSchema } from "@docstore/shared/custom-field";
import {
	documentPartyRoleSchema,
	documentStatusSchema,
	updateDocumentInput,
} from "@docstore/shared/document";
import { reviewAssignmentKindSchema } from "@docstore/shared/review";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "./context";
import {
	canReadSensitive,
	defineTool,
	McpToolError,
	requireIngestion,
	requireWrite,
} from "./context";
import { mcpBoolean } from "./schema";
import {
	describeDocument,
	describeDocumentDetail,
	documentDetailJson,
	documentSummaryJson,
	reviewItemJson,
	toDocumentDetail,
	toDocumentSummary,
	toReviewItem,
} from "./serialize";

/** Message shown in place of the text of a sensitive document. */
export const SENSITIVE_PLACEHOLDER =
	"[sensitive document: `sensitive` scope required]";

const idInput = { id: z.string().min(1).describe("Document identifier") };

const pageOutput = {
	items: z.array(documentSummaryJson),
	page: z.number(),
	pageSize: z.number(),
	total: z.number(),
	totalPages: z.number(),
};

// `sensitive` is widened for the MCP clients that send booleans as
// strings; everything else keeps the shared validation of `document.update`.
const documentPatch = updateDocumentInput
	.omit({ status: true })
	.extend({ sensitive: mcpBoolean.optional() });

export function registerDocumentTools(
	server: McpServer,
	context: McpContext,
): void {
	defineTool(
		server,
		"search_documents",
		{
			title: "Search documents",
			description:
				"French full-text search plus filters: category (subtree included), tags (all required), Party, status, year, date range, sensitive flag.",
			inputSchema: {
				query: z.string().trim().min(1).optional(),
				categoryId: z.string().min(1).optional(),
				tagIds: z.array(z.string().min(1)).optional(),
				partyId: z.string().min(1).optional(),
				status: documentStatusSchema.optional(),
				year: z.number().int().min(1000).max(9999).optional(),
				dateFrom: dateOnlySchema.optional(),
				dateTo: dateOnlySchema.optional(),
				sensitive: mcpBoolean.optional(),
				page: z.number().int().min(1).optional(),
				pageSize: z.number().int().min(1).max(100).optional(),
			},
			outputSchema: pageOutput,
			text: (output) =>
				output.items.length === 0
					? "No document matches."
					: `${output.total} document(s), page ${output.page}/${output.totalPages}:\n${output.items
							.map((item) => `- ${describeDocument(item)}`)
							.join("\n")}`,
		},
		async (input) => {
			const page = await listDocuments(context.db, {
				query: input.query,
				categoryId: input.categoryId,
				tagIds: input.tagIds,
				partyId: input.partyId,
				status: input.status,
				year: input.year,
				dateFrom: input.dateFrom,
				dateTo: input.dateTo,
				sensitive: input.sensitive,
				deleted: "exclude",
				page: input.page ?? 1,
				pageSize: input.pageSize ?? 25,
				sort: "documentDate:desc",
			});
			return { ...page, items: page.items.map(toDocumentSummary) };
		},
	);

	defineTool(
		server,
		"get_document",
		{
			title: "Document detail",
			description:
				"Full metadata of a document: dates, category, tags, linked Parties, custom fields, free-text notes, files, and its document type with the selected layout (`computed`, or `forced`/`excluded` by hand). The OCR text is not included (see `get_document_text`).",
			inputSchema: idInput,
			outputSchema: documentDetailJson.shape,
			text: (output) => describeDocumentDetail(output),
		},
		async (input) => toDocumentDetail(await getDocument(context.db, input.id)),
	);

	defineTool(
		server,
		"get_document_text",
		{
			title: "Document OCR text",
			description:
				"Returns the text extracted from the document. A document flagged as sensitive requires the `sensitive` scope on the API key.",
			inputSchema: {
				...idInput,
				maxChars: z
					.number()
					.int()
					.min(100)
					.max(200_000)
					.optional()
					.describe("Truncates the returned text (default: 20,000)."),
			},
			outputSchema: {
				id: z.string(),
				title: z.string(),
				sensitive: z.boolean(),
				masked: z.boolean(),
				truncated: z.boolean(),
				text: z.string(),
			},
			text: (output) => output.text,
		},
		async (input) => {
			const detail = await getDocument(context.db, input.id);
			if (detail.sensitive && !canReadSensitive(context)) {
				return {
					id: detail.id,
					title: detail.title,
					sensitive: true,
					masked: true,
					truncated: false,
					text: SENSITIVE_PLACEHOLDER,
				};
			}
			const content = detail.content ?? "";
			const limit = input.maxChars ?? 20_000;
			return {
				id: detail.id,
				title: detail.title,
				sensitive: detail.sensitive,
				masked: false,
				truncated: content.length > limit,
				text: content.slice(0, limit),
			};
		},
	);

	defineTool(
		server,
		"list_review_queue",
		{
			title: "Review queue",
			description:
				"Documents whose ingestion produced low-confidence proposals, with the reasons they were queued.",
			inputSchema: { page: z.number().int().min(1).optional() },
			outputSchema: {
				items: z.array(reviewItemJson),
				page: z.number(),
				pageSize: z.number(),
				total: z.number(),
				totalPages: z.number(),
			},
			text: (output) =>
				output.items.length === 0
					? "The review queue is empty."
					: `${output.total} document(s) to review:\n${output.items
							.map(
								(item) =>
									`- ${describeDocument(item)} — reasons: ${item.reviewReasons
										.map((reason) => reason.message)
										.join("; ")}`,
							)
							.join("\n")}`,
		},
		async (input) => {
			const page = await listReview(context.db, {
				page: input.page ?? 1,
				pageSize: 25,
			});
			return { ...page, items: page.items.map(toReviewItem) };
		},
	);

	defineTool(
		server,
		"approve_review",
		{
			title: "Approve a document under review",
			description:
				"Applies an optional patch, turns the automatic assignments into manual ones and moves the document back to `active`.",
			inputSchema: { ...idInput, patch: documentPatch.optional() },
			outputSchema: documentDetailJson.shape,
			text: (output) => `Document approved: ${describeDocument(output)}`,
		},
		async (input) => {
			requireWrite(context);
			return toDocumentDetail(
				await approveReview(context.db, input.id, input.patch),
			);
		},
	);

	defineTool(
		server,
		"reject_assignment",
		{
			title: "Reject an automatic assignment",
			description:
				"Removes an assignment proposed by the rules: Party (`ref` = partyId), tag (`ref` = tagId), field (`ref` = fieldId) or category (`ref` not needed).",
			inputSchema: {
				...idInput,
				kind: reviewAssignmentKindSchema,
				ref: z.string().min(1).optional(),
				role: documentPartyRoleSchema.optional(),
			},
			outputSchema: documentDetailJson.shape,
			text: (output) => `Assignment rejected: ${describeDocument(output)}`,
		},
		async (input) => {
			requireWrite(context);
			return toDocumentDetail(
				await rejectAssignment(context.db, {
					id: input.id,
					kind: input.kind,
					ref: input.ref,
					role: input.role,
				}),
			);
		},
	);

	defineTool(
		server,
		"update_document",
		{
			title: "Update document metadata",
			description:
				"Title, free-text notes (light Markdown, indexed by the search), document date and its precision (`day`/`month`/`year`), covered period, validity, sensitive flag, archive serial number (ASN) and physical location.",
			inputSchema: { ...idInput, patch: documentPatch },
			outputSchema: documentDetailJson.shape,
			text: (output) => `Document updated: ${describeDocument(output)}`,
		},
		async (input) => {
			requireWrite(context);
			// Flipping `sensitive` re-keys the stored files (SPEC §8 iteration 7).
			const ingestion = context.ingestion;
			return toDocumentDetail(
				await updateDocument(context.db, input.id, input.patch, {
					onSensitiveChange: ingestion
						? (documentId, sensitive) =>
								setSensitive(ingestion.ctx, documentId, sensitive)
						: undefined,
				}),
			);
		},
	);

	defineTool(
		server,
		"set_document_category",
		{
			title: "Assign a category",
			description:
				"Replaces the category of the document; `categoryId: null` removes it.",
			inputSchema: { ...idInput, categoryId: z.string().min(1).nullable() },
			outputSchema: documentDetailJson.shape,
			text: (output) =>
				output.category
					? `Category "${output.category.name}" assigned to ${output.id}.`
					: `Category removed from ${output.id}.`,
		},
		async (input) => {
			requireWrite(context);
			return toDocumentDetail(
				await setDocumentCategory(context.db, input.id, input.categoryId),
			);
		},
	);

	defineTool(
		server,
		"set_document_tags",
		{
			title: "Replace the tags of a document",
			description:
				"Replaces the whole tag set (source `manual`). Passing an empty list removes every tag.",
			inputSchema: { ...idInput, tagIds: z.array(z.string().min(1)) },
			outputSchema: documentDetailJson.shape,
			text: (output) =>
				`Tags of ${output.id}: ${
					output.tags.map((tag) => tag.name).join(", ") || "none"
				}.`,
		},
		async (input) => {
			requireWrite(context);
			return toDocumentDetail(
				await setDocumentTags(context.db, input.id, input.tagIds),
			);
		},
	);

	defineTool(
		server,
		"link_party",
		{
			title: "Link a Party to a document",
			description:
				"Roles: `issuer`, `recipient`, `subject` (the person concerned), `mentioned` (cited).",
			inputSchema: {
				documentId: z.string().min(1),
				partyId: z.string().min(1),
				role: documentPartyRoleSchema,
			},
			outputSchema: documentDetailJson.shape,
			text: (output) => `Party linked: ${describeDocument(output)}`,
		},
		async (input) => {
			requireWrite(context);
			return toDocumentDetail(
				await addDocumentParty(
					context.db,
					input.documentId,
					input.partyId,
					input.role,
				),
			);
		},
	);

	defineTool(
		server,
		"unlink_party",
		{
			title: "Unlink a Party from a document",
			description: "Removes the Party/document link for the given role.",
			inputSchema: {
				documentId: z.string().min(1),
				partyId: z.string().min(1),
				role: documentPartyRoleSchema,
			},
			outputSchema: documentDetailJson.shape,
			text: (output) => `Party unlinked: ${describeDocument(output)}`,
		},
		async (input) => {
			requireWrite(context);
			return toDocumentDetail(
				await removeDocumentParty(
					context.db,
					input.documentId,
					input.partyId,
					input.role,
				),
			);
		},
	);

	defineTool(
		server,
		"set_field_value",
		{
			title: "Set a custom field",
			description:
				'The value is typed: `{kind:"text",text}`, `{kind:"number",number}`, `{kind:"money",amount,currency}`, `{kind:"date",date}`, `{kind:"boolean",boolean}`, `{kind:"select",choice}`, `{kind:"url",url}`, `{kind:"party_ref",partyId}`.',
			inputSchema: {
				documentId: z.string().min(1),
				fieldId: z.string().min(1),
				value: customFieldValueSchema,
			},
			outputSchema: documentDetailJson.shape,
			text: (output) => `Field saved on ${output.id}.`,
		},
		async (input) => {
			requireWrite(context);
			return toDocumentDetail(
				await setDocumentFieldValue(
					context.db,
					input.documentId,
					input.fieldId,
					input.value,
				),
			);
		},
	);

	defineTool(
		server,
		"trash_document",
		{
			title: "Move a document to the trash",
			description:
				"Soft delete: the document stays restorable from the interface.",
			inputSchema: idInput,
			outputSchema: {
				id: z.string(),
				title: z.string(),
				deletedAt: z.string().nullable(),
			},
			text: (output) => `Document "${output.title}" moved to the trash.`,
		},
		async (input) => {
			requireWrite(context);
			const row = await trashDocument(context.db, input.id);
			return {
				id: row.id,
				title: row.title,
				deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
			};
		},
	);

	defineTool(
		server,
		"ignore_duplicate",
		{
			title: "Dismiss a duplicate pair",
			description:
				"Marks two documents flagged as potential duplicates as distinct: the pair stops being reported by the duplicates screen.",
			inputSchema: {
				documentId: z.string().min(1),
				otherDocumentId: z.string().min(1),
			},
			outputSchema: {
				documentId: z.string(),
				otherDocumentId: z.string(),
				ignored: z.boolean(),
			},
			text: (output) =>
				`Duplicate pair dismissed: ${output.documentId} / ${output.otherDocumentId}.`,
		},
		async (input) => {
			requireWrite(context);
			return ignoreDuplicate(context.db, {
				documentId: input.documentId,
				otherDocumentId: input.otherDocumentId,
			});
		},
	);

	defineTool(
		server,
		"reprocess_document",
		{
			title: "Reprocess a document",
			description:
				"Republishes the ingestion job: OCR, analysis, rules and status computation are replayed.",
			inputSchema: idInput,
			outputSchema: { id: z.string(), jobId: z.string().nullable() },
			text: (output) =>
				`Processing restarted for ${output.id}${
					output.jobId ? ` (job ${output.jobId})` : ""
				}.`,
		},
		async (input) => {
			requireWrite(context);
			const ingestion = requireIngestion(context);
			return requeueDocument(context.db, input.id, ingestion);
		},
	);

	defineTool(
		server,
		"get_stats",
		{
			title: "Document store counters",
			description:
				"Total number of documents, breakdown by status and size of the review queue.",
			inputSchema: {},
			outputSchema: {
				total: z.number(),
				byStatus: z.record(z.string(), z.number()),
				review: z.number(),
				reviewQueue: z.number(),
			},
			text: (output) =>
				`${output.total} document(s) — ${Object.entries(output.byStatus)
					.map(([status, count]) => `${status}: ${count}`)
					.join(", ")} — ${output.reviewQueue} to review.`,
		},
		async () => {
			const [stats, review] = await Promise.all([
				getDocumentStats(context.db),
				countReview(context.db),
			]);
			return {
				total: stats.total,
				byStatus: stats.byStatus as Record<string, number>,
				review: stats.review,
				reviewQueue: review.count,
			};
		},
	);
}

/** Reused by the resources: JSON detail or a clear error. */
export async function readDocumentResource(
	context: McpContext,
	id: string,
): Promise<string> {
	const detail = await getDocument(context.db, id);
	if (!detail) {
		throw new McpToolError(`Document "${id}" not found.`);
	}
	return JSON.stringify(toDocumentDetail(detail), null, 2);
}
