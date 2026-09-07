import { z } from "zod";
import { assignmentSourceSchema, hexColorSchema } from "./common";

export const tagSchema = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string().nullable(),
	createdAt: z.date(),
});
export type Tag = z.infer<typeof tagSchema>;

/**
 * Lightweight version embedded in documents.
 *
 * `source`/`confidence` describe the `document_tag` link (this tag on this
 * document), not a property of the tag itself.
 */
export const tagSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string().nullable(),
	source: assignmentSourceSchema,
	confidence: z.number().nullable(),
});
export type TagSummary = z.infer<typeof tagSummarySchema>;

export const tagWithCountSchema = tagSchema.extend({
	documentCount: z.int().min(0),
});
export type TagWithCount = z.infer<typeof tagWithCountSchema>;

export const listTagsInput = z.object({
	/** Case-insensitive search on the name. */
	query: z.string().trim().min(1).optional(),
});
export type ListTagsInput = z.infer<typeof listTagsInput>;

export const createTagInput = z.object({
	name: z.string().trim().min(1).max(60),
	color: hexColorSchema.nullish(),
});
export type CreateTagInput = z.infer<typeof createTagInput>;

export const updateTagInput = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(60).optional(),
	color: hexColorSchema.nullish(),
});
export type UpdateTagInput = z.infer<typeof updateTagInput>;

export const mergeTagsInput = z.object({
	/** Tag absorbed then deleted. */
	sourceId: z.string().min(1),
	/** Tag kept, which inherits the documents of the source tag. */
	targetId: z.string().min(1),
});
export type MergeTagsInput = z.infer<typeof mergeTagsInput>;
