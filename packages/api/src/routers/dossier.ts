import {
	addDossierDocumentsInput,
	createDossierInput,
	dossierSchema,
	dossierSummarySchema,
	dossierWithCountSchema,
	listDossiersForDocumentInput,
	listDossiersInput,
	removeDossierDocumentInput,
	updateDossierInput,
} from "@docstore/shared/dossier";
import { z } from "zod";
import { protectedProcedure, writeProcedure } from "../index";
import {
	addDossierDocuments,
	closeDossier,
	createDossier,
	deleteDossier,
	getDossier,
	listDossiers,
	listDossiersForDocument,
	removeDossierDocument,
	reopenDossier,
	updateDossier,
} from "../services/dossier.service";

const TAGS = ["Dossier"];

const idInput = z.object({ id: z.string().min(1) });

export const dossierRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/dossiers",
			tags: TAGS,
			summary: "List Dossiers with their document count",
		})
		.input(listDossiersInput)
		.output(z.array(dossierWithCountSchema))
		.handler(({ input, context }) => listDossiers(context.db, input)),

	get: protectedProcedure
		.route({
			method: "GET",
			path: "/dossiers/{id}",
			tags: TAGS,
			summary: "Dossier detail",
		})
		.input(idInput)
		.output(dossierWithCountSchema)
		.handler(({ input, context }) => getDossier(context.db, input.id)),

	listForDocument: protectedProcedure
		.route({
			method: "GET",
			path: "/documents/{documentId}/dossiers",
			tags: TAGS,
			summary: "Dossiers a document belongs to",
		})
		.input(listDossiersForDocumentInput)
		.output(z.array(dossierSummarySchema))
		.handler(({ input, context }) =>
			listDossiersForDocument(context.db, input.documentId),
		),

	create: writeProcedure
		.route({
			method: "POST",
			path: "/dossiers",
			tags: TAGS,
			summary: "Create a Dossier",
			successStatus: 201,
		})
		.input(createDossierInput)
		.output(dossierSchema)
		.handler(({ input, context }) => createDossier(context.db, input)),

	update: writeProcedure
		.route({
			method: "PATCH",
			path: "/dossiers/{id}",
			tags: TAGS,
			summary: "Rename a Dossier or change its description",
		})
		.input(updateDossierInput)
		.output(dossierSchema)
		.handler(({ input, context }) => updateDossier(context.db, input)),

	close: writeProcedure
		.route({
			method: "POST",
			path: "/dossiers/{id}/close",
			tags: TAGS,
			summary: "Close a Dossier",
		})
		.input(idInput)
		.output(dossierWithCountSchema)
		.handler(({ input, context }) => closeDossier(context.db, input.id)),

	reopen: writeProcedure
		.route({
			method: "POST",
			path: "/dossiers/{id}/reopen",
			tags: TAGS,
			summary: "Reopen a closed Dossier",
		})
		.input(idInput)
		.output(dossierWithCountSchema)
		.handler(({ input, context }) => reopenDossier(context.db, input.id)),

	delete: writeProcedure
		.route({
			method: "DELETE",
			path: "/dossiers/{id}",
			tags: TAGS,
			summary: "Delete a Dossier (documents are left untouched)",
		})
		.input(idInput)
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) => deleteDossier(context.db, input.id)),

	addDocuments: writeProcedure
		.route({
			method: "POST",
			path: "/dossiers/{id}/documents",
			tags: TAGS,
			summary: "Add documents to the Dossier",
		})
		.input(addDossierDocumentsInput)
		.output(dossierWithCountSchema)
		.handler(({ input, context }) => addDossierDocuments(context.db, input)),

	removeDocument: writeProcedure
		.route({
			method: "DELETE",
			path: "/dossiers/{id}/documents/{documentId}",
			tags: TAGS,
			summary: "Remove a document from the Dossier",
		})
		.input(removeDossierDocumentInput)
		.output(dossierWithCountSchema)
		.handler(({ input, context }) => removeDossierDocument(context.db, input)),
};
