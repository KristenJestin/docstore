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

describe("appRouter — authentication", () => {
	test("rejects protected procedures without a session", async () => {
		const anonymous = createTestClient(db, null);

		await expectOrpcError(anonymous.party.list({}), "UNAUTHORIZED");
		await expectOrpcError(anonymous.document.list({}), "UNAUTHORIZED");
		await expectOrpcError(anonymous.document.stats({}), "UNAUTHORIZED");

		expect(await anonymous.healthCheck()).toBe("OK");
	});
});

describe("appRouter — party", () => {
	test("creates, lists, updates and archives through the oRPC client", async () => {
		const created = await client.party.create({
			type: "company",
			name: "Orange",
			identifiers: { domain: ["orange.fr"] },
		});
		expect(created.id).toStartWith("prt_");
		expect(created.aliases).toEqual([]);

		const list = await client.party.list({ query: "orange" });
		expect(list.total).toBe(1);
		expect(list.page).toBe(1);
		expect(list.pageSize).toBe(25);

		const detail = await client.party.get({ id: created.id });
		expect(detail.documentCount).toBe(0);

		const updated = await client.party.update({
			id: created.id,
			notes: "Telecom operator",
		});
		expect(updated.notes).toBe("Telecom operator");

		const byIdentifier = await client.party.findByIdentifier({
			kind: "domain",
			value: "orange.fr",
		});
		expect(byIdentifier).toHaveLength(1);

		await client.party.archive({ id: created.id });
		expect((await client.party.list({})).total).toBe(0);
		await client.party.unarchive({ id: created.id });
		expect((await client.party.list({})).total).toBe(1);

		const removed = await client.party.delete({ id: created.id });
		expect(removed.deleted).toBe(true);
	});

	test("handles relations between Parties", async () => {
		const employer = await client.party.create({
			type: "company",
			name: "Nordwind Digital",
		});
		const person = await client.party.create({
			type: "person",
			name: "Camille Moreau",
			isHouseholdMember: true,
		});

		const relation = await client.party.addRelation({
			fromPartyId: person.id,
			toPartyId: employer.id,
			kind: "works_at",
		});
		const detail = await client.party.get({ id: person.id });
		expect(detail.relationsFrom[0]?.otherParty.name).toBe("Nordwind Digital");

		const removed = await client.party.removeRelation({ id: relation.id });
		expect(removed.deleted).toBe(true);
	});
});

describe("appRouter — document", () => {
	async function seedDocument(title: string, content: string) {
		const rows = await db
			.insert(document)
			.values({
				title,
				content,
				status: "active",
				documentDate: "2025-01-10",
				datePrecision: "day",
				createdById: owner.id,
			})
			.returning({ id: document.id });
		const id = rows[0]?.id;
		if (!id) throw new Error("document not inserted");
		return id;
	}

	test("lists, searches, updates and handles the trash", async () => {
		const id = await seedDocument(
			"Internet invoice",
			"Internet subscription invoice for January.",
		);

		const found = await client.document.list({ query: "subscription" });
		expect(found.items.map((item) => item.id)).toEqual([id]);

		const missed = await client.document.list({ query: "insurance" });
		expect(missed.total).toBe(0);

		const updated = await client.document.update({
			id,
			title: "Orange invoice January 2025",
		});
		expect(updated.title).toBe("Orange invoice January 2025");

		await expectOrpcError(
			client.document.update({
				id,
				documentDate: "2025-02-01",
				datePrecision: null,
			}),
			"BAD_REQUEST",
		);

		await client.document.trash({ id });
		expect((await client.document.list({})).total).toBe(0);
		await client.document.restore({ id });
		expect((await client.document.list({})).total).toBe(1);

		const stats = await client.document.stats({});
		expect(stats.total).toBe(1);
		expect(stats.byStatus.active).toBe(1);

		const removed = await client.document.deletePermanently({ id });
		expect(removed.deleted).toBe(true);
	});

	test("links and unlinks Parties", async () => {
		const id = await seedDocument("Contract", "Supply contract.");
		const edf = await client.party.create({ type: "company", name: "EDF" });

		const linked = await client.document.setParties({
			id,
			parties: [{ partyId: edf.id, role: "issuer" }],
		});
		expect(linked.parties[0]?.name).toBe("EDF");

		const added = await client.document.addParty({
			id,
			partyId: edf.id,
			role: "recipient",
		});
		expect(added.parties).toHaveLength(2);

		const removed = await client.document.removeParty({
			id,
			partyId: edf.id,
			role: "recipient",
		});
		expect(removed.parties).toHaveLength(1);

		const detail = await client.document.get({ id });
		expect(detail.parties).toHaveLength(1);
		expect(detail.content).toBe("Supply contract.");
	});

	test("NOT_FOUND on an unknown document", async () => {
		await expectOrpcError(client.document.get({ id: "doc_x" }), "NOT_FOUND");
	});
});

describe("appRouter — document: taxonomy filters", () => {
	async function insertDocument(values: {
		title: string;
		categoryId?: string | null;
		documentDate?: string | null;
	}) {
		const rows = await db
			.insert(document)
			.values({
				title: values.title,
				status: "active",
				categoryId: values.categoryId ?? null,
				documentDate: values.documentDate ?? null,
				datePrecision: values.documentDate ? "day" : null,
				createdById: owner.id,
			})
			.returning({ id: document.id });
		const id = rows[0]?.id;
		if (!id) throw new Error("document not inserted");
		return id;
	}

	test("filters by category including the descendants", async () => {
		const invoice = await client.category.create({ name: "Invoice" });
		const subscription = await client.category.create({
			parentId: invoice.id,
			name: "Subscription",
		});
		const contract = await client.category.create({ name: "Contract" });

		const direct = await insertDocument({
			title: "Direct invoice",
			categoryId: invoice.id,
		});
		const descendant = await insertDocument({
			title: "Fiber subscription",
			categoryId: subscription.id,
		});
		await insertDocument({ title: "Lease", categoryId: contract.id });

		const found = await client.document.list({ categoryId: invoice.id });
		expect(found.total).toBe(2);
		expect(found.items.map((item) => item.id).sort()).toEqual(
			[direct, descendant].sort(),
		);
		expect(
			found.items.find((item) => item.id === descendant)?.category?.name,
		).toBe("Subscription");

		const leaf = await client.document.list({ categoryId: subscription.id });
		expect(leaf.items.map((item) => item.id)).toEqual([descendant]);

		await expectOrpcError(
			client.document.list({ categoryId: "cat_x" }),
			"NOT_FOUND",
		);
	});

	test("filters by tags: every requested tag is required", async () => {
		const payroll = await client.tag.create({ name: "Payroll" });
		const taxes = await client.tag.create({ name: "Taxes" });

		const both = await insertDocument({ title: "Payslip + taxes" });
		const onlyPayroll = await insertDocument({ title: "Payslip only" });

		await client.document.setTags({ id: both, tagIds: [payroll.id, taxes.id] });
		await client.document.setTags({ id: onlyPayroll, tagIds: [payroll.id] });

		const onePayroll = await client.document.list({ tagIds: [payroll.id] });
		expect(onePayroll.total).toBe(2);

		const intersection = await client.document.list({
			tagIds: [payroll.id, taxes.id],
		});
		expect(intersection.items.map((item) => item.id)).toEqual([both]);
		expect(intersection.items[0]?.tags).toHaveLength(2);
	});

	test("filters by custom field value", async () => {
		const montant = await client.customField.create({
			name: "Total amount",
			type: "money",
		});
		const reference = await client.customField.create({
			name: "Invoice number",
			type: "text",
		});

		const small = await insertDocument({ title: "Small invoice" });
		const big = await insertDocument({ title: "Large invoice" });

		await client.document.setFieldValue({
			id: small,
			fieldId: montant.id,
			value: { kind: "money", amount: 19.99, currency: "EUR" },
		});
		await client.document.setFieldValue({
			id: big,
			fieldId: montant.id,
			value: { kind: "money", amount: 250.4, currency: "EUR" },
		});
		await client.document.setFieldValue({
			id: big,
			fieldId: reference.id,
			value: { kind: "text", text: "FA-2025-0042" },
		});

		const expensive = await client.document.list({
			fieldFilters: [{ fieldId: montant.id, op: "gt", value: 100 }],
		});
		expect(expensive.items.map((item) => item.id)).toEqual([big]);

		const cheap = await client.document.list({
			fieldFilters: [{ fieldId: montant.id, op: "lt", value: 100 }],
		});
		expect(cheap.items.map((item) => item.id)).toEqual([small]);

		const exact = await client.document.list({
			fieldFilters: [{ fieldId: montant.id, op: "eq", value: 19.99 }],
		});
		expect(exact.items.map((item) => item.id)).toEqual([small]);

		const byReference = await client.document.list({
			fieldFilters: [{ fieldId: reference.id, op: "contains", value: "2025" }],
		});
		expect(byReference.items.map((item) => item.id)).toEqual([big]);

		// Two filters combined.
		const combined = await client.document.list({
			fieldFilters: [
				{ fieldId: montant.id, op: "gt", value: 100 },
				{ fieldId: reference.id, op: "eq", value: "FA-2025-0042" },
			],
		});
		expect(combined.items.map((item) => item.id)).toEqual([big]);

		await expectOrpcError(
			client.document.list({
				fieldFilters: [{ fieldId: montant.id, op: "contains", value: "12" }],
			}),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			client.document.list({
				fieldFilters: [{ fieldId: "cf_x", op: "eq", value: 1 }],
			}),
			"NOT_FOUND",
		);
	});

	test("sorts by title, document date and creation date", async () => {
		const b = await insertDocument({
			title: "Bravo",
			documentDate: "2025-02-01",
		});
		const a = await insertDocument({
			title: "Alpha",
			documentDate: "2025-03-01",
		});

		const byTitle = await client.document.list({ sort: "title:asc" });
		expect(byTitle.items.map((item) => item.id)).toEqual([a, b]);

		const byDateAsc = await client.document.list({ sort: "documentDate:asc" });
		expect(byDateAsc.items.map((item) => item.id)).toEqual([b, a]);

		const byDateDesc = await client.document.list({
			sort: "documentDate:desc",
		});
		expect(byDateDesc.items.map((item) => item.id)).toEqual([a, b]);

		const byCreatedDesc = await client.document.list({
			sort: "createdAt:desc",
		});
		expect(byCreatedDesc.items.map((item) => item.id)).toEqual([a, b]);
	});
});

describe("appRouter — document.bulk", () => {
	async function insertDocuments(count: number) {
		const rows = await db
			.insert(document)
			.values(
				Array.from({ length: count }, (_, index) => ({
					title: `Document ${index + 1}`,
					status: "active" as const,
					createdById: owner.id,
				})),
			)
			.returning({ id: document.id });
		return rows.map((row) => row.id);
	}

	test("applies category, tags, sensitivity, trash and Party", async () => {
		const ids = await insertDocuments(3);
		const category = await client.category.create({ name: "Invoice" });
		const payroll = await client.tag.create({ name: "Payroll" });
		const taxes = await client.tag.create({ name: "Taxes" });
		const edf = await client.party.create({ type: "company", name: "EDF" });

		expect(
			await client.document.bulk({
				ids,
				action: { type: "setCategory", categoryId: category.id },
			}),
		).toEqual({ updated: 3 });

		expect(
			await client.document.bulk({
				ids,
				action: { type: "addTags", tagIds: [payroll.id, taxes.id] },
			}),
		).toEqual({ updated: 3 });

		// Second pass: nothing new to insert.
		expect(
			await client.document.bulk({
				ids,
				action: { type: "addTags", tagIds: [payroll.id] },
			}),
		).toEqual({ updated: 0 });

		expect(
			await client.document.bulk({
				ids,
				action: { type: "removeTags", tagIds: [taxes.id] },
			}),
		).toEqual({ updated: 3 });

		expect(
			await client.document.bulk({
				ids,
				action: { type: "addParty", partyId: edf.id, role: "issuer" },
			}),
		).toEqual({ updated: 3 });

		expect(
			await client.document.bulk({
				ids,
				action: { type: "setSensitive", sensitive: true },
			}),
		).toEqual({ updated: 3 });

		const first = ids[0];
		if (!first) throw new Error("no document");
		const detail = await client.document.get({ id: first });
		expect(detail.category?.id).toBe(category.id);
		expect(detail.tags.map((tag) => tag.id)).toEqual([payroll.id]);
		expect(detail.sensitive).toBe(true);
		expect(detail.parties.map((party) => party.id)).toEqual([edf.id]);

		expect(
			await client.document.bulk({ ids, action: { type: "trash" } }),
		).toEqual({ updated: 3 });
		// Already in the trash: nothing left to do.
		expect(
			await client.document.bulk({ ids, action: { type: "trash" } }),
		).toEqual({ updated: 0 });
		expect(
			await client.document.bulk({ ids, action: { type: "restore" } }),
		).toEqual({ updated: 3 });
	});

	test("rejects an unknown document and rolls everything back", async () => {
		const ids = await insertDocuments(1);
		await expectOrpcError(
			client.document.bulk({
				ids: [...ids, "doc_x"],
				action: { type: "setSensitive", sensitive: true },
			}),
			"NOT_FOUND",
		);

		const first = ids[0];
		if (!first) throw new Error("no document");
		expect((await client.document.get({ id: first })).sensitive).toBe(false);
	});
});

describe("appRouter — document.duplicates", () => {
	test("detects the same normalized title and date", async () => {
		const rows = await db
			.insert(document)
			.values([
				{
					title: "EDF invoice",
					documentDate: "2025-01-10",
					datePrecision: "day" as const,
					status: "active" as const,
					createdById: owner.id,
				},
			])
			.returning({ id: document.id });
		const original = rows[0]?.id;
		if (!original) throw new Error("document not inserted");

		const copyRows = await db
			.insert(document)
			.values({
				// Multiple spaces and different case: the title is normalized.
				title: "  edf   INVOICE ",
				documentDate: "2025-01-10",
				datePrecision: "day",
				status: "active",
				createdById: owner.id,
			})
			.returning({ id: document.id });
		const copy = copyRows[0]?.id;
		if (!copy) throw new Error("document not inserted");

		// Same title but a different date: not a duplicate.
		await db.insert(document).values({
			title: "EDF invoice",
			documentDate: "2025-02-10",
			datePrecision: "day",
			status: "active",
			createdById: owner.id,
		});

		const duplicates = await client.document.duplicates({});
		expect(duplicates).toEqual([
			{
				documentId: copy,
				title: "  edf   INVOICE ",
				documentDate: "2025-01-10",
				datePrecision: "day",
				thumbnailFileId: null,
				duplicateOfId: original,
				duplicateOfTitle: "EDF invoice",
				duplicateOfDate: "2025-01-10",
				duplicateOfDatePrecision: "day",
				duplicateOfThumbnailFileId: null,
				reason: "sameTitleAndDate",
				ignored: false,
			},
		]);
	});

	test("ignores trashed documents for the title + date rule", async () => {
		const rows = await db
			.insert(document)
			.values([
				{
					title: "EDF invoice",
					documentDate: "2025-01-10",
					datePrecision: "day" as const,
					status: "active" as const,
					createdById: owner.id,
				},
				{
					title: "EDF invoice",
					documentDate: "2025-01-10",
					datePrecision: "day" as const,
					status: "active" as const,
					createdById: owner.id,
					deletedAt: new Date(),
				},
			])
			.returning({ id: document.id });
		expect(rows).toHaveLength(2);

		expect(await client.document.duplicates({})).toEqual([]);
	});

	test("ignoreDuplicate dismisses a pair, unignoreDuplicate restores it", async () => {
		const rows = await db
			.insert(document)
			.values([
				{
					title: "EDF invoice",
					documentDate: "2025-01-10",
					datePrecision: "day" as const,
					status: "active" as const,
					createdById: owner.id,
				},
				{
					title: "EDF invoice",
					documentDate: "2025-01-10",
					datePrecision: "day" as const,
					status: "active" as const,
					createdById: owner.id,
				},
			])
			.returning({ id: document.id });
		const [first, second] = rows;
		if (!first || !second) throw new Error("documents not inserted");
		// Order the pair the same way the caller would after `duplicates()`.
		const [a, b] =
			first.id < second.id ? [first.id, second.id] : [second.id, first.id];

		expect(await client.document.duplicates({})).toHaveLength(1);

		const ignored = await client.document.ignoreDuplicate({
			documentId: b,
			otherDocumentId: a,
		});
		// The result comes back normalized regardless of the order provided.
		expect(ignored).toEqual({
			documentId: a,
			otherDocumentId: b,
			ignored: true,
		});

		expect(await client.document.duplicates({})).toEqual([]);

		const withIgnored = await client.document.duplicates({
			includeIgnored: true,
		});
		expect(withIgnored).toHaveLength(1);
		expect(withIgnored[0]?.ignored).toBe(true);

		const unignored = await client.document.unignoreDuplicate({
			documentId: a,
			otherDocumentId: b,
		});
		expect(unignored).toEqual({
			documentId: a,
			otherDocumentId: b,
			ignored: false,
		});

		expect(await client.document.duplicates({})).toHaveLength(1);
	});

	test("ignoreDuplicate rejects an unknown document", async () => {
		const rows = await db
			.insert(document)
			.values({
				title: "EDF invoice",
				status: "active",
				createdById: owner.id,
			})
			.returning({ id: document.id });
		const id = rows[0]?.id;
		if (!id) throw new Error("document not inserted");

		await expectOrpcError(
			client.document.ignoreDuplicate({
				documentId: id,
				otherDocumentId: "doc_missing",
			}),
			"NOT_FOUND",
		);
	});
});

describe("appRouter — document.get: dossiers", () => {
	test("lists the dossiers a document belongs to, and dossier.listForDocument matches", async () => {
		const rows = await db
			.insert(document)
			.values({ title: "Deed", status: "active", createdById: owner.id })
			.returning({ id: document.id });
		const documentId = rows[0]?.id;
		if (!documentId) throw new Error("document not inserted");

		const housing = await client.dossier.create({ name: "Housing" });
		const taxes = await client.dossier.create({ name: "Taxes" });
		await client.dossier.addDocuments({
			id: housing.id,
			documentIds: [documentId],
		});
		await client.dossier.addDocuments({
			id: taxes.id,
			documentIds: [documentId],
		});

		const detail = await client.document.get({ id: documentId });
		expect(detail.dossiers.map((item) => item.name).sort()).toEqual([
			"Housing",
			"Taxes",
		]);
		expect(detail.dossiers[0]).toEqual(
			expect.objectContaining({
				id: expect.any(String),
				name: expect.any(String),
				status: "open",
			}),
		);

		const listed = await client.dossier.listForDocument({ documentId });
		expect(listed.map((item) => item.name).sort()).toEqual([
			"Housing",
			"Taxes",
		]);
	});

	test("an untouched document has no dossiers", async () => {
		const rows = await db
			.insert(document)
			.values({ title: "Lonely", status: "active", createdById: owner.id })
			.returning({ id: document.id });
		const documentId = rows[0]?.id;
		if (!documentId) throw new Error("document not inserted");

		expect((await client.document.get({ id: documentId })).dossiers).toEqual(
			[],
		);
		expect(await client.dossier.listForDocument({ documentId })).toEqual([]);
	});
});
