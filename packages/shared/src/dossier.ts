import { z } from "zod";

/**
 * Dossiers (SPEC §2 "Dossier"): flat, cross-cutting collections with an
 * `open` / `closed` lifecycle. No hierarchy, no sub-dossiers.
 */

export const DOSSIER_STATUSES = ["open", "closed"] as const;
export const dossierStatusSchema = z.enum(DOSSIER_STATUSES);
export type DossierStatus = z.infer<typeof dossierStatusSchema>;

export const dossierSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	status: dossierStatusSchema,
	closedAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type DossierDto = z.infer<typeof dossierSchema>;

export const dossierWithCountSchema = dossierSchema.extend({
	documentCount: z.int().min(0),
});
export type DossierWithCount = z.infer<typeof dossierWithCountSchema>;

/** Minimal Dossier summary, embedded in `document.get` and returned by `dossier.listForDocument`. */
export const dossierSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	status: dossierStatusSchema,
});
export type DossierSummary = z.infer<typeof dossierSummarySchema>;

export const listDossiersForDocumentInput = z.object({
	documentId: z.string().min(1),
});
export type ListDossiersForDocumentInput = z.infer<
	typeof listDossiersForDocumentInput
>;

export const listDossiersInput = z.object({
	/** By default, only open dossiers are listed. */
	includeClosed: z.boolean().default(false),
	query: z.string().trim().min(1).optional(),
});
export type ListDossiersInput = z.infer<typeof listDossiersInput>;

export const createDossierInput = z.object({
	name: z.string().trim().min(1).max(200),
	description: z.string().trim().max(2000).nullish(),
});
export type CreateDossierInput = z.infer<typeof createDossierInput>;

export const updateDossierInput = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(200).optional(),
	description: z.string().trim().max(2000).nullish(),
});
export type UpdateDossierInput = z.infer<typeof updateDossierInput>;

export const addDossierDocumentsInput = z.object({
	id: z.string().min(1),
	documentIds: z.array(z.string().min(1)).min(1).max(500),
});
export type AddDossierDocumentsInput = z.infer<typeof addDossierDocumentsInput>;

export const removeDossierDocumentInput = z.object({
	id: z.string().min(1),
	documentId: z.string().min(1),
});
export type RemoveDossierDocumentInput = z.infer<
	typeof removeDossierDocumentInput
>;
