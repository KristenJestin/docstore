import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createId } from "@docstore/db/id";
import { document, documentFile } from "@docstore/db/schema/document";
import { party } from "@docstore/db/schema/party";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { addDays, todayIso } from "@docstore/shared/recurrence";
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

async function seedDocument(
	title: string,
	overrides: Partial<typeof document.$inferInsert> = {},
): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title,
			status: "active",
			createdById: owner.id,
			...overrides,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

async function seedFile(documentId: string, size: number): Promise<string> {
	const sha = createId("sha");
	const rows = await db
		.insert(documentFile)
		.values({
			documentId,
			kind: "original",
			filename: `${sha}.pdf`,
			mime: "application/pdf",
			size,
			sha256: sha,
			storageKey: `documents/${sha}.pdf`,
		})
		.returning({ id: documentFile.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("file not inserted");
	return id;
}

describe("document.addRelation", () => {
	test("links two documents and exposes them both ways", async () => {
		const contract = await seedDocument("Insurance contract");
		const invoice = await seedDocument("Insurance invoice");

		const relation = await client.document.addRelation({
			fromDocumentId: invoice,
			toDocumentId: contract,
			kind: "fulfills",
		});
		expect(relation.id).toStartWith("drl_");

		const fromInvoice = await client.document.get({ id: invoice });
		expect(fromInvoice.relations).toHaveLength(1);
		expect(fromInvoice.relations[0]?.direction).toBe("outgoing");
		expect(fromInvoice.relations[0]?.document.id).toBe(contract);

		const fromContract = await client.document.get({ id: contract });
		expect(fromContract.relations[0]?.direction).toBe("incoming");
		expect(fromContract.relations[0]?.document.title).toBe("Insurance invoice");
	});

	test("the (from, to, kind) triplet is unique", async () => {
		const first = await seedDocument("A");
		const second = await seedDocument("B");
		const input = {
			fromDocumentId: first,
			toDocumentId: second,
			kind: "related_to" as const,
		};

		await client.document.addRelation(input);
		await expectOrpcError(client.document.addRelation(input), "CONFLICT");

		// Another kind between the same two documents stays possible.
		await client.document.addRelation({ ...input, kind: "supersedes" });
	});

	test("rejects a relation from a document to itself", async () => {
		const id = await seedDocument("Lonely");
		await expectOrpcError(
			client.document.addRelation({
				fromDocumentId: id,
				toDocumentId: id,
				kind: "related_to",
			}),
			"BAD_REQUEST",
		);
	});

	test("404 on an unknown document", async () => {
		const id = await seedDocument("Exists");
		await expectOrpcError(
			client.document.addRelation({
				fromDocumentId: id,
				toDocumentId: "doc_absent",
				kind: "related_to",
			}),
			"NOT_FOUND",
		);
	});
});

describe("document.removeRelation", () => {
	test("deletes the relation then returns 404", async () => {
		const first = await seedDocument("A");
		const second = await seedDocument("B");
		const relation = await client.document.addRelation({
			fromDocumentId: first,
			toDocumentId: second,
			kind: "page_of",
		});

		await client.document.removeRelation({ id: relation.id });
		const detail = await client.document.get({ id: first });
		expect(detail.relations).toHaveLength(0);

		await expectOrpcError(
			client.document.removeRelation({ id: relation.id }),
			"NOT_FOUND",
		);
	});
});

describe("document.mergeAsVersion", () => {
	test("moves the files, creates version_of and trashes the duplicate", async () => {
		const duplicate = await seedDocument("Invoice (copy)");
		const kept = await seedDocument("Invoice");
		const fileId = await seedFile(duplicate, 2048);

		const result = await client.document.mergeAsVersion({
			documentId: duplicate,
			intoDocumentId: kept,
		});

		expect(result.movedFiles).toBe(1);
		expect(result.trashedId).toBe(duplicate);
		expect(result.target.id).toBe(kept);
		expect(result.target.files).toHaveLength(1);
		expect(result.target.files[0]?.id).toBe(fileId);
		// The file becomes an attachment: the sha256 uniqueness of originals is
		// released this way.
		expect(result.target.files[0]?.kind).toBe("attachment");

		// The `version_of` relation exists, but the absorbed document is in the
		// trash: it no longer shows up in the relations of the kept one.
		expect(result.target.relations).toHaveLength(0);

		const trashed = await client.document.get({ id: duplicate });
		expect(trashed.deletedAt).not.toBeNull();
		expect(trashed.files).toHaveLength(0);

		// Restoring it brings the relation back into view, both ways.
		await client.document.restore({ id: duplicate });
		const restored = await client.document.get({ id: kept });
		expect(restored.relations).toHaveLength(1);
		expect(restored.relations[0]?.kind).toBe("version_of");
		expect(restored.relations[0]?.direction).toBe("incoming");
	});

	test("rejects merging a document into itself", async () => {
		const id = await seedDocument("Unique");
		await expectOrpcError(
			client.document.mergeAsVersion({ documentId: id, intoDocumentId: id }),
			"BAD_REQUEST",
		);
	});
});

describe("document.list — relation and validity filters", () => {
	test("hasRelation isolates linked documents", async () => {
		const first = await seedDocument("Linked A");
		const second = await seedDocument("Linked B");
		await seedDocument("Isolated");
		await client.document.addRelation({
			fromDocumentId: first,
			toDocumentId: second,
			kind: "related_to",
		});

		const linked = await client.document.list({ hasRelation: true });
		expect(linked.items.map((item) => item.id).sort()).toEqual(
			[first, second].sort(),
		);

		const alone = await client.document.list({ hasRelation: false });
		expect(alone.items).toHaveLength(1);
		expect(alone.items[0]?.title).toBe("Isolated");
	});

	test("validUntilFrom/To and the validUntil:asc sort", async () => {
		await seedDocument("Expires early", { validUntil: "2026-02-01" });
		await seedDocument("Expires late", { validUntil: "2026-11-01" });
		await seedDocument("No expiry");

		const window = await client.document.list({
			validUntilFrom: "2026-01-01",
			validUntilTo: "2026-06-30",
		});
		expect(window.items).toHaveLength(1);
		expect(window.items[0]?.title).toBe("Expires early");

		const sorted = await client.document.list({ sort: "validUntil:asc" });
		expect(sorted.items.map((item) => item.title)).toEqual([
			"Expires early",
			"Expires late",
			"No expiry",
		]);
	});
});

describe("document.stats", () => {
	test("aggregates storage, upcoming due dates and entities", async () => {
		const first = await seedDocument("With files");
		await seedFile(first, 1000);
		await seedFile(first, 2400);

		await seedDocument("Expiring soon", {
			validUntil: addDays(todayIso(), 10),
		});
		await seedDocument("Expires later", {
			validUntil: addDays(todayIso(), 200),
		});

		await db.insert(party).values([
			{ type: "company", name: "EDF" },
			{ type: "company", name: "Former supplier", archivedAt: new Date() },
		]);

		const stats = await client.document.stats({});
		expect(stats.total).toBe(3);
		expect(stats.storage).toEqual({ bytes: 3400, files: 2 });
		expect(stats.expiringSoon).toBe(1);
		expect(stats.parties).toBe(1);
	});

	test("storage also counts trashed documents", async () => {
		const id = await seedDocument("To discard");
		await seedFile(id, 512);
		await client.document.trash({ id });

		const stats = await client.document.stats({});
		expect(stats.total).toBe(0);
		expect(stats.storage.bytes).toBe(512);

		const remaining = await db
			.select({ id: documentFile.id })
			.from(documentFile)
			.where(eq(documentFile.documentId, id));
		expect(remaining).toHaveLength(1);
	});
});
