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

async function seedDocument(title: string): Promise<string> {
	const rows = await db
		.insert(document)
		.values({ title, status: "active", createdById: owner.id })
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

describe("dossier — lifecycle", () => {
	test("creation, renaming, closing, reopening, deletion", async () => {
		const created = await client.dossier.create({
			name: "House purchase",
			description: "Sale agreement, loan, notary",
		});
		expect(created.id).toStartWith("dos_");
		expect(created.status).toBe("open");
		expect(created.closedAt).toBeNull();

		const renamed = await client.dossier.update({
			id: created.id,
			name: "House purchase 2026",
		});
		expect(renamed.name).toBe("House purchase 2026");

		const closed = await client.dossier.close({ id: created.id });
		expect(closed.status).toBe("closed");
		expect(closed.closedAt).not.toBeNull();

		// A closed Dossier drops out of the default listings.
		expect(await client.dossier.list({})).toHaveLength(0);
		expect(await client.dossier.list({ includeClosed: true })).toHaveLength(1);

		const reopened = await client.dossier.reopen({ id: created.id });
		expect(reopened.status).toBe("open");
		expect(reopened.closedAt).toBeNull();

		await client.dossier.delete({ id: created.id });
		await expectOrpcError(client.dossier.get({ id: created.id }), "NOT_FOUND");
	});
});

describe("dossier — documents", () => {
	test("adds, counts and removes documents", async () => {
		const first = await seedDocument("Sale agreement");
		const second = await seedDocument("Loan offer");
		const third = await seedDocument("Notarial deed");
		const dossier = await client.dossier.create({ name: "House purchase" });

		const filled = await client.dossier.addDocuments({
			id: dossier.id,
			documentIds: [first, second, third],
		});
		expect(filled.documentCount).toBe(3);

		// Idempotent: re-adding the same documents does not double the counter.
		const again = await client.dossier.addDocuments({
			id: dossier.id,
			documentIds: [first, second],
		});
		expect(again.documentCount).toBe(3);

		const listed = await client.dossier.list({});
		expect(listed[0]?.documentCount).toBe(3);

		const page = await client.document.list({ dossierId: dossier.id });
		expect(page.total).toBe(3);

		const reduced = await client.dossier.removeDocument({
			id: dossier.id,
			documentId: second,
		});
		expect(reduced.documentCount).toBe(2);

		await expectOrpcError(
			client.dossier.removeDocument({
				id: dossier.id,
				documentId: second,
			}),
			"NOT_FOUND",
		);
	});

	test("the counter ignores trashed documents", async () => {
		const first = await seedDocument("Kept");
		const second = await seedDocument("Discarded");
		const dossier = await client.dossier.create({ name: "Misc" });
		await client.dossier.addDocuments({
			id: dossier.id,
			documentIds: [first, second],
		});

		await client.document.trash({ id: second });
		expect((await client.dossier.get({ id: dossier.id })).documentCount).toBe(
			1,
		);
		expect((await client.dossier.list({}))[0]?.documentCount).toBe(1);
	});

	test("404 on an unknown document", async () => {
		const dossier = await client.dossier.create({ name: "Empty" });
		await expectOrpcError(
			client.dossier.addDocuments({
				id: dossier.id,
				documentIds: ["doc_absent"],
			}),
			"NOT_FOUND",
		);
	});
});
