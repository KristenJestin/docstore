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
import { documentExternalRef } from "@docstore/db/schema/external-ref";
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

async function seedDocument(
	title: string,
	options: { sensitive?: boolean } = {},
): Promise<string> {
	const id = createId("doc_");
	await db.insert(document).values({
		id,
		title,
		status: "active",
		createdById: userId,
		sensitive: options.sensitive ?? false,
	});
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

/**
 * Issue #34, MCP side: a `read` key reads a sensitive document with wiki refs
 * and gets none; `referencedBy: "wiki"` does not return it; a key with
 * `sensitive` sees the refs.
 */
describe("Docstore SHALL mask the external references of a sensitive document for an API key without sensitive (MCP)", () => {
	const HEALTH = "10-admin/17-sante/diagnostic.md";

	async function seedCitedDiagnosis(): Promise<string> {
		const id = await seedDocument("Diagnosis", { sensitive: true });
		await db.insert(documentExternalRef).values({
			documentId: id,
			system: "wiki",
			ref: HEALTH,
			label: "Diagnostic",
		});
		return id;
	}

	function textOf(result: unknown): string {
		const blocks =
			(result as { content?: { type: string; text?: string }[] }).content ?? [];
		return blocks.map((block) => block.text ?? "").join("\n");
	}

	test("WHEN a read key calls get_document on a sensitive document with wiki refs THEN it gets none and masked is true", async () => {
		const id = await seedCitedDiagnosis();
		const client = await connect(["read"]);
		const got = await client.callTool({
			name: "get_document",
			arguments: { id },
		});
		const detail = structured<Detail & { masked: boolean }>(got);
		expect(detail.externalRefs).toEqual([]);
		expect(detail.masked).toBe(true);
		expect(textOf(got)).not.toContain("17-sante");
		expect(textOf(got)).toContain("external references");
	});

	test("WHEN a read key reads the docstore://document resource of that document THEN it has no refs", async () => {
		const id = await seedCitedDiagnosis();
		const client = await connect(["read"]);
		const read = await client.readResource({
			uri: `docstore://document/${id}`,
		});
		const text =
			(read.contents[0] as { text?: string } | undefined)?.text ?? "";
		const payload = JSON.parse(text) as Detail & { masked: boolean };
		expect(payload.externalRefs).toEqual([]);
		expect(payload.masked).toBe(true);
		expect(text).not.toContain("17-sante");
	});

	test("WHEN a write key calls set_external_refs on a sensitive document THEN the document it gets back has no refs", async () => {
		const id = await seedCitedDiagnosis();
		const client = await connect(["read", "write"]);
		const set = await client.callTool({
			name: "set_external_refs",
			arguments: { documentId: id, system: "notes", refs: [{ ref: "x.md" }] },
		});
		expect(set.isError).toBeFalsy();
		expect(structured<Detail>(set).externalRefs).toEqual([]);
		expect(JSON.stringify(set)).not.toContain("17-sante");
	});

	test("WHEN a read key searches referencedBy or notReferencedBy wiki THEN the sensitive document is never returned", async () => {
		const id = await seedCitedDiagnosis();
		const passport = await seedDocument("Passport");
		const client = await connect(["read"]);
		const cited = structured<SearchPage>(
			await client.callTool({
				name: "search_documents",
				arguments: { referencedBy: "wiki" },
			}),
		);
		expect(cited.items.map((item) => item.id)).toEqual([]);
		const orphans = structured<SearchPage>(
			await client.callTool({
				name: "search_documents",
				arguments: { notReferencedBy: "wiki" },
			}),
		);
		expect(orphans.items.map((item) => item.id)).toEqual([passport]);
		expect(orphans.items.map((item) => item.id)).not.toContain(id);
	});

	test("WHEN a read key calls list_activity on document.external_refs_set of a sensitive document THEN the paths are hidden", async () => {
		const id = await seedDocument("Diagnosis", { sensitive: true });
		const writer = await connect(["read", "write", "sensitive"]);
		await writer.callTool({
			name: "set_external_refs",
			arguments: { documentId: id, system: "wiki", refs: [{ ref: HEALTH }] },
		});
		const reader = await connect(["read"]);
		const result = await reader.callTool({
			name: "list_activity",
			arguments: { action: "document.external_refs_set" },
		});
		expect(result.isError).toBeFalsy();
		expect(JSON.stringify(result)).toContain("masked");
		expect(JSON.stringify(result)).not.toContain("17-sante");
	});

	test("WHEN a key with sensitive calls get_document and search_documents THEN it sees the refs as before", async () => {
		const id = await seedCitedDiagnosis();
		const client = await connect(["read", "sensitive"]);
		const got = await client.callTool({
			name: "get_document",
			arguments: { id },
		});
		expect(structured<Detail>(got).externalRefs).toEqual([
			{ system: "wiki", ref: HEALTH, url: null, label: "Diagnostic" },
		]);
		const cited = structured<SearchPage>(
			await client.callTool({
				name: "search_documents",
				arguments: { referencedBy: "wiki" },
			}),
		);
		expect(cited.items.map((item) => item.id)).toEqual([id]);
	});
});
