import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { documentFieldValue } from "@docstore/db/schema/custom-field";
import { document } from "@docstore/db/schema/document";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { ApiKeyScope } from "@docstore/shared/api-key";
import type { CustomFieldOptions } from "@docstore/shared/custom-field";
import { addDays, todayIso } from "@docstore/shared/recurrence";
import type { ReminderItem } from "@docstore/shared/reminder";
import {
	type DueReminder,
	generateReminders,
} from "../services/reminder.service";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

/**
 * Issue #33: a `date` custom field marked "remind me" produces reminders for
 * every document holding a value, kept current when the value changes and
 * gone when the document is trashed.
 */

let db: TestDb;
let owner: TestUser;
let client: ReturnType<typeof createTestClient>;

const today = todayIso();
const in60Days = addDays(today, 60);

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

function keyClient(scopes: ApiKeyScope[]) {
	return createTestClient(db, owner, { id: "key_test", scopes });
}

async function warrantyEndField(
	options: CustomFieldOptions = { remind: true },
): Promise<string> {
	const field = await client.customField.create({
		name: "Warranty end",
		slug: "warranty-end",
		type: "date",
		options,
	});
	return field.id;
}

async function seedDocument(
	title: string,
	overrides: Partial<typeof document.$inferInsert> = {},
): Promise<string> {
	const rows = await db
		.insert(document)
		.values({ title, status: "active", createdById: owner.id, ...overrides })
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

/** A dishwasher invoice whose warranty ends on `date`. */
async function seedWarranty(
	fieldId: string,
	date: string,
	overrides: Partial<typeof document.$inferInsert> = {},
): Promise<string> {
	const id = await seedDocument("Dishwasher invoice", overrides);
	await client.document.setFieldValue({
		id,
		fieldId,
		value: { kind: "date", date },
	});
	return id;
}

/** A value written behind the services' back, as the ingestion rules do. */
async function insertValue(
	documentId: string,
	fieldId: string,
	date: string,
): Promise<void> {
	await db
		.insert(documentFieldValue)
		.values({ documentId, fieldId, value: { kind: "date", date } });
}

async function fieldReminders(caller = client): Promise<ReminderItem[]> {
	return caller.reminder.list({ kind: "field_date" });
}

describe("Docstore SHALL remind of a date field marked remind me", () => {
	test("WHEN a warranty end 60 days away is set THEN the document gets a D-30 and a D-7 reminder", async () => {
		const fieldId = await warrantyEndField();
		const id = await seedWarranty(fieldId, in60Days);

		const reminders = await fieldReminders();
		expect(reminders.map((item) => [item.dueDate, item.daysBefore])).toEqual([
			[addDays(in60Days, -30), 30],
			[addDays(in60Days, -7), 7],
		]);
		expect(reminders.every((item) => item.documentId === id)).toBe(true);
		expect(reminders.every((item) => item.status === "pending")).toBe(true);
	});

	test("WHEN a reminder is listed THEN it names the document, the field and the date", async () => {
		const fieldId = await warrantyEndField();
		await seedWarranty(fieldId, "2099-06-30");

		const reminders = await fieldReminders();
		const d7 = reminders.find((item) => item.daysBefore === 7);
		expect(d7?.documentTitle).toBe("Dishwasher invoice");
		expect(d7?.fieldId).toBe(fieldId);
		expect(d7?.fieldName).toBe("Warranty end");
		expect(d7?.fieldDate).toBe("2099-06-30");
		expect(d7?.message).toBe(
			'"Dishwasher invoice": Warranty end on 30 Jun 2099 (reminder at D-7).',
		);
	});

	test("WHEN the date changes THEN the reminders move to the new date", async () => {
		const fieldId = await warrantyEndField();
		const id = await seedWarranty(fieldId, in60Days);
		const later = addDays(in60Days, 200);

		await client.document.setFieldValue({
			id,
			fieldId,
			value: { kind: "date", date: later },
		});

		const reminders = await fieldReminders();
		expect(reminders.map((item) => item.dueDate)).toEqual([
			addDays(later, -90),
			addDays(later, -30),
			addDays(later, -7),
		]);
		expect(reminders.every((item) => item.fieldDate === later)).toBe(true);
	});

	test("WHEN the document is trashed THEN its reminders go, and a restore brings them back", async () => {
		const fieldId = await warrantyEndField();
		const id = await seedWarranty(fieldId, in60Days);

		await client.document.trash({ id });
		expect(await fieldReminders()).toHaveLength(0);
		expect(await client.reminder.list({ status: "dismissed" })).toHaveLength(0);

		await client.document.restore({ id });
		expect(await fieldReminders()).toHaveLength(2);
	});

	test("WHEN the value is cleared THEN the reminders go", async () => {
		const fieldId = await warrantyEndField();
		const id = await seedWarranty(fieldId, in60Days);

		await client.document.clearFieldValue({ id, fieldId });
		expect(await fieldReminders()).toHaveLength(0);
	});

	test("WHEN the field is not marked remind me THEN its dates produce no reminder", async () => {
		const fieldId = await warrantyEndField({});
		await seedWarranty(fieldId, in60Days);

		expect(await fieldReminders()).toHaveLength(0);
		await client.reminder.generate({});
		expect(await fieldReminders()).toHaveLength(0);
	});

	test("WHEN remind me is switched on or off THEN the documents holding a value follow", async () => {
		const fieldId = await warrantyEndField({});
		await seedWarranty(fieldId, in60Days);

		await client.customField.update({ id: fieldId, options: { remind: true } });
		expect(await fieldReminders()).toHaveLength(2);

		await client.customField.update({ id: fieldId, options: {} });
		expect(await fieldReminders()).toHaveLength(0);
	});

	test("WHEN the field has its own lead days THEN they replace the expiry ones", async () => {
		const fieldId = await warrantyEndField({
			remind: true,
			reminderLeadDays: [14, 45],
		});
		await seedWarranty(fieldId, in60Days);

		const reminders = await fieldReminders();
		expect(reminders.map((item) => item.daysBefore)).toEqual([45, 14]);

		await client.customField.update({
			id: fieldId,
			options: { remind: true, reminderLeadDays: [1] },
		});
		expect((await fieldReminders()).map((item) => item.daysBefore)).toEqual([
			1,
		]);
	});

	test("WHEN no lead day is set on the field THEN the expiry lead days of the settings apply", async () => {
		await client.settings.set({
			key: "reminders.expiryLeadDays",
			value: [20],
		});
		const fieldId = await warrantyEndField();
		await seedWarranty(fieldId, in60Days);

		const reminders = await fieldReminders();
		expect(reminders.map((item) => item.daysBefore)).toEqual([20]);
	});

	test("WHEN every lead is already past but the date is ahead THEN the shortest one is due at once", async () => {
		const fieldId = await warrantyEndField();
		const soon = addDays(today, 3);
		await seedWarranty(fieldId, soon);

		const reminders = await fieldReminders();
		expect(reminders.map((item) => [item.dueDate, item.daysBefore])).toEqual([
			[addDays(soon, -7), 7],
		]);
	});

	test("WHEN the date has already passed THEN no reminder is created", async () => {
		const fieldId = await warrantyEndField();
		await seedWarranty(fieldId, addDays(today, -1));

		expect(await fieldReminders()).toHaveLength(0);
	});

	test("WHEN a due date passes THEN the reminder stays until it is handled", async () => {
		const fieldId = await warrantyEndField();
		await seedWarranty(fieldId, in60Days);

		// 40 days later the D-30 is due and 10 days late: it is not dropped.
		const result = await generateReminders(db, {
			today: addDays(today, 40),
		});
		expect(result.removed).toBe(0);
		expect(await fieldReminders()).toHaveLength(2);
	});

	test("WHEN reminder.generate runs THEN it creates the same reminders, idempotently", async () => {
		const fieldId = await warrantyEndField();
		const id = await seedDocument("Dishwasher invoice");
		await insertValue(id, fieldId, in60Days);
		expect(await fieldReminders()).toHaveLength(0);

		const first = await client.reminder.generate({});
		expect(first.created).toBe(2);
		const second = await client.reminder.generate({});
		expect(second).toMatchObject({ created: 0, updated: 0, removed: 0 });
		expect(await fieldReminders()).toHaveLength(2);
	});

	test("WHEN the field is deleted THEN its reminders go with it", async () => {
		const fieldId = await warrantyEndField();
		await seedWarranty(fieldId, in60Days);

		await client.customField.delete({ id: fieldId });
		expect(await fieldReminders()).toHaveLength(0);
	});

	test("WHEN a non-date field asks for reminders THEN it is refused", async () => {
		await expectOrpcError(
			client.customField.create({
				name: "Amount",
				type: "number",
				options: { remind: true },
			}),
			"BAD_REQUEST",
		);
	});

	test("WHEN a date field reminder falls due THEN reminder.due carries the field and the date", async () => {
		const fieldId = await warrantyEndField();
		const id = await seedDocument("Dishwasher invoice");
		await insertValue(id, fieldId, addDays(today, 3));

		const due: DueReminder[] = [];
		await generateReminders(db, {
			onDueCreated: async (items) => {
				due.push(...items);
			},
		});
		expect(due).toHaveLength(1);
		expect(due[0]).toMatchObject({
			kind: "field_date",
			documentId: id,
			documentTitle: "Dishwasher invoice",
			fieldId,
			fieldName: "Warranty end",
			daysBefore: 7,
		});
		expect(due[0]?.message).toContain("Warranty end on");
	});
});

describe("Docstore SHALL withhold the date field reminders of a sensitive document from a key without sensitive", () => {
	test("WHEN a read key lists reminders THEN a sensitive document's date field reminders are absent, its expiry ones are not", async () => {
		const fieldId = await warrantyEndField();
		await seedWarranty(fieldId, in60Days, {
			sensitive: true,
			validUntil: "2099-06-30",
		});

		const reader = keyClient(["read"]);
		const listed = await reader.reminder.list({});
		expect(listed.some((item) => item.kind === "field_date")).toBe(false);
		expect(listed.filter((item) => item.kind === "expiry")).toHaveLength(3);
		expect(await fieldReminders(reader)).toHaveLength(0);
	});

	test("WHEN a read key counts reminders THEN the withheld ones are not counted", async () => {
		const fieldId = await warrantyEndField();
		await seedWarranty(fieldId, addDays(today, 20), { sensitive: true });

		expect((await client.reminder.count({})).count).toBe(1);
		expect((await keyClient(["read"]).reminder.count({})).count).toBe(0);
	});

	test("WHEN a write key acts on a withheld reminder by id THEN it is not found", async () => {
		const fieldId = await warrantyEndField();
		await seedWarranty(fieldId, in60Days, { sensitive: true });
		const [first] = await fieldReminders();
		if (!first) throw new Error("no reminder");

		const writer = keyClient(["read", "write"]);
		await expectOrpcError(
			writer.reminder.dismiss({ id: first.id }),
			"NOT_FOUND",
		);
		await expectOrpcError(writer.reminder.done({ id: first.id }), "NOT_FOUND");
		await expectOrpcError(
			writer.reminder.snooze({ id: first.id, until: in60Days }),
			"NOT_FOUND",
		);
	});

	test("WHEN a key with sensitive or a session lists reminders THEN it sees the field and the date", async () => {
		const fieldId = await warrantyEndField();
		await seedWarranty(fieldId, in60Days, { sensitive: true });

		for (const caller of [keyClient(["read", "sensitive"]), client]) {
			const reminders = await fieldReminders(caller);
			expect(reminders).toHaveLength(2);
			expect(reminders[0]?.fieldName).toBe("Warranty end");
			expect(reminders[0]?.fieldDate).toBe(in60Days);
		}
	});

	test("WHEN the document is not sensitive THEN a read key sees its date field reminders", async () => {
		const fieldId = await warrantyEndField();
		await seedWarranty(fieldId, in60Days);

		expect(await fieldReminders(keyClient(["read"]))).toHaveLength(2);
	});
});
