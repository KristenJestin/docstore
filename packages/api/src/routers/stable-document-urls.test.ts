import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createId } from "@docstore/db/id";
import { document, documentFile } from "@docstore/db/schema/document";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import {
	type ApiKeyScope,
	SENSITIVE_PLACEHOLDER,
} from "@docstore/shared/api-key";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

/**
 * A document id always leads somewhere (issue #2): `document.get` publishes the
 * stable URLs of a document, follows a merge to the kept document, still shows
 * a trashed one, and answers `410 GONE` once it is permanently deleted.
 */

const PUBLIC_URL = "https://docstore.example.test";

let db: TestDb;
let owner: TestUser;
let client: ReturnType<typeof createTestClient>;
let previousPublicUrl: string | undefined;

beforeAll(async () => {
	db = await createTestDb();
	previousPublicUrl = process.env.PUBLIC_URL;
	process.env.PUBLIC_URL = `${PUBLIC_URL}/`;
});

afterAll(async () => {
	if (previousPublicUrl === undefined) delete process.env.PUBLIC_URL;
	else process.env.PUBLIC_URL = previousPublicUrl;
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
	client = createTestClient(db, owner);
});

function keyClient(scopes: ApiKeyScope[]) {
	return createTestClient(db, owner, { id: "key_test", scopes });
}

async function seedDocument(
	title: string,
	overrides: Partial<typeof document.$inferInsert> = {},
): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title,
			status: "active",
			createdById: owner.id,
			content: `OCR text of ${title}`,
			...overrides,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	const sha = createId("sha");
	await db.insert(documentFile).values({
		documentId: id,
		kind: "original",
		filename: `${title}.pdf`,
		mime: "application/pdf",
		size: 1024,
		sha256: sha,
		storageKey: `documents/${sha}.pdf`,
	});
	return id;
}

describe("Docstore SHALL publish the stable URLs of a document in document.get", () => {
	test("WHEN a document is read THEN webUrl and fileUrl are built from the public base URL", async () => {
		const id = await seedDocument("Lease");
		const detail = await client.document.get({ id });
		expect(detail.id).toBe(id);
		expect(detail.webUrl).toBe(`${PUBLIC_URL}/documents/${id}`);
		expect(detail.fileUrl).toBe(`${PUBLIC_URL}/d/${id}`);
		expect(detail.redirectedFrom).toBeNull();
	});
});

describe("Docstore SHALL lead every reference to a merged document to the kept document", () => {
	test("WHEN document B is merged into A THEN document.get on B returns A with redirectedFrom B", async () => {
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await client.document.mergeAsVersion({
			documentId: duplicate,
			intoDocumentId: kept,
		});

		const detail = await client.document.get({ id: duplicate });
		expect(detail.id).toBe(kept);
		expect(detail.title).toBe("Invoice");
		expect(detail.redirectedFrom).toBe(duplicate);
		expect(detail.webUrl).toBe(`${PUBLIC_URL}/documents/${kept}`);
		expect(detail.fileUrl).toBe(`${PUBLIC_URL}/d/${kept}`);
		// The kept document carries both files: its own and the absorbed one.
		expect(detail.files).toHaveLength(2);
	});

	test("WHEN the merged document is then permanently deleted from the trash THEN its id still leads to the kept document", async () => {
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await client.document.mergeAsVersion({
			documentId: duplicate,
			intoDocumentId: kept,
		});
		await client.document.deletePermanently({ id: duplicate });

		const detail = await client.document.get({ id: duplicate });
		expect(detail.id).toBe(kept);
		expect(detail.redirectedFrom).toBe(duplicate);
	});

	test("WHEN B is merged into A and A later into C THEN B leads to C", async () => {
		const first = await seedDocument("Invoice v1");
		const second = await seedDocument("Invoice v2");
		const third = await seedDocument("Invoice v3");
		await client.document.mergeAsVersion({
			documentId: first,
			intoDocumentId: second,
		});
		await client.document.mergeAsVersion({
			documentId: second,
			intoDocumentId: third,
		});

		const detail = await client.document.get({ id: first });
		expect(detail.id).toBe(third);
		expect(detail.redirectedFrom).toBe(first);
	});

	test("WHEN the merged document is restored from the trash THEN it answers for itself again", async () => {
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await client.document.mergeAsVersion({
			documentId: duplicate,
			intoDocumentId: kept,
		});
		await client.document.restore({ id: duplicate });

		const detail = await client.document.get({ id: duplicate });
		expect(detail.id).toBe(duplicate);
		expect(detail.redirectedFrom).toBeNull();
		expect(detail.deletedAt).toBeNull();
	});

	test("WHEN the kept document is then permanently deleted THEN the merged id answers 410 GONE", async () => {
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await client.document.mergeAsVersion({
			documentId: duplicate,
			intoDocumentId: kept,
		});
		await client.document.deletePermanently({ id: kept });

		const error = await expectOrpcError(
			client.document.get({ id: duplicate }),
			"GONE",
		);
		expect(error.status).toBe(410);
	});

	test("WHEN a key with read only follows a merge onto a sensitive document THEN the content stays masked", async () => {
		const kept = await seedDocument("Payslip", { sensitive: true });
		const duplicate = await seedDocument("Payslip (copy)");
		await client.document.mergeAsVersion({
			documentId: duplicate,
			intoDocumentId: kept,
		});

		const detail = await keyClient(["read"]).document.get({ id: duplicate });
		expect(detail.id).toBe(kept);
		expect(detail.content).toBe(SENSITIVE_PLACEHOLDER);
		expect(detail.masked).toBe(true);
	});
});

describe("Docstore SHALL keep resolving a trashed document and answer 410 once it is gone", () => {
	test("WHEN a document is in the trash without having been merged THEN document.get returns it with status and deletedAt visible", async () => {
		const id = await seedDocument("Old lease");
		await client.document.trash({ id });

		const detail = await client.document.get({ id });
		expect(detail.id).toBe(id);
		expect(detail.redirectedFrom).toBeNull();
		expect(detail.status).toBe("active");
		expect(detail.deletedAt).not.toBeNull();
	});

	test("WHEN a document was permanently deleted THEN document.get answers 410 GONE", async () => {
		const id = await seedDocument("Old lease");
		await client.document.deletePermanently({ id });

		const error = await expectOrpcError(client.document.get({ id }), "GONE");
		expect(error.status).toBe(410);
	});

	test("WHEN an id never existed THEN document.get still answers 404 NOT_FOUND", async () => {
		await expectOrpcError(
			client.document.get({ id: "doc_neverexisted" }),
			"NOT_FOUND",
		);
	});
});
