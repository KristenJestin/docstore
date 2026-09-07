import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { category } from "@docstore/db/schema/category";
import { document, documentParty } from "@docstore/db/schema/document";
import { party } from "@docstore/db/schema/party";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import {
	addDays,
	addMonths,
	periodStartOf,
	todayIso,
} from "@docstore/shared/recurrence";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

let db: TestDb;
let owner: TestUser;
let client: ReturnType<typeof createTestClient>;
let partyId: string;
let categoryId: string;

/** Fully elapsed monthly period: its due date is already in the past. */
const previousMonth = addMonths(periodStartOf("monthly", todayIso()), -1);

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

	const parties = await db
		.insert(party)
		.values({ type: "company", name: "EDF" })
		.returning({ id: party.id });
	partyId = parties[0]?.id ?? "";

	const categories = await db
		.insert(category)
		.values({ name: "Invoice", slug: "invoice" })
		.returning({ id: category.id });
	categoryId = categories[0]?.id ?? "";
});

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

/** Monthly recurring type with a single elapsed period and no document. */
function gapTypeInput(graceDays: number) {
	return {
		name: "EDF invoice",
		issuerPartyId: partyId,
		categoryId,
		recurrence: {
			periodicity: "monthly" as const,
			startPeriod: previousMonth,
			endPeriod: previousMonth,
			graceDays,
		},
	};
}

describe("reminder.generate — expiry", () => {
	test("one reminder per lead day, at the right due dates", async () => {
		await seedDocument("ID card", { validUntil: "2027-06-30" });

		const result = await client.reminder.generate({});
		expect(result.created).toBe(3);
		expect(result.total).toBe(3);

		const reminders = await client.reminder.list({});
		expect(reminders.map((item) => item.dueDate)).toEqual([
			"2027-04-01",
			"2027-05-31",
			"2027-06-23",
		]);
		expect(reminders.every((item) => item.kind === "expiry")).toBe(true);
		expect(reminders[0]?.documentTitle).toBe("ID card");
		expect(reminders[0]?.status).toBe("pending");
	});

	test("formats the due date as en-GB in the message", async () => {
		await seedDocument("Passport (en-GB)", { validUntil: "2027-06-30" });
		await client.reminder.generate({});

		const reminders = await client.reminder.list({});
		const onDueDate = reminders.find((item) => item.dueDate === "2027-06-23");
		expect(onDueDate?.message).toBe(
			'"Passport (en-GB)" expires on 30 Jun 2027 (reminder at D-7).',
		);
		expect(onDueDate?.message).not.toContain("2027-06-30");
	});

	test("is idempotent", async () => {
		await seedDocument("Passport", { validUntil: "2027-06-30" });
		await client.reminder.generate({});

		const second = await client.reminder.generate({});
		expect(second).toEqual({
			created: 0,
			updated: 0,
			removed: 0,
			total: 3,
		});
	});

	test("follows the `reminders.expiryLeadDays` setting", async () => {
		await seedDocument("Insurance", { validUntil: "2027-06-30" });
		await client.settings.set({
			key: "reminders.expiryLeadDays",
			value: [45],
		});

		const result = await client.reminder.generate({});
		expect(result.created).toBe(1);
		const reminders = await client.reminder.list({});
		expect(reminders).toHaveLength(1);
		expect(reminders[0]?.dueDate).toBe("2027-05-16");
	});

	test("removes the reminders when `validUntil` is cleared", async () => {
		const id = await seedDocument("Certificate", { validUntil: "2027-06-30" });
		await client.reminder.generate({});

		// `document.update` regenerates the reminders of this document
		// synchronously: they are already gone before `reminder.generate` runs.
		await client.document.update({ id, validUntil: null });
		expect(await client.reminder.list({})).toHaveLength(0);

		const result = await client.reminder.generate({});
		expect(result.removed).toBe(0);
		expect(result.total).toBe(0);
	});

	test("ignores trashed documents", async () => {
		const id = await seedDocument("Old lease", { validUntil: "2027-06-30" });
		await client.reminder.generate({});
		await client.document.trash({ id });

		const result = await client.reminder.generate({});
		expect(result.removed).toBe(3);
		expect(result.total).toBe(0);
	});
});

describe("reminder.generate — missing periods", () => {
	test("one reminder per missing period whose due date has passed", async () => {
		const type = await client.documentType.create(gapTypeInput(0));

		const result = await client.reminder.generate({});
		expect(result.created).toBe(1);

		const reminders = await client.reminder.list({ kind: "period_gap" });
		expect(reminders).toHaveLength(1);
		expect(reminders[0]?.documentTypeId).toBe(type.id);
		expect(reminders[0]?.documentTypeName).toBe("EDF invoice");
		expect(reminders[0]?.period).toBe(previousMonth);
		expect(reminders[0]?.periodKey).toBe(previousMonth.slice(0, 7));
	});

	test("nothing until the grace period has elapsed", async () => {
		const type = await client.documentType.create(gapTypeInput(365));
		expect((await client.reminder.generate({})).created).toBe(0);

		// Bringing the grace period down to zero makes the gap appear...
		await client.documentType.update({
			id: type.id,
			recurrence: { ...gapTypeInput(0).recurrence },
		});
		expect((await client.reminder.generate({})).created).toBe(1);

		// ... and extending it makes the gap disappear.
		await client.documentType.update({
			id: type.id,
			recurrence: { ...gapTypeInput(365).recurrence },
		});
		expect((await client.reminder.generate({})).removed).toBe(1);
	});

	test("the arrival of the document closes the reminder", async () => {
		await client.documentType.create(gapTypeInput(0));
		await client.reminder.generate({});

		const id = await seedDocument("Last month invoice", {
			periodStart: previousMonth,
			categoryId,
		});
		await db
			.insert(documentParty)
			.values({ documentId: id, partyId, role: "issuer" });

		const result = await client.reminder.generate({});
		expect(result.removed).toBe(1);
		expect(result.total).toBe(0);
	});

	test("ignores disabled types", async () => {
		const type = await client.documentType.create(gapTypeInput(0));
		await client.reminder.generate({});

		await client.documentType.update({ id: type.id, enabled: false });
		expect((await client.reminder.generate({})).removed).toBe(1);
	});
});

describe("reminder — statuses", () => {
	test("snooze, dismiss and done survive a recompute", async () => {
		await seedDocument("Vehicle registration", { validUntil: "2027-06-30" });
		await client.reminder.generate({});
		const [first, second, third] = await client.reminder.list({});
		if (!first || !second || !third) throw new Error("missing reminders");

		const future = addDays(todayIso(), 30);
		expect(
			(await client.reminder.snooze({ id: first.id, until: future })).status,
		).toBe("snoozed");
		expect((await client.reminder.dismiss({ id: second.id })).status).toBe(
			"dismissed",
		);
		expect((await client.reminder.done({ id: third.id })).status).toBe("done");

		const result = await client.reminder.generate({});
		expect(result).toMatchObject({ created: 0, removed: 0, total: 3 });
		const statuses = (await client.reminder.list({})).map(
			(item) => item.status,
		);
		expect(statuses.sort()).toEqual(["dismissed", "done", "snoozed"]);
	});

	test("an elapsed snooze goes back to pending on recompute", async () => {
		await seedDocument("Technical inspection", { validUntil: "2027-06-30" });
		await client.reminder.generate({});
		const [first] = await client.reminder.list({});
		if (!first) throw new Error("missing reminder");

		await client.reminder.snooze({
			id: first.id,
			until: addDays(todayIso(), -1),
		});
		const result = await client.reminder.generate({});
		expect(result.updated).toBe(1);

		const reloaded = await client.reminder.list({ status: "pending" });
		expect(reloaded).toHaveLength(3);
		expect(reloaded.every((item) => item.snoozedUntil === null)).toBe(true);
	});

	test("404 on an unknown reminder", async () => {
		await expectOrpcError(
			client.reminder.dismiss({ id: "rem_absent" }),
			"NOT_FOUND",
		);
	});
});

describe("document.update — synchronous expiry reminders", () => {
	test("setting `validUntil` immediately creates its reminders, all upcoming", async () => {
		const id = await seedDocument("Passport", {});
		const validUntil = addDays(todayIso(), 120);

		await client.document.update({ id, validUntil });

		// No `reminder.generate` call: `document.update` regenerated them itself.
		const reminders = await client.reminder.list({});
		expect(reminders).toHaveLength(3);
		expect(reminders.every((item) => item.status === "pending")).toBe(true);
		expect(reminders.every((item) => item.kind === "expiry")).toBe(true);
		// None due yet: D-90 is still 30 days out.
		expect(await client.reminder.list({ upcoming: false })).toHaveLength(0);
	});

	test("moving `validUntil` regenerates the reminders at the new due dates", async () => {
		const id = await seedDocument("Passport", {});
		await client.document.update({
			id,
			validUntil: addDays(todayIso(), 120),
		});
		const before = (await client.reminder.list({})).map((item) => item.id);

		const moved = addDays(todayIso(), 200);
		await client.document.update({ id, validUntil: moved });

		const after = await client.reminder.list({});
		expect(after).toHaveLength(3);
		expect(after.map((item) => item.id).sort()).not.toEqual(before.sort());
		expect(after.map((item) => item.dueDate)).toContain(addDays(moved, -7));
	});
});

describe("reminder.list / count", () => {
	test("filters by status, kind and due date", async () => {
		await seedDocument("Lease", { validUntil: "2027-06-30" });
		await client.documentType.create(gapTypeInput(0));
		await client.reminder.generate({});

		expect(await client.reminder.list({})).toHaveLength(4);
		expect(await client.reminder.list({ kind: "expiry" })).toHaveLength(3);
		expect(await client.reminder.list({ kind: "period_gap" })).toHaveLength(1);
		expect(
			await client.reminder.list({ dueBefore: "2027-04-01" }),
		).toHaveLength(2);
		expect(await client.reminder.list({ status: "dismissed" })).toHaveLength(0);
	});

	test("`upcoming` defaults to true (future reminders included) and can be turned off", async () => {
		// D-90/D-30/D-7 of a document expiring in 120 days: all three are still
		// in the future, none due yet.
		await seedDocument("Lease", { validUntil: addDays(todayIso(), 120) });
		await client.reminder.generate({});

		expect(await client.reminder.list({ status: "pending" })).toHaveLength(3);
		expect(
			await client.reminder.list({ status: "pending", upcoming: true }),
		).toHaveLength(3);
		expect(
			await client.reminder.list({ status: "pending", upcoming: false }),
		).toHaveLength(0);
	});

	test("count keeps only pending reminders due within 30 days", async () => {
		// D-90 falls in 10 days, D-30 and D-7 much later.
		await seedDocument("Roadworthiness test", {
			validUntil: addDays(todayIso(), 100),
		});
		await client.reminder.generate({});
		expect(await client.reminder.count({})).toEqual({ count: 1 });

		const [soon] = await client.reminder.list({});
		if (!soon) throw new Error("missing reminder");
		await client.reminder.done({ id: soon.id });
		expect(await client.reminder.count({})).toEqual({ count: 0 });
	});
});
