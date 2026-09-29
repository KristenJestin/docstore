import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createId } from "@docstore/db/id";
import { document } from "@docstore/db/schema/document";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { ApiKeyScope } from "@docstore/shared/api-key";
import {
	createMcpTestClient,
	insertTestUser,
	type McpTestHarness,
} from "./test-utils";

/**
 * Issue #4, "How we will know it is done", MCP side: an agent adds a wiki
 * reference through `set_external_refs`; `get_document` shows it and
 * `search_documents` with `notReferencedBy: "wiki"` no longer lists the
 * document.
 */

type ExternalRef = {
	system: string;
	ref: string;
	url: string | null;
	label: string | null;
};
type Detail = { id: string; externalRefs: ExternalRef[] };
type SearchPage = { items: { id: string }[]; total: number };

const EDF = "10-admin/12-logement/contrat-edf.md";

let db: TestDb;
let userId: string;
const harnesses: McpTestHarness[] = [];

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	while (harnesses.length > 0) await harnesses.pop()?.close();
	await db.$client.end();
});

beforeEach(async () => {
	while (harnesses.length > 0) await harnesses.pop()?.close();
	await truncateAll(db);
	userId = await insertTestUser(db);
});

async function connect(scopes: ApiKeyScope[]) {
	const harness = await createMcpTestClient({ db, userId, scopes });
	harnesses.push(harness);
	return harness.client;
}

async function seedDocument(title: string): Promise<string> {
	const id = createId("doc_");
	await db
		.insert(document)
		.values({ id, title, status: "active", createdById: userId });
	return id;
}

function structured<T>(result: unknown): T {
	return (result as { structuredContent?: unknown }).structuredContent as T;
}

describe("scenario: an agent declares the wiki page citing a document", () => {
	test("WHEN an agent adds a wiki reference through MCP THEN get_document shows it and notReferencedBy wiki no longer lists the document", async () => {
		const client = await connect(["read", "write"]);
		const contract = await seedDocument("EDF contract");
		const passport = await seedDocument("Passport");

		const before = structured<SearchPage>(
			await client.callTool({
				name: "search_documents",
				arguments: { notReferencedBy: "wiki" },
			}),
		);
		expect(before.items.map((item) => item.id).sort()).toEqual(
			[contract, passport].sort(),
		);

		const set = await client.callTool({
			name: "set_external_refs",
			arguments: {
				documentId: contract,
				system: "wiki",
				refs: [{ ref: EDF, label: "Contrat EDF" }],
			},
		});
		expect(set.isError).toBeFalsy();

		const got = await client.callTool({
			name: "get_document",
			arguments: { id: contract },
		});
		expect(structured<Detail>(got).externalRefs).toEqual([
			{ system: "wiki", ref: EDF, url: null, label: "Contrat EDF" },
		]);
		const text = (got.content as { type: string; text: string }[])[0]?.text;
		expect(text).toContain(`referenced by wiki: ${EDF} (Contrat EDF)`);

		const after = structured<SearchPage>(
			await client.callTool({
				name: "search_documents",
				arguments: { notReferencedBy: "wiki" },
			}),
		);
		expect(after.items.map((item) => item.id)).toEqual([passport]);

		const cited = structured<SearchPage>(
			await client.callTool({
				name: "search_documents",
				arguments: { referencedBy: "wiki" },
			}),
		);
		expect(cited.items.map((item) => item.id)).toEqual([contract]);
	});

	test("WHEN a read-only key calls set_external_refs THEN the tool refuses", async () => {
		const client = await connect(["read"]);
		const contract = await seedDocument("EDF contract");

		const result = await client.callTool({
			name: "set_external_refs",
			arguments: { documentId: contract, system: "wiki", refs: [{ ref: EDF }] },
		});

		expect(result.isError).toBe(true);
		const detail = await db.query.documentExternalRef.findMany();
		expect(detail).toEqual([]);
	});
});
