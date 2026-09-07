import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

let db: TestDb;
let owner: TestUser;
let client: ReturnType<typeof createTestClient>;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
	client = createTestClient(db, owner);
});

const filters = {
	query: "invoice",
	deleted: "exclude" as const,
	pageSize: 25,
	sort: "documentDate:desc" as const,
};

describe("savedSearch", () => {
	test("stores the filters and reads them back unchanged", async () => {
		const created = await client.savedSearch.create({
			name: "Invoices 2026",
			filters: { ...filters, year: 2026 },
		});
		expect(created.id).toStartWith("sav_");
		expect(created.sortOrder).toBe(0);

		const listed = await client.savedSearch.list({});
		expect(listed).toHaveLength(1);
		expect(listed[0]?.filters).toEqual({ ...filters, year: 2026 });

		// The persisted filters replay directly in `document.list`.
		const page = await client.document.list({ ...listed[0]?.filters, page: 1 });
		expect(page.total).toBe(0);
	});

	test("rejects an unknown filter", async () => {
		await expectOrpcError(
			client.savedSearch.create({
				name: "Invalid",
				// @ts-expect-error: the Zod schema rejects values outside the enum.
				filters: { ...filters, sort: "nonexistent" },
			}),
			"BAD_REQUEST",
		);
	});

	test("renames, replaces the filters then deletes", async () => {
		const created = await client.savedSearch.create({
			name: "Draft",
			filters,
		});

		const updated = await client.savedSearch.update({
			id: created.id,
			name: "To review",
			filters: { ...filters, query: undefined, status: "review" },
		});
		expect(updated.name).toBe("To review");
		expect(updated.filters.status).toBe("review");

		await client.savedSearch.delete({ id: created.id });
		expect(await client.savedSearch.list({})).toHaveLength(0);
		await expectOrpcError(
			client.savedSearch.delete({ id: created.id }),
			"NOT_FOUND",
		);
	});

	test("reorder moves the provided ids to the front", async () => {
		const first = await client.savedSearch.create({ name: "A", filters });
		const second = await client.savedSearch.create({ name: "B", filters });
		const third = await client.savedSearch.create({ name: "C", filters });

		const reordered = await client.savedSearch.reorder({
			ids: [third.id, first.id],
		});
		expect(reordered.map((row) => row.name)).toEqual(["C", "A", "B"]);
		expect(reordered.map((row) => row.sortOrder)).toEqual([0, 1, 2]);

		// The order is persistent.
		expect((await client.savedSearch.list({})).map((row) => row.id)).toEqual([
			third.id,
			first.id,
			second.id,
		]);

		await expectOrpcError(
			client.savedSearch.reorder({ ids: ["sav_absent"] }),
			"NOT_FOUND",
		);
	});
});
