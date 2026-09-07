import { z } from "zod";

/**
 * Relations between documents (SPEC §2 "DocumentRelation").
 *
 * This module does not depend on any other schema: `document.ts` imports it to
 * describe the relations returned by `document.get`.
 */

export const DOCUMENT_RELATION_KINDS = [
	"version_of",
	"page_of",
	"supersedes",
	"related_to",
	"fulfills",
] as const;

export const documentRelationKindSchema = z.enum(DOCUMENT_RELATION_KINDS);
export type DocumentRelationKind = z.infer<typeof documentRelationKindSchema>;

/** Display labels, for the UI and the MCP tools. */
export const DOCUMENT_RELATION_KIND_LABELS: Record<
	DocumentRelationKind,
	string
> = {
	version_of: "version of",
	page_of: "page of",
	supersedes: "supersedes",
	related_to: "related to",
	fulfills: "fulfills",
};

/** Direction of the relation as seen from the document being viewed. */
export const RELATION_DIRECTIONS = ["outgoing", "incoming"] as const;
export const relationDirectionSchema = z.enum(RELATION_DIRECTIONS);
export type RelationDirection = z.infer<typeof relationDirectionSchema>;

export const addRelationInput = z.object({
	fromDocumentId: z.string().min(1),
	toDocumentId: z.string().min(1),
	kind: documentRelationKindSchema,
});
export type AddRelationInput = z.infer<typeof addRelationInput>;

export const removeRelationInput = z.object({ id: z.string().min(1) });
export type RemoveRelationInput = z.infer<typeof removeRelationInput>;

/**
 * Duplicate resolution: `documentId` is absorbed by `intoDocumentId`
 * (files moved as attachments, `version_of` relation, trash).
 */
export const mergeAsVersionInput = z.object({
	documentId: z.string().min(1),
	intoDocumentId: z.string().min(1),
});
export type MergeAsVersionInput = z.infer<typeof mergeAsVersionInput>;

export const documentRelationSchema = z.object({
	id: z.string(),
	fromDocumentId: z.string(),
	toDocumentId: z.string(),
	kind: documentRelationKindSchema,
	createdAt: z.date(),
});
export type DocumentRelationDto = z.infer<typeof documentRelationSchema>;
