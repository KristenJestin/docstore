import { emitDocumentEvent, setSensitive } from "@docstore/ingestion";
import {
	clearDocumentFieldValueInput,
	documentBulkInput,
	documentBulkResultSchema,
	documentByAsnInput,
	documentDetailSchema,
	documentDuplicateSchema,
	documentFileLayoutSchema,
	documentListItemSchema,
	documentPartyRoleSchema,
	documentSchema,
	documentStatsSchema,
	documentTagInput,
	duplicateIgnoreResultSchema,
	ignoreDuplicateInput,
	listDocumentDuplicatesInput,
	listDocumentsInput,
	mergeAsVersionResultSchema,
	nextAsnResultSchema,
	setDocumentCategoryInput,
	setDocumentFieldValueInput,
	setDocumentPartiesInput,
	setDocumentTagsInput,
	updateDocumentInput,
} from "@docstore/shared/document";
import { paginatedSchema } from "@docstore/shared/pagination";
import {
	addRelationInput,
	documentRelationSchema,
	mergeAsVersionInput,
	removeRelationInput,
} from "@docstore/shared/relation";
import { requeueResultSchema } from "@docstore/shared/review";
import { z } from "zod";
import type { Context } from "../context";
import { protectedProcedure, writeProcedure } from "../index";
import {
	addDocumentParty,
	addDocumentTag,
	assignAsn,
	bulkDocuments,
	clearDocumentFieldValue,
	deleteDocumentPermanently,
	getDocument,
	getDocumentByAsn,
	getDocumentFileLayout,
	getDocumentStats,
	ignoreDuplicate,
	listDocumentDuplicates,
	listDocuments,
	mergeAsVersion,
	nextAsn,
	removeDocumentParty,
	removeDocumentTag,
	restoreDocument,
	setDocumentCategory,
	setDocumentFieldValue,
	setDocumentParties,
	setDocumentTags,
	trashDocument,
	type UpdateDocumentOptions,
	unignoreDuplicate,
	updateDocument,
} from "../services/document.service";
import { deleteStorageObjects } from "../services/file.service";
import { addRelation, removeRelation } from "../services/relation.service";
import { requeueDocument } from "../services/review.service";

const TAGS = ["Document"];

const idInput = z.object({ id: z.string().min(1) });

/**
 * Hook that keeps encryption at rest in sync with the `sensitive` flag
 * (SPEC §8 iteration 7). Without an ingestion pipeline there is no storage to
 * re-key: only the column moves.
 */
function sensitiveHook(context: Context): UpdateDocumentOptions {
	const ingestion = context.ingestion;
	if (!ingestion) return {};
	return {
		onSensitiveChange: (documentId, sensitive) =>
			setSensitive(ingestion.ctx, documentId, sensitive),
	};
}

const partyLinkInput = z.object({
	id: z.string().min(1),
	partyId: z.string().min(1),
	role: documentPartyRoleSchema,
});

export const documentRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/documents",
			tags: TAGS,
			summary: "List documents (full-text search + filters)",
		})
		.input(listDocumentsInput)
		.output(paginatedSchema(documentListItemSchema))
		.handler(({ input, context }) => listDocuments(context.db, input)),

	stats: protectedProcedure
		.route({
			method: "GET",
			path: "/documents/stats",
			tags: TAGS,
			summary: "Document counters for the dashboard",
		})
		.input(z.object({}))
		.output(documentStatsSchema)
		.handler(({ context }) => getDocumentStats(context.db)),

	duplicates: protectedProcedure
		.route({
			method: "GET",
			path: "/documents/duplicates",
			tags: TAGS,
			summary: "Pairs of potentially duplicate documents",
		})
		.input(listDocumentDuplicatesInput)
		.output(z.array(documentDuplicateSchema))
		.handler(({ input, context }) => listDocumentDuplicates(context.db, input)),

	ignoreDuplicate: writeProcedure
		.route({
			method: "POST",
			path: "/documents/duplicates/ignore",
			tags: TAGS,
			summary: "Dismiss a duplicate pair: it stops being reported",
		})
		.input(ignoreDuplicateInput)
		.output(duplicateIgnoreResultSchema)
		.handler(({ input, context }) => ignoreDuplicate(context.db, input)),

	unignoreDuplicate: writeProcedure
		.route({
			method: "POST",
			path: "/documents/duplicates/unignore",
			tags: TAGS,
			summary: "Un-dismiss a duplicate pair: it can be reported again",
		})
		.input(ignoreDuplicateInput)
		.output(duplicateIgnoreResultSchema)
		.handler(({ input, context }) => unignoreDuplicate(context.db, input)),

	nextAsn: protectedProcedure
		.route({
			method: "GET",
			path: "/documents/next-asn",
			tags: TAGS,
			summary: "Next free archive serial number",
		})
		.input(z.object({}))
		.output(nextAsnResultSchema)
		.handler(({ context }) => nextAsn(context.db)),

	byAsn: protectedProcedure
		.route({
			method: "GET",
			path: "/documents/by-asn/{asn}",
			tags: TAGS,
			summary: "Document carrying this archive serial number",
		})
		.input(documentByAsnInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) => getDocumentByAsn(context.db, input.asn)),

	assignAsn: writeProcedure
		.route({
			method: "POST",
			path: "/documents/{id}/asn",
			tags: TAGS,
			summary: "Assign the next ASN to the document (no-op if it has one)",
		})
		.input(idInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) => assignAsn(context.db, input.id)),

	bulk: writeProcedure
		.route({
			method: "POST",
			path: "/documents/bulk",
			tags: TAGS,
			summary: "Bulk action on a selection of documents",
		})
		.input(documentBulkInput)
		.output(documentBulkResultSchema)
		.handler(({ input, context }) =>
			bulkDocuments(context.db, input, sensitiveHook(context)),
		),

	addRelation: writeProcedure
		.route({
			method: "POST",
			path: "/documents/relations",
			tags: TAGS,
			summary: "Link two documents (version, page, replacement...)",
			successStatus: 201,
		})
		.input(addRelationInput)
		.output(documentRelationSchema)
		.handler(({ input, context }) => addRelation(context.db, input)),

	removeRelation: writeProcedure
		.route({
			method: "DELETE",
			path: "/documents/relations/{id}",
			tags: TAGS,
			summary: "Delete a relation between two documents",
		})
		.input(removeRelationInput)
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) => removeRelation(context.db, input.id)),

	mergeAsVersion: writeProcedure
		.route({
			method: "POST",
			path: "/documents/merge-as-version",
			tags: TAGS,
			summary:
				'Merge a duplicate into a document: files moved, "version_of" relation, trash',
		})
		.input(mergeAsVersionInput)
		.output(mergeAsVersionResultSchema)
		.handler(({ input, context }) => mergeAsVersion(context.db, input)),

	getFileLayout: protectedProcedure
		.route({
			method: "GET",
			path: "/documents/files/{fileId}/layout",
			tags: TAGS,
			summary: "OCR layer (words + bbox) of a file",
		})
		.input(z.object({ fileId: z.string().min(1) }))
		.output(documentFileLayoutSchema)
		.handler(({ input, context }) =>
			getDocumentFileLayout(context.db, input.fileId),
		),

	get: protectedProcedure
		.route({
			method: "GET",
			path: "/documents/{id}",
			tags: TAGS,
			summary: "Document detail (files + linked Parties)",
		})
		.input(idInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) => getDocument(context.db, input.id)),

	update: writeProcedure
		.route({
			method: "PATCH",
			path: "/documents/{id}",
			tags: TAGS,
			summary: "Update the metadata of a document",
		})
		.input(updateDocumentInput.extend(idInput.shape))
		.output(documentDetailSchema)
		.handler(async ({ input, context }) => {
			const { id, ...patch } = input;
			const updated = await updateDocument(
				context.db,
				id,
				patch,
				sensitiveHook(context),
			);
			// SPEC §2 "Miscellaneous": `document.updated` subscribers are notified
			// afterwards, with the state actually persisted.
			if (context.ingestion) {
				await emitDocumentEvent(context.ingestion.ctx, "document.updated", id);
			}
			return updated;
		}),

	setParties: writeProcedure
		.route({
			method: "PUT",
			path: "/documents/{id}/parties",
			tags: TAGS,
			summary: 'Replace every linked Party (source "manual")',
		})
		.input(setDocumentPartiesInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) =>
			setDocumentParties(context.db, input.id, input.parties),
		),

	addParty: writeProcedure
		.route({
			method: "POST",
			path: "/documents/{id}/parties",
			tags: TAGS,
			summary: "Link a Party to the document",
		})
		.input(partyLinkInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) =>
			addDocumentParty(context.db, input.id, input.partyId, input.role),
		),

	removeParty: writeProcedure
		.route({
			method: "DELETE",
			path: "/documents/{id}/parties/{partyId}/{role}",
			tags: TAGS,
			summary: "Unlink a Party from the document",
		})
		.input(partyLinkInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) =>
			removeDocumentParty(context.db, input.id, input.partyId, input.role),
		),

	setCategory: writeProcedure
		.route({
			method: "PUT",
			path: "/documents/{id}/category",
			tags: TAGS,
			summary: "Assign (or clear) the category of the document",
		})
		.input(setDocumentCategoryInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) =>
			setDocumentCategory(context.db, input.id, input.categoryId),
		),

	setTags: writeProcedure
		.route({
			method: "PUT",
			path: "/documents/{id}/tags",
			tags: TAGS,
			summary: 'Replace every tag of the document (source "manual")',
		})
		.input(setDocumentTagsInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) =>
			setDocumentTags(context.db, input.id, input.tagIds),
		),

	addTag: writeProcedure
		.route({
			method: "POST",
			path: "/documents/{id}/tags",
			tags: TAGS,
			summary: "Add a tag to the document",
		})
		.input(documentTagInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) =>
			addDocumentTag(context.db, input.id, input.tagId),
		),

	removeTag: writeProcedure
		.route({
			method: "DELETE",
			path: "/documents/{id}/tags/{tagId}",
			tags: TAGS,
			summary: "Remove a tag from the document",
		})
		.input(documentTagInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) =>
			removeDocumentTag(context.db, input.id, input.tagId),
		),

	setFieldValue: writeProcedure
		.route({
			method: "PUT",
			path: "/documents/{id}/fields/{fieldId}",
			tags: TAGS,
			summary: "Set the value of a custom field",
		})
		.input(setDocumentFieldValueInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) =>
			setDocumentFieldValue(context.db, input.id, input.fieldId, input.value, {
				source: input.source,
				confidence: input.confidence ?? null,
			}),
		),

	clearFieldValue: writeProcedure
		.route({
			method: "DELETE",
			path: "/documents/{id}/fields/{fieldId}",
			tags: TAGS,
			summary: "Clear the value of a custom field",
		})
		.input(clearDocumentFieldValueInput)
		.output(documentDetailSchema)
		.handler(({ input, context }) =>
			clearDocumentFieldValue(context.db, input.id, input.fieldId),
		),

	reprocess: writeProcedure
		.route({
			method: "POST",
			path: "/documents/{id}/reprocess",
			tags: TAGS,
			summary: "Re-publish the processing job (OCR, analysis, rules)",
		})
		.input(idInput)
		.output(requeueResultSchema)
		.handler(({ input, context }) =>
			requeueDocument(context.db, input.id, context.ingestion),
		),

	trash: writeProcedure
		.route({
			method: "POST",
			path: "/documents/{id}/trash",
			tags: TAGS,
			summary: "Move a document to the trash (soft delete)",
		})
		.input(idInput)
		.output(documentSchema)
		.handler(({ input, context }) => trashDocument(context.db, input.id)),

	restore: writeProcedure
		.route({
			method: "POST",
			path: "/documents/{id}/restore",
			tags: TAGS,
			summary: "Restore a document from the trash",
		})
		.input(idInput)
		.output(documentSchema)
		.handler(({ input, context }) => restoreDocument(context.db, input.id)),

	deletePermanently: writeProcedure
		.route({
			method: "DELETE",
			path: "/documents/{id}",
			tags: TAGS,
			summary: "Permanently delete a document and its files",
		})
		.input(idInput)
		.output(
			z.object({
				id: z.string(),
				deleted: z.literal(true),
				storageKeys: z.array(z.string()),
			}),
		)
		.handler(({ input, context }) => {
			// Physical deletion of the objects through the ingestion storage.
			const storage = context.ingestion?.ctx.storage;
			return deleteDocumentPermanently(context.db, input.id, {
				onDeleteFiles: storage
					? (keys) => deleteStorageObjects(storage, keys)
					: undefined,
			});
		}),
};
