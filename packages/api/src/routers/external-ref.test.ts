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

/** Issue #4 through oRPC: `document.setExternalRefs`, `get`, `list`. */

let db: TestDb;
let owner: TestUser;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
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

const EDF = "10-admin/12-logement/contrat-edf.md";

describe("document.setExternalRefs", () => {
	test("WHEN an API client declares a wiki reference THEN document.get returns it and document.list filters on it", async () => {
		const client = createTestClient(db, owner);
		const cited = await seedDocument("EDF contract");
		await seedDocument("Passport");

		const updated = await client.document.setExternalRefs({
			id: cited,
			system: "wiki",
			refs: [{ ref: EDF, label: "Contrat EDF" }],
		});
		expect(updated.externalRefs.map((item) => item.ref)).toEqual([EDF]);

		const detail = await client.document.get({ id: cited });
		expect(detail.externalRefs).toMatchObject([
			{ system: "wiki", ref: EDF, label: "Contrat EDF", url: null },
		]);

		const referenced = await client.document.list({ referencedBy: "wiki" });
		expect(referenced.items.map((item) => item.title)).toEqual([
			"EDF contract",
		]);
		const notReferenced = await client.document.list({
			notReferencedBy: "wiki",
		});
		expect(notReferenced.items.map((item) => item.title)).toEqual(["Passport"]);
	});

	test("WHEN an API key without the write scope sets references THEN it is refused", async () => {
		const id = await seedDocument("EDF contract");
		const reader = createTestClient(db, owner, {
			id: "key_read",
			scopes: ["read"],
		});
		await expectOrpcError(
			reader.document.setExternalRefs({
				id,
				system: "wiki",
				refs: [{ ref: EDF }],
			}),
			"FORBIDDEN",
		);
	});

	test("WHEN the document does not exist THEN it answers NOT_FOUND", async () => {
		const client = createTestClient(db, owner);
		await expectOrpcError(
			client.document.setExternalRefs({
				id: "doc_missing",
				system: "wiki",
				refs: [],
			}),
			"NOT_FOUND",
		);
	});
});
