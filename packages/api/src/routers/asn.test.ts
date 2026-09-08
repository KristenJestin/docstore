import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { document } from "@docstore/db/schema/document";
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

/**
 * Physical archiving (SPEC §2 "Document"): archive serial number and filing
 * place.
 */

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

async function seedDocument(
	title: string,
	overrides: { physicalLocation?: string; asn?: number } = {},
): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title,
			status: "active",
			createdById: owner.id,
			physicalLocation: overrides.physicalLocation ?? null,
			asn: overrides.asn ?? null,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

describe("document.nextAsn / assignAsn / byAsn", () => {
	test("hands out consecutive numbers and finds them back", async () => {
		expect(await client.document.nextAsn({})).toEqual({ next: 1 });

		const first = await seedDocument("Deed");
		const second = await seedDocument("Insurance");

		const assignedFirst = await client.document.assignAsn({ id: first });
		expect(assignedFirst.asn).toBe(1);
		// "Assign next" is a human asking: the badge must not read "auto".
		expect(assignedFirst.asnSource).toBe("manual");
		expect(await client.document.nextAsn({})).toEqual({ next: 2 });

		const assignedSecond = await client.document.assignAsn({ id: second });
		expect(assignedSecond.asn).toBe(2);

		const found = await client.document.byAsn({ asn: 2 });
		expect(found.id).toBe(second);
	});

	test("a document that already has an ASN keeps it", async () => {
		const id = await seedDocument("Passport", { asn: 42 });
		expect((await client.document.assignAsn({ id })).asn).toBe(42);
		// The counter starts again from the maximum, not from the count.
		expect(await client.document.nextAsn({})).toEqual({ next: 43 });
	});

	test("a trashed document keeps its number, which stays taken", async () => {
		const id = await seedDocument("Deed");
		expect((await client.document.assignAsn({ id })).asn).toBe(1);

		await client.document.trash({ id });
		expect((await client.document.get({ id })).asn).toBe(1);
		// The sheet is still in the binder under 1: the next document gets 2.
		expect(await client.document.nextAsn({})).toEqual({ next: 2 });

		const next = await seedDocument("Insurance");
		expect((await client.document.assignAsn({ id: next })).asn).toBe(2);

		// Restoring puts it back under the number written on the sheet.
		await client.document.restore({ id });
		expect((await client.document.get({ id })).asn).toBe(1);
	});

	test("deleting for good frees the number", async () => {
		const first = await seedDocument("Deed");
		const second = await seedDocument("Insurance");
		await client.document.assignAsn({ id: first });
		await client.document.assignAsn({ id: second });
		expect(await client.document.nextAsn({})).toEqual({ next: 3 });

		await client.document.trash({ id: second });
		await client.document.deletePermanently({ id: second });

		// The row is gone, so 2 is free again and handed out to the next one.
		expect(await client.document.nextAsn({})).toEqual({ next: 2 });
		const third = await seedDocument("Warranty");
		expect((await client.document.assignAsn({ id: third })).asn).toBe(2);
	});

	test("an unknown ASN is a NOT_FOUND", async () => {
		await expectOrpcError(client.document.byAsn({ asn: 99 }), "NOT_FOUND");
	});

	test("assigning an ASN twice by hand is a CONFLICT", async () => {
		const first = await seedDocument("A");
		const second = await seedDocument("B");
		await client.document.update({ id: first, asn: 7 });
		await expectOrpcError(
			client.document.update({ id: second, asn: 7 }),
			"CONFLICT",
		);
	});
});

describe("document.list — physicalLocation and hasAsn", () => {
	test("filters on the filing place and on the presence of an ASN", async () => {
		await seedDocument("Deed", {
			physicalLocation: "Binder A - shelf 2",
			asn: 1,
		});
		await seedDocument("Warranty", { physicalLocation: "Binder B" });
		await seedDocument("Note");

		const inBinderA = await client.document.list({
			physicalLocation: "binder a",
		});
		expect(inBinderA.items.map((item) => item.title)).toEqual(["Deed"]);

		const anyBinder = await client.document.list({
			physicalLocation: "binder",
		});
		expect(anyBinder.total).toBe(2);

		const numbered = await client.document.list({ hasAsn: true });
		expect(numbered.items.map((item) => item.title)).toEqual(["Deed"]);

		const unnumbered = await client.document.list({ hasAsn: false });
		expect(unnumbered.total).toBe(2);
	});
});
