import type { ListDocumentsInput } from "@docstore/shared/document";
import {
	documentSortSchema,
	documentStatusSchema,
} from "@docstore/shared/document";
import type { ExportFilters } from "@docstore/shared/export";
import type { SavedSearchFilters } from "@docstore/shared/saved-search";
import { z } from "zod";

/** Page size of the document list. */
export const DOCUMENT_PAGE_SIZE = 25;

/**
 * `/documents` filters carried by the URL. Every field falls back to
 * `undefined` when invalid: a roughly copy-pasted link must not break the
 * screen.
 */
export const documentSearchSchema = z.object({
	/** Full-text search. */
	q: z.string().trim().min(1).optional().catch(undefined),
	categoryId: z.string().min(1).optional().catch(undefined),
	partyId: z.string().min(1).optional().catch(undefined),
	/** Documents carrying this document type. */
	documentTypeId: z.string().min(1).optional().catch(undefined),
	year: z.coerce.number().int().min(1000).max(9999).optional().catch(undefined),
	/** Document date range, `YYYY-MM-DD` bounds, both inclusive. */
	dateFrom: z.iso.date().optional().catch(undefined),
	dateTo: z.iso.date().optional().catch(undefined),
	/** Expiry range, `YYYY-MM-DD` bounds on `validUntil`, both inclusive. */
	validUntilFrom: z.iso.date().optional().catch(undefined),
	validUntilTo: z.iso.date().optional().catch(undefined),
	/** Physical filing place, case-insensitive "contains". */
	physicalLocation: z.string().trim().min(1).optional().catch(undefined),
	tags: z.array(z.string().min(1)).optional().catch(undefined),
	status: documentStatusSchema.optional().catch(undefined),
	sensitive: z.boolean().optional().catch(undefined),
	/** Trash view (`deleted: "only"`). */
	trash: z.boolean().optional().catch(undefined),
	/** `true`: only documents carrying an ASN; `false`: only those without. */
	hasAsn: z.boolean().optional().catch(undefined),
	sort: documentSortSchema.optional().catch(undefined),
	page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export type DocumentSearch = z.infer<typeof documentSearchSchema>;

/** Active filters excluding sort and paging — drives the "Reset" button. */
export function hasActiveFilters(search: DocumentSearch): boolean {
	return Boolean(
		search.q ||
			search.categoryId ||
			search.partyId ||
			search.documentTypeId ||
			search.year ||
			search.dateFrom ||
			search.dateTo ||
			search.validUntilFrom ||
			search.validUntilTo ||
			search.physicalLocation ||
			(search.tags && search.tags.length > 0) ||
			search.status ||
			search.sensitive !== undefined ||
			search.trash ||
			search.hasAsn !== undefined,
	);
}

/** Maps the URL filters to a `document.list` input. */
export function toListDocumentsInput(
	search: DocumentSearch,
	overrides?: Partial<ListDocumentsInput>,
): ListDocumentsInput {
	return {
		query: search.q,
		categoryId: search.categoryId,
		partyId: search.partyId,
		documentTypeId: search.documentTypeId,
		year: search.year,
		dateFrom: search.dateFrom,
		dateTo: search.dateTo,
		validUntilFrom: search.validUntilFrom,
		validUntilTo: search.validUntilTo,
		physicalLocation: search.physicalLocation,
		tagIds: search.tags && search.tags.length > 0 ? search.tags : undefined,
		status: search.status,
		sensitive: search.sensitive,
		hasAsn: search.hasAsn,
		deleted: search.trash ? "only" : "exclude",
		sort: search.sort ?? "documentDate:desc",
		page: search.page ?? 1,
		pageSize: DOCUMENT_PAGE_SIZE,
		...overrides,
	};
}

/**
 * Current filters in the shape `savedSearch.create` and `export.preview`
 * expect: the same `document.list` input without the pagination, which is
 * always recomputed when the search is reopened.
 */
export function toSavedSearchFilters(
	search: DocumentSearch,
): SavedSearchFilters {
	const { page: _page, ...filters } = toListDocumentsInput(search);
	return filters;
}

/** Same thing for `POST /api/export`, which also drops `pageSize`. */
export function toExportFilters(search: DocumentSearch): ExportFilters {
	const { pageSize: _pageSize, ...filters } = toSavedSearchFilters(search);
	return filters;
}

/**
 * Reverse mapping, applied when a saved search is opened from the sidebar.
 * Filters the URL cannot express (`fieldFilters`, `dossierId`, `hasRelation`…)
 * are dropped: the screen only offers the controls it knows how to render.
 */
export function fromSavedSearchFilters(
	filters: SavedSearchFilters,
): DocumentSearch {
	return {
		q: filters.query,
		categoryId: filters.categoryId,
		partyId: filters.partyId,
		documentTypeId: filters.documentTypeId,
		year: filters.year,
		dateFrom: filters.dateFrom,
		dateTo: filters.dateTo,
		validUntilFrom: filters.validUntilFrom,
		validUntilTo: filters.validUntilTo,
		physicalLocation: filters.physicalLocation,
		tags:
			filters.tagIds && filters.tagIds.length > 0 ? filters.tagIds : undefined,
		status: filters.status,
		sensitive: filters.sensitive,
		hasAsn: filters.hasAsn,
		trash: filters.deleted === "only" ? true : undefined,
		sort: filters.sort,
		page: undefined,
	};
}
