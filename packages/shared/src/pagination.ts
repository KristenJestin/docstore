import { z } from "zod";

export const paginationMetaSchema = z.object({
	page: z.int().min(1),
	pageSize: z.int().min(1),
	total: z.int().min(0),
	totalPages: z.int().min(0),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** Paginated list envelope: `paginatedSchema(partySchema)`. */
export function paginatedSchema<T extends z.ZodType>(item: T) {
	return z.object({
		items: z.array(item),
		page: z.int().min(1),
		pageSize: z.int().min(1),
		total: z.int().min(0),
		totalPages: z.int().min(0),
	});
}

export type Paginated<T> = PaginationMeta & { items: T[] };

export function paginationMeta(
	total: number,
	page: number,
	pageSize: number,
): PaginationMeta {
	return {
		page,
		pageSize,
		total,
		totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
	};
}
