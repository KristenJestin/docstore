import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	deleteDocumentPermanently,
	mergeAsVersion,
	trashDocument,
} from "@docstore/api/services/document.service";
import { createId } from "@docstore/db/id";
import { document, documentFile } from "@docstore/db/schema/document";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import {
	createMcpTestClient,
	insertTestUser,
	type McpTestHarness,
} from "./test-utils";

/**
 * A document id always leads somewhere (issue #2), MCP side: `get_document`
 * and the `docstore://document/{id}` resource publish the stable URLs, follow
 * a merge to the kept document and say so in `redirectedFrom`.
 */

const PUBLIC_URL = "https://docstore.example.test";

let db: TestDb;
let userId: string;
let previousPublicUrl: string | undefined;
const harnesses: McpTestHarness[] = [];

beforeAll(async () => {
	db = await createTestDb();
	previousPublicUrl = process.env.PUBLIC_URL;
	process.env.PUBLIC_URL = PUBLIC_URL;
});

afterAll(async () => {
	while (harnesses.length > 0) {
		await harnesses.pop()?.close();
	}
	if (previousPublicUrl === undefined) delete process.env.PUBLIC_URL;
	else process.env.PUBLIC_URL = previousPublicUrl;
	await db.$client.end();
});

beforeEach(async () => {
	while (harnesses.length > 0) {
		await harnesses.pop()?.close();
	}
	await truncateAll(db);
	userId = await insertTestUser(db);
});

async function connect() {
	const harness = await createMcpTestClient({ db, userId, scopes: ["read"] });
	harnesses.push(harness);
	return harness.client;
}

async function seedDocument(title: string): Promise<string> {
	const id = createId("doc_");
	await db.insert(document).values({
		id,
		title,
		status: "active",
		createdById: userId,
	});
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

function structured<T>(result: unknown): T {
	return (result as { structuredContent?: unknown }).structuredContent as T;
}

function textOf(result: unknown): string {
	const blocks =
		(result as { content?: { type: string; text?: string }[] }).content ?? [];
	return blocks.map((block) => block.text ?? "").join("\n");
}

type StableFields = {
	id: string;
	webUrl: string;
	fileUrl: string;
	redirectedFrom: string | null;
	deletedAt: string | null;
};

describe("Docstore SHALL publish the stable URLs of a document in get_document", () => {
	test("WHEN an agent gets a document THEN webUrl and fileUrl are built from the public base URL", async () => {
		const id = await seedDocument("Lease");
		const client = await connect();

		const result = await client.callTool({
			name: "get_document",
			arguments: { id },
		});
		const output = structured<StableFields>(result);
		expect(output.id).toBe(id);
		expect(output.webUrl).toBe(`${PUBLIC_URL}/documents/${id}`);
		expect(output.fileUrl).toBe(`${PUBLIC_URL}/d/${id}`);
		expect(output.redirectedFrom).toBeNull();
		expect(textOf(result)).toContain(`${PUBLIC_URL}/d/${id}`);
	});
});

describe("Docstore SHALL lead get_document on a merged document to the kept document", () => {
	test("WHEN document B is merged into A THEN get_document on B returns A with redirectedFrom B", async () => {
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await mergeAsVersion(db, { documentId: duplicate, intoDocumentId: kept });
		const client = await connect();

		const result = await client.callTool({
			name: "get_document",
			arguments: { id: duplicate },
		});
		const output = structured<StableFields>(result);
		expect(output.id).toBe(kept);
		expect(output.redirectedFrom).toBe(duplicate);
		expect(output.fileUrl).toBe(`${PUBLIC_URL}/d/${kept}`);
		expect(textOf(result)).toContain(duplicate);
	});

	test("WHEN the docstore://document/{id} resource of B is read THEN it holds A with redirectedFrom B", async () => {
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await mergeAsVersion(db, { documentId: duplicate, intoDocumentId: kept });
		const client = await connect();

		const read = await client.readResource({
			uri: `docstore://document/${duplicate}`,
		});
		const contents = (read as { contents: { text?: string }[] }).contents;
		const payload = JSON.parse(contents[0]?.text ?? "{}") as StableFields;
		expect(payload.id).toBe(kept);
		expect(payload.redirectedFrom).toBe(duplicate);
		expect(payload.webUrl).toBe(`${PUBLIC_URL}/documents/${kept}`);
	});
});

describe("Docstore SHALL keep resolving a trashed document in get_document and refuse a deleted one", () => {
	test("WHEN the document is in the trash without a merge THEN get_document returns it with deletedAt visible", async () => {
		const id = await seedDocument("Old lease");
		await trashDocument(db, id);
		const client = await connect();

		const result = await client.callTool({
			name: "get_document",
			arguments: { id },
		});
		const output = structured<StableFields>(result);
		expect(output.id).toBe(id);
		expect(output.deletedAt).not.toBeNull();
		expect(output.redirectedFrom).toBeNull();
	});

	test("WHEN the document was permanently deleted THEN get_document is a tool error saying so", async () => {
		const id = await seedDocument("Old lease");
		await deleteDocumentPermanently(db, id);
		const client = await connect();

		const result = await client.callTool({
			name: "get_document",
			arguments: { id },
		});
		expect((result as { isError?: boolean }).isError).toBe(true);
		expect(textOf(result)).toContain("permanently deleted");
	});
});
