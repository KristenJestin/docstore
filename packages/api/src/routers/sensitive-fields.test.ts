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
import { settleActivityReads } from "@docstore/ingestion";
import type { ActivitySummary } from "@docstore/shared/activity";
import {
	type ApiKeyScope,
	SENSITIVE_PLACEHOLDER,
} from "@docstore/shared/api-key";
import { and, eq, like } from "drizzle-orm";
import { createTestClient, createTestUser, type TestUser } from "../test-utils";

/**
 * Issue #22 (study of #13, option A): an API key without the `sensitive` scope
 * learns nothing protected about a sensitive document. Its custom field values
 * and notes are masked like its OCR text, full-text search matches it on its
 * title only, field-value filters never match it, and the activity log never
 * stores the values of its field changes. Its metadata stays visible.
 */

let db: TestDb;
let owner: TestUser;
let netPayId: string;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
	const fields = await db
		.insert(customField)
		.values({ name: "Net pay", slug: "net-pay", type: "money" })
		.returning({ id: customField.id });
	netPayId = fields[0]?.id ?? "";
});

function keyClient(scopes: ApiKeyScope[]) {
	return createTestClient(db, owner, { id: "key_test", scopes });
}

/** A payslip: OCR text with a word found nowhere else, a net pay, notes. */
async function seedPayslip(options: { sensitive: boolean }): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title: "Payslip March",
			status: "active",
			createdById: owner.id,
			sensitive: options.sensitive,
			documentDate: "2026-03-31",
			content:
				"Employer Zorglub net pay 2345.67 IBAN FR7630001007941234567890185",
			notes: "Raise negotiated with Quimperlé",
		})
		.returning({ id: document.id });
	const id = rows[0]?.id ?? "";
	await db.insert(documentFieldValue).values({
		documentId: id,
		fieldId: netPayId,
		value: { kind: "money", amount: 2345.67, currency: "EUR" },
		source: "rule",
		confidence: 0.9,
	});
	return id;
}

describe("Docstore SHALL mask the field values and notes of a sensitive document for an API key without sensitive", () => {
	test("WHEN a read key gets a sensitive payslip THEN it has no field values, no notes, and masked is true", async () => {
		const id = await seedPayslip({ sensitive: true });
		const detail = await keyClient(["read"]).document.get({ id });
		expect(detail.masked).toBe(true);
		expect(detail.fieldValues).toEqual([]);
		expect(detail.notes).toBeNull();
		expect(detail.content).toBe(SENSITIVE_PLACEHOLDER);
		// Metadata stays visible.
		expect(detail.title).toBe("Payslip March");
		expect(detail.documentDate).toBe("2026-03-31");
		expect(detail.sensitive).toBe(true);
	});

	test("WHEN a write key changes a sensitive payslip THEN the document it gets back is masked too", async () => {
		const id = await seedPayslip({ sensitive: true });
		const client = keyClient(["write"]);
		const updated = await client.document.update({ id, title: "Payslip" });
		expect(updated.fieldValues).toEqual([]);
		expect(updated.notes).toBeNull();
		const set = await client.document.setFieldValue({
			id,
			fieldId: netPayId,
			value: { kind: "money", amount: 3000, currency: "EUR" },
		});
		expect(set.fieldValues).toEqual([]);
		expect(set.masked).toBe(true);
	});

	test("WHEN a read key gets a non-sensitive document THEN its values and notes are served", async () => {
		const id = await seedPayslip({ sensitive: false });
		const detail = await keyClient(["read"]).document.get({ id });
		expect(detail.masked).toBe(false);
		expect(detail.fieldValues).toHaveLength(1);
		expect(detail.notes).toBe("Raise negotiated with Quimperlé");
	});

	test("WHEN a key with sensitive or a session gets a sensitive payslip THEN it sees everything as before", async () => {
		const id = await seedPayslip({ sensitive: true });
		for (const client of [
			keyClient(["read", "sensitive"]),
			createTestClient(db, owner),
		]) {
			const detail = await client.document.get({ id });
			expect(detail.masked).toBe(false);
			expect(detail.fieldValues[0]?.value).toEqual({
				kind: "money",
				amount: 2345.67,
				currency: "EUR",
			});
			expect(detail.notes).toBe("Raise negotiated with Quimperlé");
		}
	});
});

describe("Docstore SHALL not match the OCR text nor the notes of a sensitive document in a full-text search by an API key without sensitive", () => {
	test("WHEN a read key searches a word only present in the OCR text of a sensitive payslip THEN it is not returned", async () => {
		await seedPayslip({ sensitive: true });
		const page = await keyClient(["read"]).document.list({
			query: "Zorglub",
		});
		expect(page.total).toBe(0);
		expect(page.items).toEqual([]);
	});

	test("WHEN it searches a word only present in the notes THEN it is not returned", async () => {
		await seedPayslip({ sensitive: true });
		const page = await keyClient(["read"]).document.list({
			query: "Quimperlé",
		});
		expect(page.total).toBe(0);
	});

	test("WHEN it searches a word of the title THEN the sensitive payslip is returned", async () => {
		const id = await seedPayslip({ sensitive: true });
		const page = await keyClient(["read"]).document.list({ query: "payslip" });
		expect(page.items.map((item) => item.id)).toEqual([id]);
	});

	test("WHEN the payslip is not sensitive THEN its OCR text still matches", async () => {
		const id = await seedPayslip({ sensitive: false });
		const page = await keyClient(["read"]).document.list({
			query: "Zorglub",
		});
		expect(page.items.map((item) => item.id)).toEqual([id]);
	});

	test("WHEN a key with sensitive or a session searches it THEN the OCR text and the notes match as before", async () => {
		const id = await seedPayslip({ sensitive: true });
		for (const client of [
			keyClient(["read", "sensitive"]),
			createTestClient(db, owner),
		]) {
			for (const query of ["Zorglub", "Quimperlé"]) {
				const page = await client.document.list({ query });
				expect(page.items.map((item) => item.id)).toEqual([id]);
			}
		}
	});
});

describe("Docstore SHALL never match a sensitive document with a field-value filter for an API key without sensitive", () => {
	test("WHEN a read key filters netPay > 0 THEN the sensitive payslip is not returned", async () => {
		await seedPayslip({ sensitive: true });
		const plain = await seedPayslip({ sensitive: false });
		const page = await keyClient(["read"]).document.list({
			fieldFilters: [{ fieldId: netPayId, op: "gt", value: 0 }],
		});
		expect(page.items.map((item) => item.id)).toEqual([plain]);
	});

	test("WHEN a key with sensitive or a session filters netPay > 0 THEN the sensitive payslip is returned", async () => {
		const id = await seedPayslip({ sensitive: true });
		for (const client of [
			keyClient(["read", "sensitive"]),
			createTestClient(db, owner),
		]) {
			const page = await client.document.list({
				fieldFilters: [{ fieldId: netPayId, op: "gt", value: 0 }],
			});
			expect(page.items.map((item) => item.id)).toEqual([id]);
		}
	});
});

describe("Docstore SHALL never store the values of a field change on a sensitive document in the activity log", () => {
	async function fieldEntries(id: string): Promise<ActivitySummary[]> {
		await settleActivityReads();
		const rows = await db
			.select({ summary: activityLog.summary })
			.from(activityLog)
			.where(
				and(
					eq(activityLog.objectId, id),
					like(activityLog.action, "document.field_%"),
				),
			);
		return rows.map((row) => row.summary);
	}

	test("WHEN a manual field change is made on a sensitive document THEN its activity entry contains no value", async () => {
		const id = await seedPayslip({ sensitive: true });
		const client = createTestClient(db, owner);
		await client.document.setFieldValue({
			id,
			fieldId: netPayId,
			value: { kind: "money", amount: 3100.5, currency: "EUR" },
		});
		await client.document.clearFieldValue({ id, fieldId: netPayId });

		const entries = await fieldEntries(id);
		expect(entries).toHaveLength(2);
		for (const summary of entries) {
			expect(summary.value).toEqual({ changed: true });
			expect(summary.field).toMatchObject({ name: "Net pay" });
			const text = JSON.stringify(summary);
			expect(text).not.toContain("3100");
			expect(text).not.toContain("2345");
		}
		// Whoever reads the log, a session included, gets no value back.
		const page = await client.activity.list({ objectId: id });
		expect(JSON.stringify(page.items)).not.toContain("2345");
	});

	test("WHEN the document is not sensitive THEN the entry keeps the values before and after", async () => {
		const id = await seedPayslip({ sensitive: false });
		await createTestClient(db, owner).document.setFieldValue({
			id,
			fieldId: netPayId,
			value: { kind: "money", amount: 3100.5, currency: "EUR" },
		});
		const [summary] = await fieldEntries(id);
		expect(summary?.value).toMatchObject({
			before: { amount: 2345.67 },
			after: { amount: 3100.5 },
		});
	});

	test("WHEN a read key lists an entry written with values before the fix THEN the values are masked", async () => {
		const id = await seedPayslip({ sensitive: true });
		await db.insert(activityLog).values({
			kind: "change",
			actorType: "user",
			actorUserId: owner.id,
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
		const page = await keyClient(["read"]).activity.list({ objectId: id });
		const entry = page.items.find(
			(item) => item.action === "document.field_set",
		);
		expect(entry?.summary.value).toEqual({ changed: true });
		const full = await keyClient(["read", "sensitive"]).activity.list({
			objectId: id,
		});
		expect(JSON.stringify(full.items)).toContain("2345.67");
	});
});
