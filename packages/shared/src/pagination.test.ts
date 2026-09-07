import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { paginatedSchema, paginationMeta } from "./pagination";

const itemSchema = z.object({ id: z.string(), name: z.string() });

describe("paginatedSchema", () => {
	test("validates a page of results", () => {
		const schema = paginatedSchema(itemSchema);
		const parsed = schema.parse({
			items: [{ id: "prt_1", name: "EDF" }],
			page: 1,
			pageSize: 25,
			total: 1,
			totalPages: 1,
		});
		expect(parsed.items).toHaveLength(1);
	});

	test("rejects invalid items", () => {
		const schema = paginatedSchema(itemSchema);
		expect(
			schema.safeParse({
				items: [{ id: "prt_1" }],
				page: 1,
				pageSize: 25,
				total: 1,
				totalPages: 1,
			}).success,
		).toBe(false);
	});
});

describe("paginationMeta", () => {
	test("computes the page count", () => {
		expect(paginationMeta(0, 1, 25).totalPages).toBe(0);
		expect(paginationMeta(25, 1, 25).totalPages).toBe(1);
		expect(paginationMeta(26, 2, 25).totalPages).toBe(2);
	});
});
