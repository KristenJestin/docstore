import {
	addDocumentTypeLayoutInput,
	applyDocumentTypeInput,
	applyDocumentTypeResultSchema,
	createDocumentTypeFromDocumentInput,
	createDocumentTypeFromSuggestionInput,
	createDocumentTypeInput,
	createLayoutFromDocumentInput,
	deleteDocumentTypeInput,
	detectDocumentTypeInput,
	detectDocumentTypeResultSchema,
	documentTypeDetailSchema,
	documentTypeItemSchema,
	documentTypeLayoutSchema,
	documentTypeSchema,
	documentTypeSuggestionSchema,
	documentTypeTitlePreviewSchema,
	ensureGenericDocumentTypeInput,
	listDocumentTypesInput,
	previewDocumentTypeInput,
	previewDocumentTypeResultSchema,
	previewDocumentTypeTitlesInput,
	regenerateDocumentTypeTitlesInput,
	regenerateTitlesResultSchema,
	removeDocumentTypeLayoutInput,
	reorderDocumentTypeLayoutsInput,
	reorderDocumentTypesInput,
	savedDocumentTypeLayoutSchema,
	setDefaultDocumentTypeLayoutInput,
	setDocumentTypeOverrideInput,
	testDocumentTypeLayoutInput,
	testDocumentTypeLayoutResultSchema,
	toggleDocumentTypeInput,
	updateDocumentTypeInput,
	updateDocumentTypeLayoutInput,
} from "@docstore/shared/document-type";
import { z } from "zod";
import type { Context } from "../context";
import { protectedProcedure, writeProcedure } from "../index";
import {
	addLayout,
	applyDocumentType,
	createDocumentType,
	createDocumentTypeFromDocument,
	createDocumentTypeFromSuggestion,
	createLayoutFromDocument,
	type DocumentTypeServiceOptions,
	deleteDocumentType,
	detectDocumentType,
	ensureGenericForCategory,
	getDocumentType,
	listDocumentTypes,
	previewDocumentType,
	previewDocumentTypeTitles,
	regenerateDocumentTypeTitles,
	removeLayout,
	reorderDocumentTypes,
	reorderLayouts,
	setDefaultLayout,
	setDocumentOverride,
	suggestDocumentTypes,
	testLayout,
	toggleDocumentType,
	updateDocumentType,
	updateLayout,
} from "../services/document-type.service";

const TAGS = ["Document type"];

const idInput = z.object({ id: z.string().min(1) });

/** Applying a type may raise `sensitive`, which re-keys the files at rest. */
function ingestionOptions(context: Context): DocumentTypeServiceOptions {
	const ingestion = context.ingestion;
	return ingestion ? { ingestion: ingestion.ctx } : {};
}

export const documentTypeRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/document-types",
			tags: TAGS,
			summary: "List document types, with the stats of the recurring ones",
		})
		.input(listDocumentTypesInput)
		.output(z.array(documentTypeItemSchema))
		.handler(({ input, context }) => listDocumentTypes(context.db, input)),

	suggest: protectedProcedure
		.route({
			method: "GET",
			path: "/document-types/suggestions",
			tags: TAGS,
			summary: "Suggest recurring document types from existing documents",
		})
		.input(z.object({}))
		.output(z.array(documentTypeSuggestionSchema))
		.handler(({ context }) => suggestDocumentTypes(context.db)),

	get: protectedProcedure
		.route({
			method: "GET",
			path: "/document-types/{id}",
			tags: TAGS,
			summary: "Document type detail: layouts and period-by-period timeline",
		})
		.input(idInput)
		.output(documentTypeDetailSchema)
		.handler(({ input, context }) => getDocumentType(context.db, input.id)),

	create: writeProcedure
		.route({
			method: "POST",
			path: "/document-types",
			tags: TAGS,
			summary: "Create a document type",
			successStatus: 201,
		})
		.input(createDocumentTypeInput)
		.output(documentTypeSchema)
		.handler(({ input, context }) => createDocumentType(context.db, input)),

	createFromDocument: writeProcedure
		.route({
			method: "POST",
			path: "/document-types/from-document",
			tags: TAGS,
			summary: "Create a type prefilled from a document, and apply it to it",
			successStatus: 201,
		})
		.input(createDocumentTypeFromDocumentInput)
		.output(documentTypeDetailSchema)
		.handler(({ input, context }) =>
			createDocumentTypeFromDocument(
				context.db,
				input,
				ingestionOptions(context),
			),
		),

	ensureGenericForCategory: writeProcedure
		.route({
			method: "POST",
			path: "/document-types/generic",
			tags: TAGS,
			summary:
				"Get (creating it on first use) the `Any <Category>` type holding the extraction rules of a category",
		})
		.input(ensureGenericDocumentTypeInput)
		.output(documentTypeDetailSchema)
		.handler(({ input, context }) =>
			ensureGenericForCategory(context.db, input),
		),

	createFromSuggestion: writeProcedure
		.route({
			method: "POST",
			path: "/document-types/from-suggestion",
			tags: TAGS,
			summary: "Create the recurring type behind a suggestion",
			successStatus: 201,
		})
		.input(createDocumentTypeFromSuggestionInput)
		.output(documentTypeItemSchema)
		.handler(({ input, context }) =>
			createDocumentTypeFromSuggestion(context.db, input),
		),

	update: writeProcedure
		.route({
			method: "PATCH",
			path: "/document-types/{id}",
			tags: TAGS,
			summary: "Update a document type",
		})
		.input(updateDocumentTypeInput)
		.output(documentTypeSchema)
		.handler(({ input, context }) => updateDocumentType(context.db, input)),

	delete: writeProcedure
		.route({
			method: "DELETE",
			path: "/document-types/{id}",
			tags: TAGS,
			summary: "Delete a document type (documents are kept)",
		})
		.input(deleteDocumentTypeInput)
		.output(
			z.object({
				id: z.string(),
				deleted: z.literal(true),
				detached: z.int().min(0),
			}),
		)
		.handler(({ input, context }) => deleteDocumentType(context.db, input)),

	toggle: writeProcedure
		.route({
			method: "POST",
			path: "/document-types/{id}/toggle",
			tags: TAGS,
			summary: "Enable or disable a document type",
		})
		.input(toggleDocumentTypeInput)
		.output(documentTypeSchema)
		.handler(({ input, context }) => toggleDocumentType(context.db, input)),

	reorder: writeProcedure
		.route({
			method: "POST",
			path: "/document-types/reorder",
			tags: TAGS,
			summary: "Reorder the detection priority of the types",
		})
		.input(reorderDocumentTypesInput)
		.output(z.object({ reordered: z.int().min(0) }))
		.handler(({ input, context }) => reorderDocumentTypes(context.db, input)),

	setDocumentOverride: writeProcedure
		.route({
			method: "PUT",
			path: "/document-types/{documentTypeId}/documents/{documentId}",
			tags: TAGS,
			summary: "Manually force or exclude a document from the type",
		})
		.input(setDocumentTypeOverrideInput)
		.output(documentTypeDetailSchema)
		.handler(({ input, context }) => setDocumentOverride(context.db, input)),

	apply: writeProcedure
		.route({
			method: "POST",
			path: "/document-types/{documentTypeId}/apply",
			tags: TAGS,
			summary: "Apply a type to documents: category, parties, tags, extraction",
		})
		.input(applyDocumentTypeInput)
		.output(applyDocumentTypeResultSchema)
		.handler(({ input, context }) =>
			applyDocumentType(context.db, input, ingestionOptions(context)),
		),

	detect: protectedProcedure
		.route({
			method: "GET",
			path: "/documents/{documentId}/document-type-candidates",
			tags: TAGS,
			summary: "Types whose detection condition matches a document (dry run)",
		})
		.input(detectDocumentTypeInput)
		.output(detectDocumentTypeResultSchema)
		.handler(({ input, context }) =>
			detectDocumentType(context.db, input.documentId),
		),

	preview: protectedProcedure
		.route({
			method: "POST",
			path: "/document-types/preview",
			tags: TAGS,
			summary: "What applying a type (or a draft) would do, without writing",
		})
		.input(previewDocumentTypeInput)
		.output(previewDocumentTypeResultSchema)
		.handler(({ input, context }) => previewDocumentType(context.db, input)),

	previewTitles: protectedProcedure
		.route({
			method: "GET",
			path: "/document-types/{id}/title-preview",
			tags: TAGS,
			summary: "Titles the template of the type would give its documents",
		})
		.input(previewDocumentTypeTitlesInput)
		.output(z.array(documentTypeTitlePreviewSchema))
		.handler(({ input, context }) =>
			previewDocumentTypeTitles(context.db, input),
		),

	regenerateTitles: writeProcedure
		.route({
			method: "POST",
			path: "/document-types/{id}/regenerate-titles",
			tags: TAGS,
			summary:
				"Rewrite the titles of the documents of a type from its template",
		})
		.input(regenerateDocumentTypeTitlesInput)
		.output(regenerateTitlesResultSchema)
		.handler(({ input, context }) =>
			regenerateDocumentTypeTitles(context.db, input),
		),

	addLayout: writeProcedure
		.route({
			method: "POST",
			path: "/document-types/{documentTypeId}/layouts",
			tags: TAGS,
			summary: "Add a layout to a document type",
			successStatus: 201,
		})
		.input(addDocumentTypeLayoutInput)
		.output(savedDocumentTypeLayoutSchema)
		.handler(({ input, context }) => addLayout(context.db, input)),

	createLayoutFromDocument: writeProcedure
		.route({
			method: "POST",
			path: "/document-types/{documentTypeId}/layouts/from-document",
			tags: TAGS,
			summary: "Create a layout with a signature seeded from a document",
			successStatus: 201,
		})
		.input(createLayoutFromDocumentInput)
		.output(documentTypeLayoutSchema)
		.handler(({ input, context }) =>
			createLayoutFromDocument(context.db, input),
		),

	updateLayout: writeProcedure
		.route({
			method: "PATCH",
			path: "/document-types/layouts/{id}",
			tags: TAGS,
			summary: "Update a layout (name, date range, signature)",
		})
		.input(updateDocumentTypeLayoutInput)
		.output(savedDocumentTypeLayoutSchema)
		.handler(({ input, context }) => updateLayout(context.db, input)),

	removeLayout: writeProcedure
		.route({
			method: "DELETE",
			path: "/document-types/layouts/{id}",
			tags: TAGS,
			summary: "Delete a layout (its extraction rules become global)",
		})
		.input(removeDocumentTypeLayoutInput)
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) => removeLayout(context.db, input.id)),

	setDefaultLayout: writeProcedure
		.route({
			method: "POST",
			path: "/document-types/layouts/{id}/default",
			tags: TAGS,
			summary: "Make a layout the default (fallback) of its document type",
		})
		.input(setDefaultDocumentTypeLayoutInput)
		.output(z.array(documentTypeLayoutSchema))
		.handler(({ input, context }) => setDefaultLayout(context.db, input.id)),

	reorderLayouts: writeProcedure
		.route({
			method: "POST",
			path: "/document-types/{documentTypeId}/layouts/reorder",
			tags: TAGS,
			summary: "Reorder the layouts of a document type",
		})
		.input(reorderDocumentTypeLayoutsInput)
		.output(z.array(documentTypeLayoutSchema))
		.handler(({ input, context }) => reorderLayouts(context.db, input)),

	testLayout: protectedProcedure
		.route({
			method: "POST",
			path: "/document-types/layouts/{layoutId}/test",
			tags: TAGS,
			summary: "Run the extraction rules of a layout on a document (dry run)",
		})
		.input(testDocumentTypeLayoutInput)
		.output(testDocumentTypeLayoutResultSchema)
		.handler(({ input, context }) => testLayout(context.db, input)),
};
