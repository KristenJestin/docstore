import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { activityLog } from "@docstore/db/schema/activity";
import {
	customField,
	documentFieldValue,
} from "@docstore/db/schema/custom-field";
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
 * Issue #22, MCP side: an API key without the `sensitive` scope gets no custom
 * field values and no notes of a sensitive document (`get_document`, the
 * `docstore://document/{id}` resource, the write tools), cannot find it by a
 * word of its OCR text, and reads no field value in the activity log.
 */

let db: TestDb;
let userId: string;
let netPayId: string;
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
	const fields = await db
		.insert(customField)
		.values({ name: "Net pay", slug: "net-pay", type: "money" })
		.returning({ id: customField.id });
	netPayId = fields[0]?.id ?? "";
});

async function connect(scopes: ApiKeyScope[]) {
	const harness = await createMcpTestClient({ db, userId, scopes });
	harnesses.push(harness);
	return harness.client;
}

async function seedPayslip(options: { sensitive: boolean }): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title: "Payslip March",
			status: "active",
			createdById: userId,
			sensitive: options.sensitive,
			content: "Employer Zorglub net pay 2345.67",
			notes: "Raise negotiated with Quimperlé",
		})
		.returning({ id: document.id });
	const id = rows[0]?.id ?? "";
	await db.insert(documentFieldValue).values({
		documentId: id,
		fieldId: netPayId,
		value: { kind: "money", amount: 2345.67, currency: "EUR" },
		source: "manual",
	});
	return id;
}

type DetailJson = {
	title: string;
	masked: boolean;
	notes: string | null;
	fieldValues: unknown[];
};

function structured<T>(result: unknown): T {
	return (result as { structuredContent?: unknown }).structuredContent as T;
}

function textOf(result: unknown): string {
	const blocks =
		(result as { content?: { type: string; text?: string }[] }).content ?? [];
	return blocks.map((block) => block.text ?? "").join("\n");
}

describe("Docstore SHALL mask the field values and notes of a sensitive document for an API key without sensitive (MCP)", () => {
	test("WHEN a read key calls get_document on a sensitive payslip THEN it has no field values, no notes, and masked is true", async () => {
		const id = await seedPayslip({ sensitive: true });
		const client = await connect(["read"]);
		const result = await client.callTool({
			name: "get_document",
			arguments: { id },
		});
		const detail = structured<DetailJson>(result);
		expect(detail.masked).toBe(true);
		expect(detail.fieldValues).toEqual([]);
		expect(detail.notes).toBeNull();
		expect(detail.title).toBe("Payslip March");
		expect(textOf(result)).toContain("masked");
		expect(textOf(result)).not.toContain("2345");
	});

	test("WHEN a read key reads the docstore://document resource of a sensitive payslip THEN it has no field values and no notes", async () => {
		const id = await seedPayslip({ sensitive: true });
		const client = await connect(["read"]);
		const read = await client.readResource({
			uri: `docstore://document/${id}`,
		});
		const text =
			(read.contents[0] as { text?: string } | undefined)?.text ?? "";
		const payload = JSON.parse(text) as DetailJson;
		expect(payload.masked).toBe(true);
		expect(payload.fieldValues).toEqual([]);
		expect(payload.notes).toBeNull();
		expect(text).not.toContain("2345");
		expect(text).not.toContain("Quimperlé");
	});

	test("WHEN a write key sets a field value on a sensitive payslip THEN the document it gets back is masked", async () => {
		const id = await seedPayslip({ sensitive: true });
		const client = await connect(["read", "write"]);
		const result = await client.callTool({
			name: "set_field_value",
			arguments: {
				documentId: id,
				fieldId: netPayId,
				value: { kind: "money", amount: 3000, currency: "EUR" },
			},
		});
		const detail = structured<DetailJson>(result);
		expect(detail.masked).toBe(true);
		expect(detail.fieldValues).toEqual([]);
	});

	test("WHEN a key with sensitive calls get_document THEN it sees the values and the notes as before", async () => {
		const id = await seedPayslip({ sensitive: true });
		const client = await connect(["read", "sensitive"]);
		const detail = structured<DetailJson>(
			await client.callTool({ name: "get_document", arguments: { id } }),
		);
		expect(detail.masked).toBe(false);
		expect(detail.fieldValues).toHaveLength(1);
		expect(detail.notes).toBe("Raise negotiated with Quimperlé");
	});
});

describe("Docstore SHALL not match the OCR text nor the notes of a sensitive document in search_documents for an API key without sensitive", () => {
	test("WHEN a read key searches a word only present in its OCR text or notes THEN the sensitive payslip is not returned", async () => {
		await seedPayslip({ sensitive: true });
		const client = await connect(["read"]);
		for (const query of ["Zorglub", "Quimperlé"]) {
			const page = structured<{ total: number }>(
				await client.callTool({
					name: "search_documents",
					arguments: { query },
				}),
			);
			expect(page.total).toBe(0);
		}
		const byTitle = structured<{ total: number }>(
			await client.callTool({
				name: "search_documents",
				arguments: { query: "payslip" },
			}),
		);
		expect(byTitle.total).toBe(1);
	});

	test("WHEN a key with sensitive searches the same word THEN the payslip is returned", async () => {
		await seedPayslip({ sensitive: true });
		const client = await connect(["read", "sensitive"]);
		const page = structured<{ total: number }>(
			await client.callTool({
				name: "search_documents",
				arguments: { query: "Zorglub" },
			}),
		);
		expect(page.total).toBe(1);
	});
});

describe("Docstore SHALL not give the value of a field change on a sensitive document through list_activity", () => {
	test("WHEN a read key lists the activity of a sensitive payslip THEN field entries carry no value", async () => {
		const id = await seedPayslip({ sensitive: true });
		// An entry written with its values before issue #22.
		await db.insert(activityLog).values({
			kind: "change",
			actorType: "user",
			actorUserId: userId,
			action: "document.field_set",
			objectType: "document",
			objectId: id,
			objectLabel: "Payslip March",
			sensitive: true,
			summary: {
				field: { id: netPayId, name: "Net pay" },
				value: { before: null, after: { kind: "money", amount: 2345.67 } },
			},
		});
		const client = await connect(["read"]);
		const result = await client.callTool({
			name: "list_activity",
			arguments: { objectId: id },
		});
		expect(JSON.stringify(result)).not.toContain("2345");
		const page = structured<{ items: { summary: { value?: unknown } }[] }>(
			result,
		);
		expect(page.items[0]?.summary.value).toEqual({ changed: true });
	});
});
