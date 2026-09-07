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

async function seedDocument(title: string) {
	const rows = await db
		.insert(document)
		.values({ title, status: "active", createdById: owner.id })
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

describe("tag.create", () => {
	test("creates a tag with a color", async () => {
		const created = await client.tag.create({
			name: "Payroll",
			color: "#22c55e",
		});
		expect(created.id).toStartWith("tag_");
		expect(created.color).toBe("#22c55e");
	});

	test("the name is unique case-insensitively", async () => {
		await client.tag.create({ name: "Payroll" });
		await expectOrpcError(client.tag.create({ name: "payroll" }), "CONFLICT");
		await expectOrpcError(client.tag.create({ name: "PAYROLL" }), "CONFLICT");
	});
});

describe("tag.list", () => {
	test("counts non-deleted documents and filters by query", async () => {
		const payroll = await client.tag.create({ name: "Payroll" });
		const taxes = await client.tag.create({ name: "Taxes" });

		const first = await seedDocument("January payslip");
		const second = await seedDocument("February payslip");
		const trashed = await seedDocument("Obsolete payslip");

		await client.document.setTags({ id: first, tagIds: [payroll.id] });
		await client.document.setTags({
			id: second,
			tagIds: [payroll.id, taxes.id],
		});
		await client.document.setTags({ id: trashed, tagIds: [payroll.id] });
		await client.document.trash({ id: trashed });

		const all = await client.tag.list({});
		expect(all).toHaveLength(2);
		expect(all.find((tag) => tag.id === payroll.id)?.documentCount).toBe(2);
		expect(all.find((tag) => tag.id === taxes.id)?.documentCount).toBe(1);

		const filtered = await client.tag.list({ query: "pay" });
		expect(filtered.map((tag) => tag.id)).toEqual([payroll.id]);
	});
});

describe("tag.update / delete", () => {
	test("renames a tag but rejects a case-insensitive duplicate", async () => {
		const payroll = await client.tag.create({ name: "Payroll" });
		await client.tag.create({ name: "Taxes" });

		const renamed = await client.tag.update({ id: payroll.id, name: "Salary" });
		expect(renamed.name).toBe("Salary");

		await expectOrpcError(
			client.tag.update({ id: payroll.id, name: "taxes" }),
			"CONFLICT",
		);
	});

	test("deleting a tag detaches the documents", async () => {
		const payroll = await client.tag.create({ name: "Payroll" });
		const documentId = await seedDocument("Payslip");
		await client.document.setTags({ id: documentId, tagIds: [payroll.id] });

		await client.tag.delete({ id: payroll.id });

		const detail = await client.document.get({ id: documentId });
		expect(detail.tags).toHaveLength(0);
		expect(await client.tag.list({})).toHaveLength(0);
	});
});

describe("tag.merge", () => {
	test("transfers the documents and deletes the source tag", async () => {
		const source = await client.tag.create({ name: "tax" });
		const target = await client.tag.create({ name: "Taxes" });

		const onlySource = await seedDocument("Tax notice");
		const both = await seedDocument("Tax return");
		const onlyTarget = await seedDocument("Property tax");

		await client.document.setTags({ id: onlySource, tagIds: [source.id] });
		await client.document.setTags({
			id: both,
			tagIds: [source.id, target.id],
		});
		await client.document.setTags({ id: onlyTarget, tagIds: [target.id] });

		const merged = await client.tag.merge({
			sourceId: source.id,
			targetId: target.id,
		});
		expect(merged.target.id).toBe(target.id);
		// Only `onlySource` had to be attached, `both` already was.
		expect(merged.movedDocuments).toBe(1);

		const tags = await client.tag.list({});
		expect(tags).toHaveLength(1);
		expect(tags[0]?.documentCount).toBe(3);

		const detail = await client.document.get({ id: onlySource });
		expect(detail.tags.map((tag) => tag.id)).toEqual([target.id]);
	});

	test("rejects merging a tag into itself", async () => {
		const tag = await client.tag.create({ name: "Payroll" });
		await expectOrpcError(
			client.tag.merge({ sourceId: tag.id, targetId: tag.id }),
			"BAD_REQUEST",
		);
	});

	test("rejects an unknown tag", async () => {
		const tag = await client.tag.create({ name: "Payroll" });
		await expectOrpcError(
			client.tag.merge({ sourceId: "tag_x", targetId: tag.id }),
			"NOT_FOUND",
		);
	});
});

describe("document — tags", () => {
	test("adds, replaces and removes tags", async () => {
		const payroll = await client.tag.create({ name: "Payroll" });
		const taxes = await client.tag.create({ name: "Taxes" });
		const documentId = await seedDocument("Payslip");

		const added = await client.document.addTag({
			id: documentId,
			tagId: payroll.id,
		});
		expect(added.tags.map((tag) => tag.id)).toEqual([payroll.id]);

		// Idempotent: an already present tag does not raise an error.
		const again = await client.document.addTag({
			id: documentId,
			tagId: payroll.id,
		});
		expect(again.tags).toHaveLength(1);

		const replaced = await client.document.setTags({
			id: documentId,
			tagIds: [taxes.id],
		});
		expect(replaced.tags.map((tag) => tag.id)).toEqual([taxes.id]);

		const removed = await client.document.removeTag({
			id: documentId,
			tagId: taxes.id,
		});
		expect(removed.tags).toHaveLength(0);

		await expectOrpcError(
			client.document.removeTag({ id: documentId, tagId: taxes.id }),
			"NOT_FOUND",
		);
	});

	test("rejects a nonexistent tag", async () => {
		const documentId = await seedDocument("Payslip");
		await expectOrpcError(
			client.document.setTags({ id: documentId, tagIds: ["tag_x"] }),
			"NOT_FOUND",
		);
	});
});
