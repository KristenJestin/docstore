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

async function seedDocument(categoryId: string | null, title = "Doc") {
	const rows = await db
		.insert(document)
		.values({
			title,
			status: "active",
			categoryId,
			createdById: owner.id,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

describe("category.create / list", () => {
	test("generates a slug from the name and de-duplicates it among siblings", async () => {
		const first = await client.category.create({ name: "Invoice" });
		expect(first.id).toStartWith("cat_");
		expect(first.slug).toBe("invoice");

		const second = await client.category.create({ name: "Invoice" });
		expect(second.slug).toBe("invoice-2");

		// The same slug is allowed under a different parent.
		const child = await client.category.create({
			parentId: first.id,
			name: "Invoice",
		});
		expect(child.slug).toBe("invoice");
	});

	test("accents and special characters are normalized", async () => {
		const created = await client.category.create({ name: "Café & Résumé" });
		expect(created.slug).toBe("cafe-resume");
	});

	test("returns a sorted tree with cumulative descendant counters", async () => {
		const invoice = await client.category.create({
			name: "Invoice",
			icon: "receipt",
			color: "#f97316",
		});
		const subscription = await client.category.create({
			parentId: invoice.id,
			name: "Subscription",
		});
		const internet = await client.category.create({
			parentId: subscription.id,
			name: "Internet",
		});
		await client.category.create({ name: "Contract" });

		await seedDocument(invoice.id, "Direct invoice");
		await seedDocument(subscription.id, "Subscription 1");
		await seedDocument(internet.id, "Internet 1");
		await seedDocument(internet.id, "Internet 2");
		await seedDocument(null, "Uncategorized");

		const tree = await client.category.list({});
		expect(tree).toHaveLength(2);

		const invoiceNode = tree.find((node) => node.id === invoice.id);
		expect(invoiceNode?.depth).toBe(1);
		expect(invoiceNode?.icon).toBe("receipt");
		expect(invoiceNode?.ownDocumentCount).toBe(1);
		expect(invoiceNode?.documentCount).toBe(4);

		const subscriptionNode = invoiceNode?.children[0];
		expect(subscriptionNode?.id).toBe(subscription.id);
		expect(subscriptionNode?.depth).toBe(2);
		expect(subscriptionNode?.documentCount).toBe(3);
		expect(subscriptionNode?.children[0]?.documentCount).toBe(2);
		expect(subscriptionNode?.children[0]?.depth).toBe(3);
	});

	test("rejects a fourth level", async () => {
		const l1 = await client.category.create({ name: "N1" });
		const l2 = await client.category.create({ parentId: l1.id, name: "N2" });
		const l3 = await client.category.create({ parentId: l2.id, name: "N3" });

		await expectOrpcError(
			client.category.create({ parentId: l3.id, name: "N4" }),
			"BAD_REQUEST",
		);
	});

	test("rejects an unknown parent", async () => {
		await expectOrpcError(
			client.category.create({ parentId: "cat_unknown", name: "X" }),
			"NOT_FOUND",
		);
	});
});

describe("category.update", () => {
	test("renames without breaking the slug, and accepts an explicit slug", async () => {
		const created = await client.category.create({ name: "Invoice" });
		const renamed = await client.category.update({
			id: created.id,
			name: "Supplier invoices",
			color: "#123abc",
		});
		expect(renamed.name).toBe("Supplier invoices");
		expect(renamed.slug).toBe("invoice");
		expect(renamed.color).toBe("#123abc");

		const reslugged = await client.category.update({
			id: created.id,
			slug: "invoices",
		});
		expect(reslugged.slug).toBe("invoices");
	});

	test("rejects a non-hexadecimal color", async () => {
		const created = await client.category.create({ name: "Invoice" });
		await expectOrpcError(
			client.category.update({ id: created.id, color: "red" }),
			"BAD_REQUEST",
		);
	});
});

describe("category.move", () => {
	test("moves a category and updates the order", async () => {
		const contract = await client.category.create({ name: "Contract" });
		const work = await client.category.create({ name: "Work" });

		const moved = await client.category.move({
			id: work.id,
			parentId: contract.id,
			sortOrder: 3,
		});
		expect(moved.parentId).toBe(contract.id);
		expect(moved.sortOrder).toBe(3);

		const backToRoot = await client.category.move({
			id: work.id,
			parentId: null,
			sortOrder: 0,
		});
		expect(backToRoot.parentId).toBeNull();
	});

	test("rejects a cycle (under itself or under a descendant)", async () => {
		const parent = await client.category.create({ name: "Parent" });
		const child = await client.category.create({
			parentId: parent.id,
			name: "Child",
		});

		await expectOrpcError(
			client.category.move({
				id: parent.id,
				parentId: parent.id,
				sortOrder: 0,
			}),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			client.category.move({
				id: parent.id,
				parentId: child.id,
				sortOrder: 0,
			}),
			"BAD_REQUEST",
		);
	});

	test("rejects a move that would exceed three levels", async () => {
		const a = await client.category.create({ name: "A" });
		const b = await client.category.create({ parentId: a.id, name: "B" });
		const c = await client.category.create({ name: "C" });
		await client.category.create({ parentId: c.id, name: "D" });

		// C (height 2) under B (depth 2) would give a 4th level.
		await expectOrpcError(
			client.category.move({ id: c.id, parentId: b.id, sortOrder: 0 }),
			"BAD_REQUEST",
		);
	});
});

describe("category.reorder", () => {
	test("renumbers a sibling group without touching the parents", async () => {
		const first = await client.category.create({ name: "Alpha" });
		const second = await client.category.create({ name: "Beta" });
		const third = await client.category.create({ name: "Gamma" });

		const tree = await client.category.reorder({
			parentId: null,
			ids: [third.id, first.id, second.id],
		});
		expect(tree.map((node) => node.name)).toEqual(["Gamma", "Alpha", "Beta"]);
		expect(tree.map((node) => node.sortOrder)).toEqual([0, 1, 2]);
		expect(tree.every((node) => node.parentId === null)).toBe(true);
	});

	test("reorders children of a parent, siblings left out go last", async () => {
		const parent = await client.category.create({ name: "Parent" });
		const a = await client.category.create({
			parentId: parent.id,
			name: "Child A",
		});
		const b = await client.category.create({
			parentId: parent.id,
			name: "Child B",
		});
		const c = await client.category.create({
			parentId: parent.id,
			name: "Child C",
		});

		const tree = await client.category.reorder({
			parentId: parent.id,
			ids: [c.id, b.id],
		});
		const children = tree[0]?.children ?? [];
		expect(children.map((node) => node.id)).toEqual([c.id, b.id, a.id]);
		expect(children.map((node) => node.sortOrder)).toEqual([0, 1, 2]);
	});

	test("refuses an id that does not belong to the target parent", async () => {
		const parent = await client.category.create({ name: "Parent" });
		const root = await client.category.create({ name: "Root" });

		await expectOrpcError(
			client.category.reorder({ parentId: parent.id, ids: [root.id] }),
			"BAD_REQUEST",
		);
	});

	test("refuses an unknown id", async () => {
		await expectOrpcError(
			client.category.reorder({ parentId: null, ids: ["cat_nope"] }),
			"NOT_FOUND",
		);
	});
});

describe("category.delete", () => {
	test("reassigns the documents and moves the children up", async () => {
		const invoice = await client.category.create({ name: "Invoice" });
		const subscription = await client.category.create({
			parentId: invoice.id,
			name: "Subscription",
		});
		const internet = await client.category.create({
			parentId: subscription.id,
			name: "Internet",
		});
		const archive = await client.category.create({ name: "Archive" });

		const documentId = await seedDocument(
			subscription.id,
			"Fiber subscription",
		);

		const removed = await client.category.delete({
			id: subscription.id,
			reassignTo: archive.id,
		});
		expect(removed.deleted).toBe(true);
		expect(removed.reassignedDocuments).toBe(1);

		const detail = await client.document.get({ id: documentId });
		expect(detail.categoryId).toBe(archive.id);
		expect(detail.category?.name).toBe("Archive");

		const tree = await client.category.list({});
		const invoiceNode = tree.find((node) => node.id === invoice.id);
		expect(invoiceNode?.children.map((node) => node.id)).toEqual([internet.id]);
		expect(invoiceNode?.children[0]?.depth).toBe(2);
	});

	test("without reassignment the documents lose their category", async () => {
		const category = await client.category.create({ name: "Temporary" });
		const documentId = await seedDocument(category.id);

		await client.category.delete({ id: category.id });

		const detail = await client.document.get({ id: documentId });
		expect(detail.categoryId).toBeNull();
		expect(detail.category).toBeNull();
	});

	test("rejects an unknown fallback category", async () => {
		const category = await client.category.create({ name: "Temporary" });
		await expectOrpcError(
			client.category.delete({ id: category.id, reassignTo: "cat_x" }),
			"NOT_FOUND",
		);
	});
});
