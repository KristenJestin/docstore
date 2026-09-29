import { z } from "zod";
import { documentListFiltersSchema, noSyncCursorFields } from "./document";

/**
 * Saved searches (SPEC §2 "Dossier"): the alternative to creating a Dossier.
 * The `document.list` filters are persisted, without the current pagination —
 * the page is always recomputed when the search is opened.
 *
 * The sync cursor of `document.list` is not a filter (#14): it is refused on
 * the way in, and dropped on the way out from a search stored before that.
 */
export const savedSearchFiltersSchema = documentListFiltersSchema.omit({
	page: true,
});
export type SavedSearchFilters = z.infer<typeof savedSearchFiltersSchema>;

const savedSearchFiltersInput =
	savedSearchFiltersSchema.extend(noSyncCursorFields);

export const savedSearchSchema = z.object({
	id: z.string(),
	name: z.string(),
	filters: savedSearchFiltersSchema,
	sortOrder: z.int(),
	createdAt: z.date(),
});
export type SavedSearchDto = z.infer<typeof savedSearchSchema>;

export const createSavedSearchInput = z.object({
	name: z.string().trim().min(1).max(200),
	filters: savedSearchFiltersInput,
});
export type CreateSavedSearchInput = z.infer<typeof createSavedSearchInput>;

export const updateSavedSearchInput = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(200).optional(),
	filters: savedSearchFiltersInput.optional(),
});
export type UpdateSavedSearchInput = z.infer<typeof updateSavedSearchInput>;

export const reorderSavedSearchesInput = z.object({
	/** Ids in the wanted order; the missing ones stay at the end. */
	ids: z.array(z.string().min(1)).min(1).max(200),
});
export type ReorderSavedSearchesInput = z.infer<
	typeof reorderSavedSearchesInput
>;
