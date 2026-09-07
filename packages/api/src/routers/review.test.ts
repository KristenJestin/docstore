import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { category } from "@docstore/db/schema/category";
import {
	customField,
	documentFieldValue,
} from "@docstore/db/schema/custom-field";
import { document, documentParty } from "@docstore/db/schema/document";
import { party } from "@docstore/db/schema/party";
import { documentTag, tag } from "@docstore/db/schema/tag";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { ReviewReason } from "@docstore/shared/document";
import { and, eq } from "drizzle-orm";
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

const REASONS: ReviewReason[] = [
	{
		code: "lowConfidence",
		message: "Issuer suggested automatically.",
		confidence: 0.7,
		field: "issuer",
	},
	{ code: "missingCategory", message: "No category.", field: "category" },
];

/**
 * Document in the review queue, with assignments coming from rules.
 *
 * `suffix` keeps the unique columns (category slug, custom field slug) apart
 * when a test needs more than one such document.
 */
async function seedReviewDocument(suffix = ""): Promise<{
	documentId: string;
	partyId: string;
	tagId: string;
	fieldId: string;
	categoryId: string;
}> {
	const categories = await db
		.insert(category)
		.values({ name: "Invoice", slug: `invoice${suffix}` })
		.returning({ id: category.id });
	const categoryId = categories[0]?.id ?? "";

	const documents = await db
		.insert(document)
		.values({
			title: "EDF invoice",
			status: "review",
			content: "INVOICE No. 2024-001",
			categoryId,
			categorySource: "rule",
			categoryConfidence: 0.82,
			reviewReasons: REASONS,
			createdById: owner.id,
		})
		.returning({ id: document.id });
	const documentId = documents[0]?.id ?? "";

	const parties = await db
		.insert(party)
		.values({ type: "company", name: "EDF" })
		.returning({ id: party.id });
	const partyId = parties[0]?.id ?? "";
	await db.insert(documentParty).values({
		documentId,
		partyId,
		role: "issuer",
		source: "rule",
		confidence: 0.7,
	});

	const tags = await db
		.insert(tag)
		.values({ name: `energy${suffix}` })
		.returning({ id: tag.id });
	const tagId = tags[0]?.id ?? "";
	await db
		.insert(documentTag)
		.values({ documentId, tagId, source: "rule", confidence: 0.8 });

	const fields = await db
		.insert(customField)
		.values({
			name: "Total amount",
			slug: `total-amount${suffix}`,
			type: "money",
			options: { currency: "EUR" },
		})
		.returning({ id: customField.id });
	const fieldId = fields[0]?.id ?? "";
	await db.insert(documentFieldValue).values({
		documentId,
		fieldId,
		value: { kind: "money", amount: 1234.56, currency: "EUR" },
		source: "rule",
		confidence: 0.6,
	});

	return { documentId, partyId, tagId, fieldId, categoryId };
}

describe("review.list / count", () => {
	test("lists the documents to review with their reasons", async () => {
		const { documentId } = await seedReviewDocument();
		await db
			.insert(document)
			.values({ title: "Active", status: "active", createdById: owner.id });

		const page = await client.review.list({});
		expect(page.total).toBe(1);
		expect(page.items[0]?.id).toBe(documentId);
		expect(page.items[0]?.reviewReasons.map((item) => item.code)).toEqual([
			"lowConfidence",
			"missingCategory",
		]);

		expect(await client.review.count({})).toEqual({ count: 1 });
	});

	test("ignores the trash", async () => {
		const { documentId } = await seedReviewDocument();
		await db
			.update(document)
			.set({ deletedAt: new Date() })
			.where(eq(document.id, documentId));
		expect((await client.review.list({})).total).toBe(0);
		expect(await client.review.count({})).toEqual({ count: 0 });
	});
});

describe("review.approve", () => {
	test("confirms the assignments and makes the document active", async () => {
		const { documentId } = await seedReviewDocument();

		const detail = await client.review.approve({ id: documentId });
		expect(detail.status).toBe("active");
		expect(detail.reviewReasons).toEqual([]);

		// Confirmed, not frozen: the source and the confidence still say where
		// the value came from, so the next automatic pass may refresh it.
		expect(detail.parties[0]).toMatchObject({
			source: "rule",
			confidence: 0.7,
		});
		expect(detail.parties[0]?.confirmedAt).toBeInstanceOf(Date);
		expect(detail.fieldValues[0]).toMatchObject({
			source: "rule",
			confidence: 0.6,
		});
		expect(detail.fieldValues[0]?.confirmedAt).toBeInstanceOf(Date);
		expect(detail.category).toMatchObject({
			source: "rule",
			confidence: 0.82,
		});
		expect(detail.category?.confirmedAt).toBeInstanceOf(Date);
		expect(detail.tags[0]?.confirmedAt).toBeInstanceOf(Date);

		const tags = await db
			.select()
			.from(documentTag)
			.where(eq(documentTag.documentId, documentId));
		expect(tags[0]?.source).toBe("rule");
		expect(tags[0]?.confirmedAt).toBeInstanceOf(Date);
	});

	/**
	 * Confirming is not freezing: only what a human typed becomes `manual`, and
	 * the stamp goes away with the value it described. That is what lets a rule
	 * fixed after the fact reach a document someone already cleared from the
	 * queue (see `document-type.test.ts` for the round trip).
	 */
	test("a value typed by hand is manual, and carries no confirmation", async () => {
		const { documentId, fieldId } = await seedReviewDocument();
		await client.review.approve({ id: documentId });

		const detail = await client.document.setFieldValue({
			id: documentId,
			fieldId,
			value: { kind: "money", amount: 42, currency: "EUR" },
		});
		expect(detail.fieldValues[0]).toMatchObject({
			source: "manual",
			confidence: null,
		});
		expect(detail.fieldValues[0]?.confirmedAt).toBeNull();
	});

	test("applies the patch before approving", async () => {
		const { documentId } = await seedReviewDocument();
		const detail = await client.review.approve({
			id: documentId,
			patch: {
				title: "EDF invoice — March 2024",
				documentDate: "2024-03-15",
				datePrecision: "day",
			},
		});
		expect(detail.title).toBe("EDF invoice — March 2024");
		expect(detail.documentDate).toBe("2024-03-15");
		expect(detail.status).toBe("active");
	});

	test("404 on an unknown document", async () => {
		await expectOrpcError(
			client.review.approve({ id: "doc_absent" }),
			"NOT_FOUND",
		);
	});
});

describe("review.approveMany", () => {
	test("approves several documents, skipping and reporting a missing id", async () => {
		const first = await seedReviewDocument();
		const second = await seedReviewDocument("-2");

		const result = await client.review.approveMany({
			ids: [first.documentId, second.documentId, "doc_missing"],
		});
		expect(result).toEqual({ approved: 2, failed: ["doc_missing"] });

		const firstDoc = await client.document.get({ id: first.documentId });
		expect(firstDoc.status).toBe("active");
		expect(firstDoc.category?.confirmedAt).toBeInstanceOf(Date);

		const secondDoc = await client.document.get({ id: second.documentId });
		expect(secondDoc.status).toBe("active");
	});

	test("applies the shared patch to every approved document", async () => {
		const first = await seedReviewDocument();
		const second = await seedReviewDocument("-2");

		const result = await client.review.approveMany({
			ids: [first.documentId, second.documentId],
			patch: { title: "Reviewed" },
		});
		expect(result).toEqual({ approved: 2, failed: [] });

		expect((await client.document.get({ id: first.documentId })).title).toBe(
			"Reviewed",
		);
		expect((await client.document.get({ id: second.documentId })).title).toBe(
			"Reviewed",
		);
	});
});

describe("review.rejectAssignment", () => {
	test("removes a suggested Party and its associated reason", async () => {
		const { documentId, partyId } = await seedReviewDocument();
		const detail = await client.review.rejectAssignment({
			id: documentId,
			kind: "party",
			ref: partyId,
		});
		expect(detail.parties).toEqual([]);
		expect(detail.reviewReasons.map((item) => item.code)).toEqual([
			"missingCategory",
		]);

		const links = await db
			.select()
			.from(documentParty)
			.where(eq(documentParty.documentId, documentId));
		expect(links).toHaveLength(0);
	});

	test("removes a tag, a category and a field value", async () => {
		const { documentId, tagId, fieldId } = await seedReviewDocument();

		expect(
			(
				await client.review.rejectAssignment({
					id: documentId,
					kind: "tag",
					ref: tagId,
				})
			).tags,
		).toEqual([]);

		const withoutCategory = await client.review.rejectAssignment({
			id: documentId,
			kind: "category",
		});
		expect(withoutCategory.categoryId).toBeNull();
		expect(withoutCategory.category).toBeNull();

		const row = await db
			.select({
				categorySource: document.categorySource,
				categoryConfidence: document.categoryConfidence,
			})
			.from(document)
			.where(eq(document.id, documentId));
		expect(row[0]?.categorySource).toBe("manual");
		expect(row[0]?.categoryConfidence).toBeNull();

		const detail = await client.review.rejectAssignment({
			id: documentId,
			kind: "field",
			ref: fieldId,
		});
		expect(detail.fieldValues).toEqual([]);

		const values = await db
			.select()
			.from(documentFieldValue)
			.where(
				and(
					eq(documentFieldValue.documentId, documentId),
					eq(documentFieldValue.fieldId, fieldId),
				),
			);
		expect(values).toHaveLength(0);
	});

	test("requires a reference except for a category", async () => {
		const { documentId } = await seedReviewDocument();
		await expectOrpcError(
			client.review.rejectAssignment({ id: documentId, kind: "tag" }),
			"BAD_REQUEST",
		);
	});
});

describe("review.recompute", () => {
	test("drops satisfied reasons without approving the rest", async () => {
		const { documentId } = await seedReviewDocument();

		// `missingCategory` no longer applies (a category is already set); the
		// low-confidence Issuer suggestion (0.7 < 0.75) still does.
		const detail = await client.review.recompute({ id: documentId });
		expect(detail.reviewReasons.map((item) => item.code)).toEqual([
			"lowConfidence",
		]);
		expect(detail.status).toBe("review");
	});

	test("moves the document back to active once every reason is resolved", async () => {
		const { documentId, partyId } = await seedReviewDocument();
		await db
			.update(documentParty)
			.set({ confidence: 0.95 })
			.where(
				and(
					eq(documentParty.documentId, documentId),
					eq(documentParty.partyId, partyId),
				),
			);

		const detail = await client.review.recompute({ id: documentId });
		expect(detail.reviewReasons).toEqual([]);
		expect(detail.status).toBe("active");
	});

	test("404 on an unknown document", async () => {
		await expectOrpcError(
			client.review.recompute({ id: "doc_absent" }),
			"NOT_FOUND",
		);
	});
});

describe("review.requeue et document.reprocess", () => {
	test("explicit error when the ingestion queue is missing", async () => {
		const { documentId } = await seedReviewDocument();

		const error = await expectOrpcError(
			client.review.requeue({ id: documentId }),
			"SERVICE_UNAVAILABLE",
		);
		expect(error.message).toContain("ingestion queue");

		await expectOrpcError(
			client.document.reprocess({ id: documentId }),
			"SERVICE_UNAVAILABLE",
		);
	});

	test("404 on an unknown document", async () => {
		await expectOrpcError(
			client.document.reprocess({ id: "doc_absent" }),
			"NOT_FOUND",
		);
	});
});

describe("settings", () => {
	test("returns the default values then the stored ones", async () => {
		expect(await client.settings.get({})).toEqual({
			"review.confidenceThreshold": 0.75,
			"review.requireCategory": true,
			"review.requireIssuer": true,
			"reminders.expiryLeadDays": [90, 30, 7],
			"asn.autoAssign": "never",
			"content.locale": "en-GB",
		});

		const updated = await client.settings.set({
			key: "review.confidenceThreshold",
			value: 0.5,
		});
		expect(updated["review.confidenceThreshold"]).toBe(0.5);

		expect(
			(
				await client.settings.set({ key: "review.requireIssuer", value: false })
			)["review.requireIssuer"],
		).toBe(false);
	});

	test("rejects a value that does not match the key", async () => {
		await expectOrpcError(
			client.settings.set({ key: "review.confidenceThreshold", value: 2 }),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			client.settings.set({ key: "review.requireCategory", value: "yes" }),
			"BAD_REQUEST",
		);
	});

	test("asn.autoAssign only accepts its three modes", async () => {
		expect(
			(await client.settings.set({ key: "asn.autoAssign", value: "scans" }))[
				"asn.autoAssign"
			],
		).toBe("scans");
		expect(
			(await client.settings.set({ key: "asn.autoAssign", value: "always" }))[
				"asn.autoAssign"
			],
		).toBe("always");

		await expectOrpcError(
			client.settings.set({ key: "asn.autoAssign", value: "sometimes" }),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			client.settings.set({ key: "asn.autoAssign", value: true }),
			"BAD_REQUEST",
		);
		// The rejected write left the last valid value in place.
		expect((await client.settings.get({}))["asn.autoAssign"]).toBe("always");
	});

	test("rejects an unknown key", async () => {
		await expectOrpcError(
			// @ts-expect-error key outside the enum
			client.settings.set({ key: "review.unknown", value: true }),
			"BAD_REQUEST",
		);
	});
});

describe("review.rejectAssignment — manual assignments", () => {
	/** Turns every automatic assignment of the seeded document into a manual one. */
	async function makeManual(documentId: string): Promise<void> {
		await db
			.update(document)
			.set({ categorySource: "manual", categoryConfidence: null })
			.where(eq(document.id, documentId));
		await db
			.update(documentParty)
			.set({ source: "manual", confidence: null })
			.where(eq(documentParty.documentId, documentId));
		await db
			.update(documentTag)
			.set({ source: "manual", confidence: null })
			.where(eq(documentTag.documentId, documentId));
		await db
			.update(documentFieldValue)
			.set({ source: "manual", confidence: null })
			.where(eq(documentFieldValue.documentId, documentId));
	}

	test("a manual category is kept, not cleared", async () => {
		const { documentId, categoryId } = await seedReviewDocument();
		await makeManual(documentId);

		const error = await expectOrpcError(
			client.review.rejectAssignment({ id: documentId, kind: "category" }),
			"BAD_REQUEST",
		);
		expect(error.message).toBe(
			"This assignment was set manually; edit it instead.",
		);

		const detail = await client.document.get({ id: documentId });
		expect(detail.categoryId).toBe(categoryId);
	});

	test("a manual Party, tag or field is kept too", async () => {
		const { documentId, partyId, tagId, fieldId } = await seedReviewDocument();
		await makeManual(documentId);

		for (const input of [
			{ kind: "party" as const, ref: partyId },
			{ kind: "tag" as const, ref: tagId },
			{ kind: "field" as const, ref: fieldId },
		]) {
			await expectOrpcError(
				client.review.rejectAssignment({ id: documentId, ...input }),
				"BAD_REQUEST",
			);
		}

		const detail = await client.document.get({ id: documentId });
		expect(detail.parties).toHaveLength(1);
		expect(detail.tags).toHaveLength(1);
		expect(detail.fieldValues).toHaveLength(1);
	});

	test("an assignment that does not exist is a 404, never a silent no-op", async () => {
		const { documentId } = await seedReviewDocument();
		await expectOrpcError(
			client.review.rejectAssignment({
				id: documentId,
				kind: "tag",
				ref: "tag_absent",
			}),
			"NOT_FOUND",
		);
	});

	test("an automatic category is still rejected", async () => {
		const { documentId } = await seedReviewDocument();
		const detail = await client.review.rejectAssignment({
			id: documentId,
			kind: "category",
		});
		expect(detail.categoryId).toBeNull();
	});
});

describe("review.approve — unfinished documents", () => {
	test("refuses a document still processing, and a failed one", async () => {
		for (const status of ["processing", "failed"] as const) {
			const { documentId } = await seedReviewDocument(`-${status}`);
			await db
				.update(document)
				.set({ status })
				.where(eq(document.id, documentId));

			await expectOrpcError(
				client.review.approve({ id: documentId }),
				"CONFLICT",
			);

			// The batch reports them instead of approving them.
			expect(await client.review.approveMany({ ids: [documentId] })).toEqual({
				approved: 0,
				failed: [documentId],
			});
		}
	});

	test("refuses a document that is not in the queue", async () => {
		for (const status of ["active", "archived"] as const) {
			const { documentId } = await seedReviewDocument(`-${status}`);
			await db
				.update(document)
				.set({ status })
				.where(eq(document.id, documentId));

			// Silently succeeding here reads as "your review was recorded" on a
			// document nobody reviewed.
			const error = await expectOrpcError(
				client.review.approve({ id: documentId }),
				"BAD_REQUEST",
			);
			expect(error.message).toBe("Document is not in review.");

			expect(await client.review.approveMany({ ids: [documentId] })).toEqual({
				approved: 0,
				failed: [documentId],
			});
		}
	});
});

describe("review.requeue — the trash stays read-only", () => {
	test("reprocessing a trashed document is refused", async () => {
		const { documentId } = await seedReviewDocument();
		await db
			.update(document)
			.set({ deletedAt: new Date() })
			.where(eq(document.id, documentId));

		const error = await expectOrpcError(
			client.review.requeue({ id: documentId }),
			"CONFLICT",
		);
		expect(error.message).toBe("Document is in the trash; restore it first.");

		// Same guard on the document route, which shares the service.
		await expectOrpcError(
			client.document.reprocess({ id: documentId }),
			"CONFLICT",
		);

		// The status is left alone: nothing was queued.
		const rows = await db
			.select({ status: document.status })
			.from(document)
			.where(eq(document.id, documentId));
		expect(rows[0]?.status).toBe("review");
	});
});

describe("review reasons after a manual edit", () => {
	test("setCategory drops `missingCategory` and reactivates the document", async () => {
		const { documentId, categoryId } = await seedReviewDocument();
		await db
			.update(document)
			.set({
				categoryId: null,
				reviewReasons: [
					{
						code: "missingCategory",
						message: "No category.",
						field: "category",
					},
				],
			})
			.where(eq(document.id, documentId));

		const detail = await client.document.setCategory({
			id: documentId,
			categoryId,
		});
		expect(detail.reviewReasons).toEqual([]);
		expect(detail.status).toBe("active");
	});

	test("setParties drops `missingIssuer` and the low-confidence issuer reason", async () => {
		const { documentId, partyId } = await seedReviewDocument();
		await db
			.update(document)
			.set({
				reviewReasons: [
					{ code: "missingIssuer", message: "No issuer.", field: "issuer" },
					{
						code: "lowConfidence",
						message: "Issuer suggested automatically.",
						confidence: 0.7,
						field: "issuer",
					},
				],
			})
			.where(eq(document.id, documentId));

		const detail = await client.document.setParties({
			id: documentId,
			parties: [{ partyId, role: "issuer" }],
		});
		expect(detail.reviewReasons).toEqual([]);
		expect(detail.status).toBe("active");
	});

	test("a blocking reason left over keeps the document in review", async () => {
		const { documentId, categoryId } = await seedReviewDocument();
		await db
			.update(document)
			.set({
				categoryId: null,
				reviewReasons: [
					{
						code: "missingCategory",
						message: "No category.",
						field: "category",
					},
					{ code: "missingIssuer", message: "No issuer.", field: "issuer" },
				],
			})
			.where(eq(document.id, documentId));
		await db
			.delete(documentParty)
			.where(eq(documentParty.documentId, documentId));

		const detail = await client.document.setCategory({
			id: documentId,
			categoryId,
		});
		expect(detail.reviewReasons.map((reason) => reason.code)).toEqual([
			"missingIssuer",
		]);
		expect(detail.status).toBe("review");
	});
});
