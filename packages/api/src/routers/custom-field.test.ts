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

async function seedDocument(title = "Invoice") {
	const rows = await db
		.insert(document)
		.values({ title, status: "active", createdById: owner.id })
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

describe("customField.create", () => {
	test("generates a slug and applies EUR by default on a money field", async () => {
		const field = await client.customField.create({
			name: "Total amount",
			type: "money",
		});
		expect(field.id).toStartWith("cf_");
		expect(field.slug).toBe("total-amount");
		expect(field.options.currency).toBe("EUR");
		expect(field.categoryIds).toEqual([]);
	});

	test("rejects an already taken slug", async () => {
		await client.customField.create({ name: "Total amount", type: "money" });
		await expectOrpcError(
			client.customField.create({ name: "Total amount", type: "text" }),
			"CONFLICT",
		);
	});

	test("a select field requires distinct choices", async () => {
		await expectOrpcError(
			client.customField.create({ name: "Status", type: "select" }),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			client.customField.create({
				name: "Status",
				type: "select",
				options: { choices: ["Paid", "Paid"] },
			}),
			"BAD_REQUEST",
		);

		const field = await client.customField.create({
			name: "Status",
			type: "select",
			options: { choices: ["Paid", "Pending"] },
		});
		expect(field.options.choices).toEqual(["Paid", "Pending"]);
	});

	test("attaches the field to existing categories", async () => {
		const payslip = await client.category.create({ name: "Payslip" });
		const field = await client.customField.create({
			name: "Net payable",
			type: "money",
			categoryIds: [payslip.id],
		});
		expect(field.categoryIds).toEqual([payslip.id]);

		await expectOrpcError(
			client.customField.create({
				name: "Other",
				type: "text",
				categoryIds: ["cat_x"],
			}),
			"NOT_FOUND",
		);
	});
});

describe("customField.update / reorder / delete", () => {
	test("forbids changing the type once a value exists", async () => {
		const field = await client.customField.create({
			name: "Invoice number",
			type: "text",
		});

		// As long as no value is entered, the type stays editable.
		const retyped = await client.customField.update({
			id: field.id,
			type: "number",
		});
		expect(retyped.type).toBe("number");

		const documentId = await seedDocument();
		await client.document.setFieldValue({
			id: documentId,
			fieldId: field.id,
			value: { kind: "number", number: 42 },
		});

		await expectOrpcError(
			client.customField.update({ id: field.id, type: "text" }),
			"CONFLICT",
		);
	});

	test("valueCount tracks the entered values on list and update", async () => {
		const field = await client.customField.create({
			name: "Invoice number",
			type: "text",
		});
		// A fresh field is never in use: the front end may still offer the type.
		expect(field.valueCount).toBe(0);
		expect((await client.customField.list({}))[0]?.valueCount).toBe(0);

		const first = await seedDocument();
		const second = await seedDocument("Second");
		for (const id of [first, second]) {
			await client.document.setFieldValue({
				id,
				fieldId: field.id,
				value: { kind: "text", text: "F-001" },
			});
		}

		expect((await client.customField.list({}))[0]?.valueCount).toBe(2);
		const renamed = await client.customField.update({
			id: field.id,
			name: "Invoice no.",
		});
		expect(renamed.valueCount).toBe(2);

		await client.document.clearFieldValue({ id: first, fieldId: field.id });
		expect((await client.customField.list({}))[0]?.valueCount).toBe(1);
	});

	test("reorders the fields", async () => {
		const a = await client.customField.create({ name: "A", type: "text" });
		const b = await client.customField.create({ name: "B", type: "text" });
		const c = await client.customField.create({ name: "C", type: "text" });

		const reordered = await client.customField.reorder({
			ids: [c.id, a.id, b.id],
		});
		expect(reordered.map((field) => field.id)).toEqual([c.id, a.id, b.id]);

		await expectOrpcError(
			client.customField.reorder({ ids: ["cf_x"] }),
			"NOT_FOUND",
		);
	});

	test("deleting a field erases its values", async () => {
		const field = await client.customField.create({
			name: "Total amount",
			type: "money",
		});
		const documentId = await seedDocument();
		await client.document.setFieldValue({
			id: documentId,
			fieldId: field.id,
			value: { kind: "money", amount: 12.5, currency: "EUR" },
		});

		await client.customField.delete({ id: field.id });

		const detail = await client.document.get({ id: documentId });
		expect(detail.fieldValues).toHaveLength(0);
		expect(await client.customField.list({})).toHaveLength(0);
	});
});

describe("document.setFieldValue — source", () => {
	test("stores an applied extraction as a rule value with its confidence", async () => {
		const field = await client.customField.create({
			name: "Net pay",
			type: "money",
		});
		const documentId = await seedDocument();

		const applied = await client.document.setFieldValue({
			id: documentId,
			fieldId: field.id,
			value: { kind: "money", amount: 1234.56, currency: "EUR" },
			source: "rule",
			confidence: 0.8,
		});
		expect(applied.fieldValues[0]?.source).toBe("rule");
		expect(applied.fieldValues[0]?.confidence).toBeCloseTo(0.8);

		// Back to a manual entry: the confidence goes away with it.
		const manual = await client.document.setFieldValue({
			id: documentId,
			fieldId: field.id,
			value: { kind: "money", amount: 10, currency: "EUR" },
		});
		expect(manual.fieldValues[0]?.source).toBe("manual");
		expect(manual.fieldValues[0]?.confidence).toBeNull();
	});
});

describe("document.setFieldValue — typed validation", () => {
	test("money accepts two decimals but not three", async () => {
		const field = await client.customField.create({
			name: "Total amount",
			type: "money",
		});
		const documentId = await seedDocument();

		const saved = await client.document.setFieldValue({
			id: documentId,
			fieldId: field.id,
			value: { kind: "money", amount: 1234.56, currency: "EUR" },
		});
		expect(saved.fieldValues).toHaveLength(1);
		expect(saved.fieldValues[0]?.value).toEqual({
			kind: "money",
			amount: 1234.56,
			currency: "EUR",
		});
		expect(saved.fieldValues[0]?.field.name).toBe("Total amount");
		expect(saved.fieldValues[0]?.source).toBe("manual");

		await expectOrpcError(
			client.document.setFieldValue({
				id: documentId,
				fieldId: field.id,
				value: { kind: "money", amount: 12.345, currency: "EUR" },
			}),
			"BAD_REQUEST",
		);

		await expectOrpcError(
			client.document.setFieldValue({
				id: documentId,
				fieldId: field.id,
				value: { kind: "money", amount: 10, currency: "euro" },
			}),
			"BAD_REQUEST",
		);
	});

	test("rejects a value whose type does not match the field", async () => {
		const field = await client.customField.create({
			name: "Total amount",
			type: "money",
		});
		const documentId = await seedDocument();

		await expectOrpcError(
			client.document.setFieldValue({
				id: documentId,
				fieldId: field.id,
				value: { kind: "text", text: "twelve euros" },
			}),
			"BAD_REQUEST",
		);
	});

	test("rejects a choice outside the list of a select field", async () => {
		const field = await client.customField.create({
			name: "Status",
			type: "select",
			options: { choices: ["Paid", "Pending"] },
		});
		const documentId = await seedDocument();

		const saved = await client.document.setFieldValue({
			id: documentId,
			fieldId: field.id,
			value: { kind: "select", choice: "Paid" },
		});
		expect(saved.fieldValues[0]?.value).toEqual({
			kind: "select",
			choice: "Paid",
		});

		await expectOrpcError(
			client.document.setFieldValue({
				id: documentId,
				fieldId: field.id,
				value: { kind: "select", choice: "Cancelled" },
			}),
			"BAD_REQUEST",
		);
	});

	test("rejects a nonexistent Party for a party_ref field", async () => {
		const field = await client.customField.create({
			name: "Payer",
			type: "party_ref",
		});
		const documentId = await seedDocument();

		await expectOrpcError(
			client.document.setFieldValue({
				id: documentId,
				fieldId: field.id,
				value: { kind: "party_ref", partyId: "prt_unknown" },
			}),
			"NOT_FOUND",
		);

		const edf = await client.party.create({ type: "company", name: "EDF" });
		const saved = await client.document.setFieldValue({
			id: documentId,
			fieldId: field.id,
			value: { kind: "party_ref", partyId: edf.id },
		});
		expect(saved.fieldValues[0]?.value).toEqual({
			kind: "party_ref",
			partyId: edf.id,
		});
	});

	test("overwrites the previous value then clears it", async () => {
		const field = await client.customField.create({
			name: "Invoice number",
			type: "text",
		});
		const documentId = await seedDocument();

		await client.document.setFieldValue({
			id: documentId,
			fieldId: field.id,
			value: { kind: "text", text: "F-001" },
		});
		const updated = await client.document.setFieldValue({
			id: documentId,
			fieldId: field.id,
			value: { kind: "text", text: "F-002" },
		});
		expect(updated.fieldValues).toHaveLength(1);
		expect(updated.fieldValues[0]?.value).toEqual({
			kind: "text",
			text: "F-002",
		});

		const cleared = await client.document.clearFieldValue({
			id: documentId,
			fieldId: field.id,
		});
		expect(cleared.fieldValues).toHaveLength(0);

		await expectOrpcError(
			client.document.clearFieldValue({ id: documentId, fieldId: field.id }),
			"NOT_FOUND",
		);
	});

	test("rejects an unknown field", async () => {
		const documentId = await seedDocument();
		await expectOrpcError(
			client.document.setFieldValue({
				id: documentId,
				fieldId: "cf_x",
				value: { kind: "text", text: "x" },
			}),
			"NOT_FOUND",
		);
	});
});
