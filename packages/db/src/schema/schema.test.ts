import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { createId } from "../id";
import { createTestDb, type TestDb, truncateAll } from "../test-utils";
import { user } from "./auth";
import { document, documentFile, documentParty } from "./document";
import { party } from "./party";

/** Shape of a `pg` error surfaced in `cause` by drizzle. */
type PgError = { code?: string; constraint?: string };

let db: TestDb;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
});

async function insertUser() {
	const [row] = await db
		.insert(user)
		.values({
			id: createId("usr_"),
			name: "Camille Moreau",
			email: `camille-${createId("")}@example.com`,
		})
		.returning();
	if (!row) throw new Error("user was not inserted");
	return row;
}

async function insertParty() {
	const [row] = await db
		.insert(party)
		.values({
			type: "company",
			name: "EDF",
			aliases: ["EDF SA"],
			identifiers: {
				siren: "552081317",
				domain: ["edf.fr"],
				email: ["contact@edf.fr"],
			},
		})
		.returning();
	if (!row) throw new Error("party was not inserted");
	return row;
}

describe("document schema", () => {
	test("inserts a complete document with files and linked parties", async () => {
		const owner = await insertUser();
		const issuer = await insertParty();

		const [doc] = await db
			.insert(document)
			.values({
				title: "Electricity invoice December 2025",
				status: "active",
				documentDate: "2025-12-05",
				datePrecision: "day",
				periodStart: "2025-12-01",
				periodEnd: "2025-12-31",
				content: "EDF invoice for the December 2025 period.",
				asn: 1001,
				createdById: owner.id,
			})
			.returning();
		if (!doc) throw new Error("document was not inserted");

		expect(doc.id.startsWith("doc_")).toBe(true);
		expect(issuer.id.startsWith("prt_")).toBe(true);
		expect(doc.sensitive).toBe(false);
		expect(doc.deletedAt).toBeNull();

		const files = await db
			.insert(documentFile)
			.values([
				{
					documentId: doc.id,
					kind: "original",
					filename: "invoice.pdf",
					mime: "application/pdf",
					size: 128_000,
					sha256: "a".repeat(64),
					storageKey: `original/${doc.id}.pdf`,
					pageCount: 2,
					ocrLayout: {
						pages: [
							{
								width: 2480,
								height: 3508,
								words: [
									{
										text: "Invoice",
										x0: 10,
										y0: 20,
										x1: 90,
										y1: 40,
										conf: 0.98,
									},
								],
							},
						],
					},
				},
				{
					documentId: doc.id,
					kind: "archive",
					filename: "invoice-archive.pdf",
					mime: "application/pdf",
					size: 96_000,
					sha256: "b".repeat(64),
					storageKey: `archive/${doc.id}.pdf`,
				},
			])
			.returning();

		expect(files).toHaveLength(2);
		expect(files.every((file) => file.id.startsWith("fil_"))).toBe(true);
		expect(files[0]?.size).toBe(128_000);
		expect(files[0]?.ocrLayout?.pages[0]?.words[0]?.text).toBe("Invoice");
		expect(files[0]?.encrypted).toBe(false);

		await db.insert(documentParty).values({
			documentId: doc.id,
			partyId: issuer.id,
			role: "issuer",
			confidence: 0.92,
			source: "rule",
		});

		const link = await db.query.documentParty.findFirst({
			where: and(
				eq(documentParty.documentId, doc.id),
				eq(documentParty.partyId, issuer.id),
			),
			with: { party: true, document: true },
		});

		expect(link?.role).toBe("issuer");
		expect(link?.source).toBe("rule");
		expect(link?.confidence).toBeCloseTo(0.92, 5);
		expect(link?.party.name).toBe("EDF");
		expect(link?.document.title).toContain("invoice");
	});

	test("the generated search_vector column enables full-text search", async () => {
		const owner = await insertUser();
		await db.insert(document).values({
			title: "Electricity invoice December 2025",
			content: "Total amount due for the period.",
			createdById: owner.id,
		});
		await db.insert(document).values({
			title: "Home insurance certificate",
			content: "Comprehensive home insurance contract.",
			createdById: owner.id,
		});

		const found = await db
			.select({ id: document.id, title: document.title })
			.from(document)
			.where(sql`search_vector @@ plainto_tsquery('french', 'invoice')`);

		expect(found).toHaveLength(1);
		expect(found[0]?.title).toContain("invoice");

		// The lexeme also comes from the OCR content, not only from the title.
		const fromContent = await db
			.select({ id: document.id })
			.from(document)
			.where(sql`search_vector @@ plainto_tsquery('french', 'comprehensive')`);

		expect(fromContent).toHaveLength(1);
	});

	test("search_vector is updated when the content changes", async () => {
		const owner = await insertUser();
		const [doc] = await db
			.insert(document)
			.values({ title: "Document without content", createdById: owner.id })
			.returning();
		if (!doc) throw new Error("document was not inserted");

		const before = await db
			.select({ id: document.id })
			.from(document)
			.where(sql`search_vector @@ plainto_tsquery('french', 'refund')`);
		expect(before).toHaveLength(0);

		await db
			.update(document)
			.set({ content: "Refund request accepted." })
			.where(eq(document.id, doc.id));

		const after = await db
			.select({ id: document.id })
			.from(document)
			.where(sql`search_vector @@ plainto_tsquery('french', 'refund')`);
		expect(after).toHaveLength(1);
	});

	test("sha256 is unique between originals but free for the other kinds", async () => {
		const owner = await insertUser();
		const [first] = await db
			.insert(document)
			.values({ title: "Doc A", createdById: owner.id })
			.returning();
		const [second] = await db
			.insert(document)
			.values({ title: "Doc B", createdById: owner.id })
			.returning();
		if (!first || !second) throw new Error("documents were not inserted");

		const sha = "c".repeat(64);

		await db.insert(documentFile).values({
			documentId: first.id,
			kind: "original",
			filename: "a.pdf",
			mime: "application/pdf",
			size: 10,
			sha256: sha,
			storageKey: "original/a.pdf",
		});

		// Duplicate original -> rejected by the partial unique index.
		let duplicateError: unknown;
		try {
			await db.insert(documentFile).values({
				documentId: second.id,
				kind: "original",
				filename: "b.pdf",
				mime: "application/pdf",
				size: 10,
				sha256: sha,
				storageKey: "original/b.pdf",
			});
		} catch (error) {
			duplicateError = error;
		}
		const cause = (duplicateError as { cause?: PgError } | undefined)?.cause;
		expect(cause?.code).toBe("23505");
		expect(cause?.constraint).toBe("document_file_sha256_original_uidx");

		// Same hash on an attachment -> allowed.
		const [attachment] = await db
			.insert(documentFile)
			.values({
				documentId: second.id,
				kind: "attachment",
				filename: "b.pdf",
				mime: "application/pdf",
				size: 10,
				sha256: sha,
				storageKey: "attachment/b.pdf",
			})
			.returning();
		expect(attachment?.sha256).toBe(sha);
	});

	test("deleting a document deletes its files and its links", async () => {
		const owner = await insertUser();
		const issuer = await insertParty();
		const [doc] = await db
			.insert(document)
			.values({ title: "Doc to delete", createdById: owner.id })
			.returning();
		if (!doc) throw new Error("document was not inserted");

		await db.insert(documentFile).values({
			documentId: doc.id,
			kind: "original",
			filename: "x.pdf",
			mime: "application/pdf",
			size: 1,
			sha256: "d".repeat(64),
			storageKey: "original/x.pdf",
		});
		await db
			.insert(documentParty)
			.values({ documentId: doc.id, partyId: issuer.id, role: "recipient" });

		await db.delete(document).where(eq(document.id, doc.id));

		expect(await db.select().from(documentFile)).toHaveLength(0);
		expect(await db.select().from(documentParty)).toHaveLength(0);
		expect(await db.select().from(party)).toHaveLength(1);
	});

	test("JSONB identifiers are queryable (GIN index)", async () => {
		await insertParty();

		const matches = await db
			.select({ id: party.id, name: party.name })
			.from(party)
			.where(sql`${party.identifiers} @> '{"siren":"552081317"}'::jsonb`);

		expect(matches).toHaveLength(1);
		expect(matches[0]?.name).toBe("EDF");
	});

	test("truncateAll does empty the tables between two tests", async () => {
		expect(await db.select().from(document)).toHaveLength(0);
		expect(await db.select().from(party)).toHaveLength(0);
		expect(await db.select().from(user)).toHaveLength(0);
	});
});
