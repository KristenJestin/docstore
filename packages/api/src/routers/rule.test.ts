import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { category } from "@docstore/db/schema/category";
import { customField } from "@docstore/db/schema/custom-field";
import { document } from "@docstore/db/schema/document";
import { ruleRun } from "@docstore/db/schema/rule";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { eq } from "drizzle-orm";
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

async function seedDocument(title: string, content: string): Promise<string> {
	const rows = await db
		.insert(document)
		.values({ title, status: "active", content, createdById: owner.id })
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

async function seedCategory(name: string, slug: string): Promise<string> {
	const rows = await db
		.insert(category)
		.values({ name, slug })
		.returning({ id: category.id });
	return rows[0]?.id ?? "";
}

async function seedField(): Promise<string> {
	const rows = await db
		.insert(customField)
		.values({
			name: "Total amount",
			slug: "total-amount",
			type: "money",
			options: { currency: "EUR" },
		})
		.returning({ id: customField.id });
	return rows[0]?.id ?? "";
}

/** Extraction rules live in a layout: this is the shortest way to get one. */
async function seedLayout(): Promise<string> {
	const created = await client.documentType.create({ name: "Invoice" });
	const detail = await client.documentType.get({ id: created.id });
	return detail.layouts[0]?.id ?? "";
}

const INVOICE_CONDITION = {
	field: "content",
	cmp: "icontains",
	value: "invoice",
} as const;

describe("rule.create / list / get", () => {
	test("creates a rule and gives it the next priority", async () => {
		const first = await client.rule.create({
			name: "Invoice",
			condition: INVOICE_CONDITION,
			actions: [],
		});
		expect(first.id).toStartWith("rul_");
		expect(first.priority).toBe(0);
		expect(first.triggers).toEqual(["ingest"]);
		expect(first.enabled).toBe(true);

		const second = await client.rule.create({
			name: "Payroll",
			condition: { field: "content", cmp: "icontains", value: "payroll" },
		});
		expect(second.priority).toBe(1);

		const list = await client.rule.list({});
		expect(list.map((item) => item.name)).toEqual(["Invoice", "Payroll"]);
		expect((await client.rule.get({ id: first.id })).name).toBe("Invoice");
	});

	test("accepts a nested condition tree", async () => {
		const created = await client.rule.create({
			name: "Nordwind payslip",
			condition: {
				op: "and",
				children: [
					{ field: "content", cmp: "icontains", value: "payslip" },
					{
						op: "or",
						children: [
							{ field: "content", cmp: "regex", value: "SIRET\\s*900" },
							{ field: "party.name", cmp: "eq", value: "Nordwind Digital" },
						],
					},
					{
						op: "not",
						children: [
							{ field: "filename", cmp: "startsWith", value: "draft" },
						],
					},
				],
			},
		});
		expect(created.condition).toMatchObject({ op: "and" });
	});

	test("rejects an unknown comparator", async () => {
		await expectOrpcError(
			client.rule.create({
				name: "Broken",
				condition: {
					field: "content",
					cmp: "like",
				} as unknown as Parameters<typeof client.rule.create>[0]["condition"],
			}),
			"BAD_REQUEST",
		);
	});

	test("404 on an unknown rule", async () => {
		await expectOrpcError(client.rule.get({ id: "rul_absent" }), "NOT_FOUND");
	});
});

describe("rule.update / delete / toggle / reorder", () => {
	test("updates a rule", async () => {
		const created = await client.rule.create({
			name: "Invoice",
			condition: INVOICE_CONDITION,
		});
		const updated = await client.rule.update({
			id: created.id,
			name: "Supplier invoices",
			triggers: ["ingest", "manual"],
			stopOnMatch: true,
		});
		expect(updated.name).toBe("Supplier invoices");
		expect(updated.triggers).toEqual(["ingest", "manual"]);
		expect(updated.stopOnMatch).toBe(true);
	});

	test("enables and disables", async () => {
		const created = await client.rule.create({
			name: "Invoice",
			condition: INVOICE_CONDITION,
		});
		expect(
			(await client.rule.toggle({ id: created.id, enabled: false })).enabled,
		).toBe(false);
		expect(
			(await client.rule.toggle({ id: created.id, enabled: true })).enabled,
		).toBe(true);
	});

	test("reorders according to the provided list", async () => {
		const a = await client.rule.create({
			name: "A",
			condition: INVOICE_CONDITION,
		});
		const b = await client.rule.create({
			name: "B",
			condition: INVOICE_CONDITION,
		});
		const ordered = await client.rule.reorder({ ids: [b.id, a.id] });
		expect(ordered.map((item) => item.name)).toEqual(["B", "A"]);
	});

	test("deletes a rule", async () => {
		const created = await client.rule.create({
			name: "Invoice",
			condition: INVOICE_CONDITION,
		});
		expect(await client.rule.delete({ id: created.id })).toEqual({
			id: created.id,
			deleted: true,
		});
		await expectOrpcError(client.rule.get({ id: created.id }), "NOT_FOUND");
	});
});

describe("rule.test (dry-run)", () => {
	test("evaluates a draft without writing anything", async () => {
		const documentId = await seedDocument(
			"EDF invoice",
			"INVOICE No. 2024-001 — Net payable 1 234,56 €",
		);

		const result = await client.rule.test({
			documentId,
			rule: {
				name: "Draft",
				condition: INVOICE_CONDITION,
				actions: [{ type: "set_sensitive", sensitive: true }],
			},
		});

		expect(result.matched).toBe(true);
		expect(result.trace).toHaveLength(1);
		expect(result.trace[0]).toMatchObject({ path: [], kind: "leaf" });
		expect(result.plannedActions).toEqual([
			{ type: "set_sensitive", sensitive: true },
		]);

		const rows = await db
			.select({ sensitive: document.sensitive })
			.from(document)
			.where(eq(document.id, documentId));
		expect(rows[0]?.sensitive).toBe(false);
		expect(await db.select().from(ruleRun)).toHaveLength(0);
	});

	test("evaluates a persisted rule, even a disabled one", async () => {
		const documentId = await seedDocument("Letter", "Just a letter");
		const created = await client.rule.create({
			name: "Invoice",
			enabled: false,
			condition: INVOICE_CONDITION,
		});

		const result = await client.rule.test({ ruleId: created.id, documentId });
		expect(result.matched).toBe(false);
		expect(result.plannedActions).toEqual([]);
	});

	test("exposes the result of the referenced extractions", async () => {
		const documentId = await seedDocument(
			"EDF invoice",
			"INVOICE\nIssued on 12/10/2025",
		);
		const layoutId = await seedLayout();
		const extraction = await client.extractionRule.create({
			name: "Issue date",
			layoutId,
			target: { kind: "document_date" },
			strategy: {
				kind: "regex",
				pattern: "Issued on\\s*(\\S+)",
				group: 1,
			},
			postprocess: ["date_fr"],
		});

		const result = await client.rule.test({
			documentId,
			rule: {
				name: "Draft",
				condition: INVOICE_CONDITION,
				actions: [
					{ type: "set_document_date", extractionRuleId: extraction.id },
				],
			},
		});
		expect(result.extractions[0]?.value).toBe("2025-10-12");
		expect(result.plannedActions[0]).toMatchObject({
			type: "set_document_date",
			date: "2025-10-12",
		});
	});

	test("set_field only carries a literal value", async () => {
		const fieldId = await seedField();
		const documentId = await seedDocument("EDF invoice", "INVOICE");

		const result = await client.rule.test({
			documentId,
			rule: {
				name: "Draft",
				condition: INVOICE_CONDITION,
				actions: [{ type: "set_field", fieldId, value: 42 }],
			},
		});
		expect(result.extractions).toEqual([]);
		expect(result.plannedActions[0]).toMatchObject({
			type: "set_field",
			fieldId,
			value: 42,
			confidence: 1,
		});
	});

	test("rejects ruleId and rule at the same time", async () => {
		const documentId = await seedDocument("Doc", "content");
		const created = await client.rule.create({
			name: "Invoice",
			condition: INVOICE_CONDITION,
		});
		await expectOrpcError(
			client.rule.test({
				documentId,
				ruleId: created.id,
				rule: { name: "X", condition: INVOICE_CONDITION, actions: [] },
			}),
			"BAD_REQUEST",
		);
	});
});

describe("rule.run", () => {
	test("requires documentIds or all", async () => {
		await expectOrpcError(client.rule.run({}), "BAD_REQUEST");
	});

	test("actually applies the actions on the targeted documents", async () => {
		const documentId = await seedDocument("EDF invoice", "INVOICE No. 1");
		const other = await seedDocument("Letter", "Just a letter");

		const created = await client.rule.create({
			name: "Invoice",
			triggers: ["manual"],
			condition: INVOICE_CONDITION,
			actions: [{ type: "set_sensitive", sensitive: true }],
		});

		const result = await client.rule.run({
			ruleId: created.id,
			documentIds: [documentId, other],
		});
		expect(result).toEqual({ processed: 2, matched: 1 });

		const rows = await db
			.select({ id: document.id, sensitive: document.sensitive })
			.from(document);
		expect(rows.find((row) => row.id === documentId)?.sensitive).toBe(true);
		expect(rows.find((row) => row.id === other)?.sensitive).toBe(false);
	});

	test("all processes the non-deleted documents", async () => {
		await seedDocument("EDF invoice", "INVOICE No. 1");
		await client.rule.create({
			name: "Invoice",
			triggers: ["manual"],
			condition: INVOICE_CONDITION,
			actions: [{ type: "set_sensitive", sensitive: true }],
		});

		expect(await client.rule.run({ all: true })).toEqual({
			processed: 1,
			matched: 1,
		});
	});

	test("404 on an unknown rule", async () => {
		const documentId = await seedDocument("Doc", "content");
		await expectOrpcError(
			client.rule.run({ ruleId: "rul_absent", documentIds: [documentId] }),
			"NOT_FOUND",
		);
	});

	test("recomputes the review reasons once the rule fills what was missing", async () => {
		const categoryId = await seedCategory("Invoice", "invoice");
		const documentTypeId = (
			await client.documentType.create({ name: "Invoice", categoryId })
		).id;
		const documentId = await seedDocument("EDF invoice", "INVOICE No. 1");
		await db
			.update(document)
			.set({
				status: "review",
				reviewReasons: [{ code: "missingCategory", message: "…" }],
			})
			.where(eq(document.id, documentId));

		const created = await client.rule.create({
			name: "Invoice",
			triggers: ["manual"],
			condition: INVOICE_CONDITION,
			actions: [{ type: "set_document_type", documentTypeId }],
		});
		await client.rule.run({ ruleId: created.id, documentIds: [documentId] });

		const rows = await db
			.select({
				status: document.status,
				reviewReasons: document.reviewReasons,
			})
			.from(document)
			.where(eq(document.id, documentId));
		expect(rows[0]?.status).toBe("active");
		expect(rows[0]?.reviewReasons).toEqual([]);
	});
});

describe("rule.runs", () => {
	test("logs manual runs and paginates", async () => {
		const documentId = await seedDocument("EDF invoice", "INVOICE No. 1");
		const created = await client.rule.create({
			name: "Invoice",
			triggers: ["manual"],
			condition: INVOICE_CONDITION,
			actions: [],
		});
		await client.rule.run({ ruleId: created.id, documentIds: [documentId] });

		const page = await client.rule.runs({ ruleId: created.id });
		expect(page.total).toBe(1);
		expect(page.items[0]).toMatchObject({
			ruleId: created.id,
			documentId,
			matched: true,
		});

		expect((await client.rule.runs({ documentId: "doc_absent" })).total).toBe(
			0,
		);
	});
});

describe("rule.test — hasActions and enabled", () => {
	test("an automation without action matches and would do nothing", async () => {
		const documentId = await seedDocument("Invoice", "TOTAL 42 EUR");
		// Exactly what migration `0013_automations-scope` left behind: the only
		// action was removed, the automation kept matching and doing nothing.
		const rule = await client.rule.create({
			name: "Leftover",
			condition: { field: "content", cmp: "icontains", value: "TOTAL" },
			actions: [],
		});

		const result = await client.rule.test({ ruleId: rule.id, documentId });
		expect(result.matched).toBe(true);
		expect(result.plannedActions).toEqual([]);
		expect(result.hasActions).toBe(false);
		expect(result.enabled).toBe(true);
	});

	test("an automation with actions lists what it would apply", async () => {
		const documentId = await seedDocument("Invoice", "TOTAL 42 EUR");
		const rule = await client.rule.create({
			name: "Sensitive",
			condition: { field: "content", cmp: "icontains", value: "TOTAL" },
			actions: [{ type: "set_sensitive", sensitive: true }],
		});

		const result = await client.rule.test({ ruleId: rule.id, documentId });
		expect(result.matched).toBe(true);
		expect(result.hasActions).toBe(true);
		expect(result.plannedActions).toEqual([
			{ type: "set_sensitive", sensitive: true },
		]);
	});

	test("a disabled automation stays testable and reports `enabled: false`", async () => {
		const documentId = await seedDocument("Invoice", "TOTAL 42 EUR");
		const rule = await client.rule.create({
			name: "Disabled",
			enabled: false,
			condition: { field: "content", cmp: "icontains", value: "TOTAL" },
			actions: [{ type: "set_sensitive", sensitive: true }],
		});

		const result = await client.rule.test({ ruleId: rule.id, documentId });
		expect(result.enabled).toBe(false);
		expect(result.matched).toBe(true);
		expect(result.hasActions).toBe(true);
	});
});

describe("rule.run — disabled automations", () => {
	test("refuses a disabled automation unless forced", async () => {
		const documentId = await seedDocument("Invoice", "TOTAL 42 EUR");
		const rule = await client.rule.create({
			name: "Disabled",
			enabled: false,
			triggers: ["manual"],
			condition: { field: "content", cmp: "icontains", value: "TOTAL" },
			actions: [{ type: "set_sensitive", sensitive: true }],
		});

		const error = await expectOrpcError(
			client.rule.run({ ruleId: rule.id, documentIds: [documentId] }),
			"BAD_REQUEST",
		);
		expect(error.message).toContain("disabled");
		expect((await client.document.get({ id: documentId })).sensitive).toBe(
			false,
		);

		expect(
			await client.rule.run({
				ruleId: rule.id,
				documentIds: [documentId],
				force: true,
			}),
		).toEqual({ processed: 1, matched: 1 });
		expect((await client.document.get({ id: documentId })).sensitive).toBe(
			true,
		);
	});
});
