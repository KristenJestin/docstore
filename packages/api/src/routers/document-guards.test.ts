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
import { party } from "@docstore/db/schema/party";
import { documentRelation } from "@docstore/db/schema/relation";
import { rule } from "@docstore/db/schema/rule";
import { shareLink } from "@docstore/db/schema/share";
import { tag } from "@docstore/db/schema/tag";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { and, eq } from "drizzle-orm";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

/**
 * Guards on the document write path (SPEC §2):
 * - a document in the trash is read-only;
 * - a directional relation never closes a cycle;
 * - a custom field value respects its definition;
 * - raising `sensitive` closes the public windows already open.
 */

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
		.values({ title, status: "active", createdById: owner.id, ...overrides })
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

/** Message shared by every refusal on a trashed document. */
const TRASHED = "Document is in the trash; restore it first.";

describe("the trash is read-only", () => {
	test("every metadata write is refused with CONFLICT", async () => {
		const id = await seedDocument("Trashed");
		const categories = await db
			.insert(category)
			.values({ name: "Invoice", slug: "invoice" })
			.returning({ id: category.id });
		const categoryId = categories[0]?.id ?? "";
		const tags = await db
			.insert(tag)
			.values({ name: "energy" })
			.returning({ id: tag.id });
		const tagId = tags[0]?.id ?? "";
		const fields = await db
			.insert(customField)
			.values({ name: "Reference", slug: "reference", type: "text" })
			.returning({ id: customField.id });
		const fieldId = fields[0]?.id ?? "";

		await client.document.trash({ id });

		const error = await expectOrpcError(
			client.document.update({ id, title: "Renamed" }),
			"CONFLICT",
		);
		expect(error.message).toContain(TRASHED);

		await expectOrpcError(
			client.document.setCategory({ id, categoryId }),
			"CONFLICT",
		);
		await expectOrpcError(
			client.document.setTags({ id, tagIds: [tagId] }),
			"CONFLICT",
		);
		await expectOrpcError(
			client.document.setParties({ id, parties: [] }),
			"CONFLICT",
		);
		await expectOrpcError(
			client.document.setFieldValue({
				id,
				fieldId,
				value: { kind: "text", text: "X" },
			}),
			"CONFLICT",
		);

		// Nothing moved.
		const detail = await client.document.get({ id });
		expect(detail.title).toBe("Trashed");
		expect(detail.categoryId).toBeNull();
	});

	test("addRelation, dossier.addDocuments and the type writes are refused", async () => {
		const trashed = await seedDocument("Trashed");
		const other = await seedDocument("Live");
		await client.document.trash({ id: trashed });

		await expectOrpcError(
			client.document.addRelation({
				fromDocumentId: trashed,
				toDocumentId: other,
				kind: "related_to",
			}),
			"CONFLICT",
		);

		const dossier = await client.dossier.create({ name: "Move" });
		await expectOrpcError(
			client.dossier.addDocuments({
				id: dossier.id,
				documentIds: [trashed],
			}),
			"CONFLICT",
		);

		const type = await client.documentType.create({ name: "Invoice" });
		await expectOrpcError(
			client.documentType.apply({
				documentTypeId: type.id,
				documentIds: [trashed],
			}),
			"CONFLICT",
		);
		await expectOrpcError(
			client.documentType.setDocumentOverride({
				documentTypeId: type.id,
				documentId: trashed,
				included: true,
			}),
			"CONFLICT",
		);
		await expectOrpcError(
			client.documentType.createFromDocument({ documentId: trashed }),
			"CONFLICT",
		);
	});

	test("trashing twice keeps the original date", async () => {
		const id = await seedDocument("Twice");
		const first = await client.document.trash({ id });
		expect(first.deletedAt).not.toBeNull();

		const second = await client.document.trash({ id });
		expect(second.deletedAt?.getTime()).toBe(first.deletedAt?.getTime());
	});

	test("a bulk action other than trash/restore refuses a trashed document", async () => {
		const id = await seedDocument("Bulk");
		await client.document.trash({ id });

		await expectOrpcError(
			client.document.bulk({
				ids: [id],
				action: { type: "setSensitive", sensitive: true },
			}),
			"CONFLICT",
		);
		// Restoring still works, and trashing again is a no-op.
		expect(
			await client.document.bulk({ ids: [id], action: { type: "trash" } }),
		).toEqual({ updated: 0 });
		expect(
			await client.document.bulk({ ids: [id], action: { type: "restore" } }),
		).toEqual({ updated: 1 });
	});

	test("a trashed document drops out of the relations of the others", async () => {
		const kept = await seedDocument("Kept");
		const other = await seedDocument("Other");
		await client.document.addRelation({
			fromDocumentId: kept,
			toDocumentId: other,
			kind: "related_to",
		});
		expect((await client.document.get({ id: kept })).relations).toHaveLength(1);

		await client.document.trash({ id: other });
		expect((await client.document.get({ id: kept })).relations).toHaveLength(0);

		await client.document.restore({ id: other });
		expect((await client.document.get({ id: kept })).relations).toHaveLength(1);
	});

	test("a trashed document leaves the dossier counts and lists", async () => {
		const id = await seedDocument("Filed");
		const dossier = await client.dossier.create({ name: "Insurance" });
		await client.dossier.addDocuments({
			id: dossier.id,
			documentIds: [id],
		});
		expect((await client.dossier.get({ id: dossier.id })).documentCount).toBe(
			1,
		);

		await client.document.trash({ id });
		expect((await client.dossier.get({ id: dossier.id })).documentCount).toBe(
			0,
		);
		expect((await client.dossier.list({}))[0]?.documentCount).toBe(0);
		expect((await client.document.list({ dossierId: dossier.id })).total).toBe(
			0,
		);
	});
});

/**
 * Table of *every* procedure that writes on a document, called on a trashed
 * one. The point is the exhaustiveness: a new writer added without its guard
 * shows up here as a missing row, not as a silent hole in SPEC §2.
 *
 * `trash`, `restore` and `deletePermanently` are the three ways out of the
 * trash and are excluded by definition.
 */
describe("the trash is read-only — every writer", () => {
	test("every document-writing procedure answers CONFLICT", async () => {
		const trashed = await seedDocument("Trashed");
		const live = await seedDocument("Live");

		const categories = await db
			.insert(category)
			.values({ name: "Invoice", slug: "invoice" })
			.returning({ id: category.id });
		const categoryId = categories[0]?.id ?? "";
		const tags = await db
			.insert(tag)
			.values({ name: "energy" })
			.returning({ id: tag.id });
		const tagId = tags[0]?.id ?? "";
		const fields = await db
			.insert(customField)
			.values({ name: "Reference", slug: "reference", type: "text" })
			.returning({ id: customField.id });
		const fieldId = fields[0]?.id ?? "";
		const parties = await db
			.insert(party)
			.values({ type: "company", name: "EDF" })
			.returning({ id: party.id });
		const partyId = parties[0]?.id ?? "";

		// Everything the writers need a handle on is created while the document
		// is still live.
		const relation = await client.document.addRelation({
			fromDocumentId: trashed,
			toDocumentId: live,
			kind: "related_to",
		});
		await client.document.addTag({ id: trashed, tagId });
		await client.document.addParty({ id: trashed, partyId, role: "issuer" });
		await client.document.setFieldValue({
			id: trashed,
			fieldId,
			value: { kind: "text", text: "X" },
		});
		const dossier = await client.dossier.create({ name: "Case" });
		await client.dossier.addDocuments({
			id: dossier.id,
			documentIds: [trashed],
		});
		const type = await client.documentType.create({ name: "Invoice" });
		const rules = await db
			.insert(rule)
			.values({
				name: "Leftover",
				condition: { op: "and", children: [] },
				actions: [],
			})
			.returning({ id: rule.id });
		const ruleId = rules[0]?.id ?? "";

		await client.document.trash({ id: trashed });

		const writers: Record<string, () => Promise<unknown>> = {
			"document.update": () =>
				client.document.update({ id: trashed, title: "Renamed" }),
			"document.assignAsn": () => client.document.assignAsn({ id: trashed }),
			"document.setCategory": () =>
				client.document.setCategory({ id: trashed, categoryId }),
			"document.setTags": () =>
				client.document.setTags({ id: trashed, tagIds: [] }),
			"document.addTag": () => client.document.addTag({ id: trashed, tagId }),
			"document.removeTag": () =>
				client.document.removeTag({ id: trashed, tagId }),
			"document.setParties": () =>
				client.document.setParties({ id: trashed, parties: [] }),
			"document.addParty": () =>
				client.document.addParty({ id: trashed, partyId, role: "recipient" }),
			"document.removeParty": () =>
				client.document.removeParty({ id: trashed, partyId, role: "issuer" }),
			"document.setFieldValue": () =>
				client.document.setFieldValue({
					id: trashed,
					fieldId,
					value: { kind: "text", text: "Y" },
				}),
			"document.clearFieldValue": () =>
				client.document.clearFieldValue({ id: trashed, fieldId }),
			"document.bulk": () =>
				client.document.bulk({
					ids: [trashed],
					action: { type: "setSensitive", sensitive: true },
				}),
			"document.addRelation": () =>
				client.document.addRelation({
					fromDocumentId: trashed,
					toDocumentId: live,
					kind: "supersedes",
				}),
			"document.removeRelation": () =>
				client.document.removeRelation({ id: relation.id }),
			"document.mergeAsVersion (source)": () =>
				client.document.mergeAsVersion({
					documentId: trashed,
					intoDocumentId: live,
				}),
			"document.mergeAsVersion (target)": () =>
				client.document.mergeAsVersion({
					documentId: live,
					intoDocumentId: trashed,
				}),
			"document.ignoreDuplicate": () =>
				client.document.ignoreDuplicate({
					documentId: trashed,
					otherDocumentId: live,
				}),
			"document.unignoreDuplicate": () =>
				client.document.unignoreDuplicate({
					documentId: trashed,
					otherDocumentId: live,
				}),
			"document.reprocess": () => client.document.reprocess({ id: trashed }),
			"review.approve": () => client.review.approve({ id: trashed }),
			"review.approveMany": () => client.review.approveMany({ ids: [trashed] }),
			"review.rejectAssignment": () =>
				client.review.rejectAssignment({ id: trashed, kind: "category" }),
			"review.recompute": () => client.review.recompute({ id: trashed }),
			"review.requeue": () => client.review.requeue({ id: trashed }),
			"documentType.apply": () =>
				client.documentType.apply({
					documentTypeId: type.id,
					documentIds: [trashed],
				}),
			"documentType.setDocumentOverride": () =>
				client.documentType.setDocumentOverride({
					documentTypeId: type.id,
					documentId: trashed,
					included: true,
				}),
			"documentType.createFromDocument": () =>
				client.documentType.createFromDocument({ documentId: trashed }),
			"documentType.createLayoutFromDocument": () =>
				client.documentType.createLayoutFromDocument({
					documentTypeId: type.id,
					documentId: trashed,
					name: "From trash",
				}),
			"dossier.addDocuments": () =>
				client.dossier.addDocuments({
					id: dossier.id,
					documentIds: [trashed],
				}),
			"dossier.removeDocument": () =>
				client.dossier.removeDocument({
					id: dossier.id,
					documentId: trashed,
				}),
			"shareLink.create": () =>
				client.shareLink.create({ documentId: trashed }),
			"rule.run": () => client.rule.run({ ruleId, documentIds: [trashed] }),
		};

		for (const [name, call] of Object.entries(writers)) {
			const error = await expectOrpcError(call(), "CONFLICT");
			expect(`${name}: ${error.message}`).toContain(TRASHED);
		}

		// Nothing moved: the document is exactly as it went in.
		const detail = await client.document.get({ id: trashed });
		expect(detail.title).toBe("Trashed");
		expect(detail.asn).toBeNull();
		expect(detail.sensitive).toBe(false);
		expect(detail.categoryId).toBeNull();
	});

	test("the three ways out of the trash still work", async () => {
		const id = await seedDocument("Recoverable");
		await client.document.trash({ id });

		expect((await client.document.trash({ id })).deletedAt).not.toBeNull();
		expect((await client.document.restore({ id })).deletedAt).toBeNull();

		await client.document.trash({ id });
		expect(await client.document.deletePermanently({ id })).toMatchObject({
			id,
			deleted: true,
		});
	});
});

describe("document.update — dates", () => {
	test("a precision without a date is refused", async () => {
		const id = await seedDocument("Undated");
		await expectOrpcError(
			client.document.update({ id, datePrecision: "month" }),
			"BAD_REQUEST",
		);
	});

	test("clearing the date clears the precision", async () => {
		const id = await seedDocument("Dated", {
			documentDate: "2026-03-01",
			datePrecision: "month",
		});

		const cleared = await client.document.update({ id, documentDate: null });
		expect(cleared.documentDate).toBeNull();
		expect(cleared.datePrecision).toBeNull();
	});

	test("clearing the precision of a dated document is refused", async () => {
		const id = await seedDocument("Dated", {
			documentDate: "2026-03-01",
			datePrecision: "month",
		});

		await expectOrpcError(
			client.document.update({ id, datePrecision: null }),
			"BAD_REQUEST",
		);
	});

	/**
	 * Rows written before `0017_fix-orphan-date-precision` can hold a precision
	 * without a date: the patch is what gets validated, so they stay editable.
	 */
	test("a legacy row with an orphan precision stays editable", async () => {
		const id = await seedDocument("Legacy", { datePrecision: "month" });

		const renamed = await client.document.update({ id, title: "Renamed" });
		expect(renamed.title).toBe("Renamed");

		// Both ways out of the inconsistency are open.
		const dated = await client.document.update({
			id,
			documentDate: "2026-03-01",
		});
		expect(dated.documentDate).toBe("2026-03-01");
		expect(dated.datePrecision).toBe("month");

		const other = await seedDocument("Legacy 2", { datePrecision: "year" });
		const cleaned = await client.document.update({
			id: other,
			datePrecision: null,
		});
		expect(cleaned.datePrecision).toBeNull();
	});
});

describe("document.addRelation — cycles", () => {
	test("a directional relation refuses to close a cycle", async () => {
		const a = await seedDocument("A");
		const b = await seedDocument("B");
		const c = await seedDocument("C");

		await client.document.addRelation({
			fromDocumentId: a,
			toDocumentId: b,
			kind: "supersedes",
		});
		await client.document.addRelation({
			fromDocumentId: b,
			toDocumentId: c,
			kind: "supersedes",
		});

		// Direct loop…
		const direct = await expectOrpcError(
			client.document.addRelation({
				fromDocumentId: b,
				toDocumentId: a,
				kind: "supersedes",
			}),
			"BAD_REQUEST",
		);
		expect(direct.message).toContain("cycle");

		// … and through a chain.
		await expectOrpcError(
			client.document.addRelation({
				fromDocumentId: c,
				toDocumentId: a,
				kind: "supersedes",
			}),
			"BAD_REQUEST",
		);
	});

	test("every directional kind is guarded, `related_to` stays symmetric", async () => {
		for (const kind of [
			"version_of",
			"page_of",
			"fulfills",
			"supersedes",
		] as const) {
			const a = await seedDocument(`A ${kind}`);
			const b = await seedDocument(`B ${kind}`);
			await client.document.addRelation({
				fromDocumentId: a,
				toDocumentId: b,
				kind,
			});
			await expectOrpcError(
				client.document.addRelation({
					fromDocumentId: b,
					toDocumentId: a,
					kind,
				}),
				"BAD_REQUEST",
			);
		}

		const x = await seedDocument("X");
		const y = await seedDocument("Y");
		await client.document.addRelation({
			fromDocumentId: x,
			toDocumentId: y,
			kind: "related_to",
		});
		const back = await client.document.addRelation({
			fromDocumentId: y,
			toDocumentId: x,
			kind: "related_to",
		});
		expect(back.kind).toBe("related_to");
	});
});

describe("document.setFieldValue — constraints", () => {
	async function seedMoneyField(
		options: Record<string, unknown> = { currency: "EUR" },
		categoryIds: string[] = [],
	): Promise<string> {
		const rows = await db
			.insert(customField)
			.values({
				name: "Total amount",
				slug: `total-${Math.random().toString(36).slice(2, 8)}`,
				type: "money",
				options,
				categoryIds,
			})
			.returning({ id: customField.id });
		return rows[0]?.id ?? "";
	}

	test("the currency must be the one configured on the field", async () => {
		const id = await seedDocument("Invoice");
		const fieldId = await seedMoneyField();

		const error = await expectOrpcError(
			client.document.setFieldValue({
				id,
				fieldId,
				value: { kind: "money", amount: 10, currency: "USD" },
			}),
			"BAD_REQUEST",
		);
		expect(error.message).toContain("EUR");
	});

	test("EUR is the default currency of a field that names none", async () => {
		const id = await seedDocument("Invoice");
		const fieldId = await seedMoneyField({});

		await expectOrpcError(
			client.document.setFieldValue({
				id,
				fieldId,
				value: { kind: "money", amount: 10, currency: "CHF" },
			}),
			"BAD_REQUEST",
		);
		const detail = await client.document.setFieldValue({
			id,
			fieldId,
			value: { kind: "money", amount: 10, currency: "EUR" },
		});
		expect(detail.fieldValues).toHaveLength(1);
	});

	test("a negative amount needs `allowNegative`", async () => {
		const id = await seedDocument("Credit note");
		const strict = await seedMoneyField({ currency: "EUR" });
		await expectOrpcError(
			client.document.setFieldValue({
				id,
				fieldId: strict,
				value: { kind: "money", amount: -10, currency: "EUR" },
			}),
			"BAD_REQUEST",
		);

		const lenient = await seedMoneyField({
			currency: "EUR",
			allowNegative: true,
		});
		const detail = await client.document.setFieldValue({
			id,
			fieldId: lenient,
			value: { kind: "money", amount: -10, currency: "EUR" },
		});
		expect(detail.fieldValues).toHaveLength(1);
	});

	test("a field restricted to a category is refused elsewhere", async () => {
		const categories = await db
			.insert(category)
			.values([
				{ name: "Payslip", slug: "payslip" },
				{ name: "Invoice", slug: "invoice" },
			])
			.returning({ id: category.id, slug: category.slug });
		const payslip = categories.find((row) => row.slug === "payslip")?.id ?? "";
		const invoice = categories.find((row) => row.slug === "invoice")?.id ?? "";
		const fieldId = await seedMoneyField({ currency: "EUR" }, [payslip]);

		const wrong = await seedDocument("Invoice", { categoryId: invoice });
		const error = await expectOrpcError(
			client.document.setFieldValue({
				id: wrong,
				fieldId,
				value: { kind: "money", amount: 10, currency: "EUR" },
			}),
			"BAD_REQUEST",
		);
		expect(error.message).toContain("category");

		const right = await seedDocument("Payslip", { categoryId: payslip });
		expect(
			(
				await client.document.setFieldValue({
					id: right,
					fieldId,
					value: { kind: "money", amount: 10, currency: "EUR" },
				})
			).fieldValues,
		).toHaveLength(1);
	});

	test("a field offered on a parent category applies to its children", async () => {
		const parents = await db
			.insert(category)
			.values({ name: "Invoice", slug: "invoice" })
			.returning({ id: category.id });
		const parentId = parents[0]?.id ?? "";
		const children = await db
			.insert(category)
			.values({ name: "Subscription", slug: "subscription", parentId })
			.returning({ id: category.id });
		const childId = children[0]?.id ?? "";

		const fieldId = await seedMoneyField({ currency: "EUR" }, [parentId]);
		const id = await seedDocument("Subscription", { categoryId: childId });
		expect(
			(
				await client.document.setFieldValue({
					id,
					fieldId,
					value: { kind: "money", amount: 10, currency: "EUR" },
				})
			).fieldValues,
		).toHaveLength(1);
	});
});

describe("share links and the sensitive flag", () => {
	async function activeLinks(): Promise<
		{ revokedAt: Date | null; revokedReason: string | null }[]
	> {
		return db
			.select({
				revokedAt: shareLink.revokedAt,
				revokedReason: shareLink.revokedReason,
			})
			.from(shareLink);
	}

	test("document.update revokes the links of the document and of its dossiers", async () => {
		const id = await seedDocument("Bank statement");
		const dossier = await client.dossier.create({ name: "Bank" });
		await client.dossier.addDocuments({
			id: dossier.id,
			documentIds: [id],
		});

		await client.shareLink.create({ documentId: id });
		await client.shareLink.create({ dossierId: dossier.id });
		expect((await activeLinks()).every((row) => row.revokedAt === null)).toBe(
			true,
		);

		await client.document.update({ id, sensitive: true });

		const links = await activeLinks();
		expect(links).toHaveLength(2);
		expect(links.every((row) => row.revokedAt !== null)).toBe(true);
		expect(links.every((row) => row.revokedReason === "sensitive")).toBe(true);

		// `shareLink.list` exposes the reason.
		const listed = await client.shareLink.list({ includeInactive: true });
		expect(listed.map((link) => link.revokedReason)).toEqual([
			"sensitive",
			"sensitive",
		]);
	});

	test("the bulk action revokes them too", async () => {
		const id = await seedDocument("Payslip");
		await client.shareLink.create({ documentId: id });

		await client.document.bulk({
			ids: [id],
			action: { type: "setSensitive", sensitive: true },
		});
		expect((await activeLinks())[0]?.revokedReason).toBe("sensitive");
	});

	test("filing a sensitive document into a dossier revokes its links", async () => {
		const secret = await seedDocument("Blood test", { sensitive: true });
		const dossier = await client.dossier.create({ name: "Health" });
		await client.shareLink.create({ dossierId: dossier.id });
		expect((await activeLinks())[0]?.revokedAt).toBeNull();

		await client.dossier.addDocuments({
			id: dossier.id,
			documentIds: [secret],
		});

		const links = await activeLinks();
		expect(links[0]?.revokedAt).not.toBeNull();
		expect(links[0]?.revokedReason).toBe("sensitive");
	});

	test("filing a plain document leaves the dossier links open", async () => {
		const plain = await seedDocument("Deed");
		const dossier = await client.dossier.create({ name: "Housing" });
		await client.shareLink.create({ dossierId: dossier.id });

		await client.dossier.addDocuments({
			id: dossier.id,
			documentIds: [plain],
		});
		expect((await activeLinks())[0]?.revokedAt).toBeNull();
	});

	test("a manual revocation is recorded as such", async () => {
		const id = await seedDocument("Lease");
		const created = await client.shareLink.create({ documentId: id });
		const revoked = await client.shareLink.revoke({ id: created.link.id });
		expect(revoked.revokedReason).toBe("manual");
	});

	test("an already revoked link keeps its reason", async () => {
		const id = await seedDocument("Contract");
		const created = await client.shareLink.create({ documentId: id });
		await client.document.update({ id, sensitive: true });
		const revoked = await client.shareLink.revoke({ id: created.link.id });
		expect(revoked.revokedReason).toBe("sensitive");
	});

	test("an expiry in the past is refused", async () => {
		const id = await seedDocument("Expired");
		await expectOrpcError(
			client.shareLink.create({
				documentId: id,
				expiresAt: new Date(Date.now() - 60_000).toISOString(),
			}),
			"BAD_REQUEST",
		);
	});

	test("a link on another document is left alone", async () => {
		const sensitive = await seedDocument("Sensitive");
		const other = await seedDocument("Other");
		await client.shareLink.create({ documentId: other });

		await client.document.update({ id: sensitive, sensitive: true });
		const rows = await db
			.select({ revokedAt: shareLink.revokedAt })
			.from(shareLink);
		expect(rows[0]?.revokedAt).toBeNull();
	});
});

describe("document relations kept in the database", () => {
	test("hiding a trashed relation does not delete it", async () => {
		const a = await seedDocument("A");
		const b = await seedDocument("B");
		await client.document.addRelation({
			fromDocumentId: a,
			toDocumentId: b,
			kind: "related_to",
		});
		await client.document.trash({ id: b });

		const rows = await db
			.select({ id: documentRelation.id })
			.from(documentRelation)
			.where(
				and(
					eq(documentRelation.fromDocumentId, a),
					eq(documentRelation.toDocumentId, b),
				),
			);
		expect(rows).toHaveLength(1);
	});
});
