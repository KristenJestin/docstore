import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { generateReminders } from "@docstore/api/services/reminder.service";
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
import { addDays, todayIso } from "@docstore/shared/recurrence";
import {
	createMcpTestClient,
	insertTestUser,
	type McpTestHarness,
} from "./test-utils";

/**
 * Issue #33, MCP side: `list_reminders` hands out the reminders of the date
 * custom fields marked "remind me", naming the field and its date, and
 * withholds those of a sensitive document from a key without `sensitive`.
 */

let db: TestDb;
let userId: string;
let fieldId: string;
const warrantyEnd = addDays(todayIso(), 60);
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
		.values({
			name: "Warranty end",
			slug: "warranty-end",
			type: "date",
			options: { remind: true },
		})
		.returning({ id: customField.id });
	fieldId = fields[0]?.id ?? "";
});

async function connect(scopes: ApiKeyScope[]) {
	const harness = await createMcpTestClient({ db, userId, scopes });
	harnesses.push(harness);
	return harness.client;
}

async function seedWarranty(options: { sensitive: boolean }): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title: "Dishwasher invoice",
			status: "active",
			createdById: userId,
			sensitive: options.sensitive,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id ?? "";
	await db.insert(documentFieldValue).values({
		documentId: id,
		fieldId,
		value: { kind: "date", date: warrantyEnd },
	});
	await generateReminders(db);
	return id;
}

type ReminderJson = {
	kind: string;
	documentId: string | null;
	fieldId: string | null;
	fieldName: string | null;
	fieldDate: string | null;
	daysBefore: number | null;
	message: string;
};

async function listReminders(scopes: ApiKeyScope[]): Promise<ReminderJson[]> {
	const client = await connect(scopes);
	const result = await client.callTool({
		name: "list_reminders",
		arguments: {},
	});
	return (result as unknown as { structuredContent: { items: ReminderJson[] } })
		.structuredContent.items;
}

describe("Docstore SHALL list the reminders of a date field marked remind me through MCP", () => {
	test("WHEN a read key calls list_reminders THEN each reminder names the document, the field and the date", async () => {
		const id = await seedWarranty({ sensitive: false });
		const items = await listReminders(["read"]);
		expect(items.map((item) => item.daysBefore)).toEqual([30, 7]);
		for (const item of items) {
			expect(item).toMatchObject({
				kind: "field_date",
				documentId: id,
				fieldId,
				fieldName: "Warranty end",
				fieldDate: warrantyEnd,
			});
			expect(item.message).toContain('"Dishwasher invoice": Warranty end on');
		}
	});

	test("WHEN a read key without sensitive calls list_reminders THEN a sensitive document's date field reminders are withheld", async () => {
		await seedWarranty({ sensitive: true });
		expect(await listReminders(["read"])).toEqual([]);
		expect(await listReminders(["read", "sensitive"])).toHaveLength(2);
	});
});
