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
import {
	document,
	documentFile,
	documentParty,
} from "@docstore/db/schema/document";
import { documentTombstone } from "@docstore/db/schema/document-tombstone";
import { documentTag, tag } from "@docstore/db/schema/tag";
import { webhook } from "@docstore/db/schema/webhook";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type {
	IngestionContext,
	IngestionQueue,
	WebhookDeliverPayload,
} from "@docstore/ingestion";
import type {
	DocumentStatus,
	ListDocumentsInput,
} from "@docstore/shared/document";
import { createDocumentTypeInput } from "@docstore/shared/document-type";
import {
	WEBHOOK_EVENTS,
	type WebhookDocumentEvent,
} from "@docstore/shared/webhook";
import { eq, inArray } from "drizzle-orm";
import { createTestUser, expectOrpcError, type TestUser } from "../test-utils";
import { deleteCategory, updateCategory } from "./category.service";
import { deleteCustomField } from "./custom-field.service";
import {
	addDocumentParty,
	addDocumentTag,
	assignAsn,
	bulkDocuments,
	clearDocumentFieldValue,
	deleteDocumentPermanently,
	listDocuments,
	mergeAsVersion,
	removeDocumentParty,
	removeDocumentTag,
	restoreDocument,
	setDocumentCategory,
	setDocumentFieldValue,
	setDocumentParties,
	setDocumentTags,
	trashDocument,
	updateDocument,
} from "./document.service";
import { bindDocumentEvents } from "./document-events";
import { resolveDocumentId } from "./document-resolution.service";
import {
	applyDocumentType,
	createDocumentType,
	setDocumentOverride,
} from "./document-type.service";
import {
	addDossierDocuments,
	createDossier,
	deleteDossier,
	removeDossierDocument,
} from "./dossier.service";
import { createParty, mergeParties, updateParty } from "./party.service";
import { addRelation, removeRelation } from "./relation.service";
import { approveReview, rejectAssignment } from "./review.service";
import { deleteTag, mergeTags, updateTag } from "./tag.service";

/**
 * Issue #3: an agent keeping notes about the library asks "what changed since
 * my last visit?" (`updatedSince`), and is told about every change (webhooks
 * emitted by the services, whatever the surface).
 */

let db: TestDb;
let owner: TestUser;
let unbind: () => void;
/** Every `webhook.deliver` job the services published. */
const published: WebhookDeliverPayload[] = [];

/** Queue stub: the delivery itself is covered by `@docstore/ingestion`. */
const queue = {
	publishWebhookDeliver: async (payload: WebhookDeliverPayload) => {
		published.push(payload);
		return "job_webhook";
	},
} as unknown as IngestionQueue;

beforeAll(async () => {
	db = await createTestDb();
	unbind = bindDocumentEvents({ db, queue } as unknown as IngestionContext);
});

afterAll(async () => {
	unbind();
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
	published.length = 0;
	// One subscriber to everything: each published job is one event.
	await db.insert(webhook).values({
		name: "Life wiki",
		url: "http://127.0.0.1:9/hook",
		secret: "shared-signing-secret",
		events: [...WEBHOOK_EVENTS],
		enabled: true,
	});
});

/** No `sort`: the service picks the one that fits the cursor. */
const listDefaults: ListDocumentsInput = {
	deleted: "exclude",
	page: 1,
	pageSize: 25,
};

/** Well before anything the tests do. */
const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");

async function seedDocument(
	title: string,
	options: {
		updatedAt?: Date;
		status?: DocumentStatus;
		content?: string;
		deletedAt?: Date;
	} = {},
): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title,
			status: options.status ?? "active",
			content: options.content ?? null,
			createdById: owner.id,
			updatedAt: options.updatedAt ?? LONG_AGO,
			deletedAt: options.deletedAt ?? null,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document was not inserted");
	return id;
}

async function seedTag(name: string): Promise<string> {
	const rows = await db.insert(tag).values({ name }).returning({ id: tag.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("tag was not inserted");
	return id;
}

async function seedCategory(name: string): Promise<string> {
	const rows = await db
		.insert(category)
		.values({ name, slug: name.toLowerCase() })
		.returning({ id: category.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("category was not inserted");
	return id;
}

async function seedParty(name: string): Promise<string> {
	const created = await createParty(db, {
		type: "company",
		name,
		aliases: [],
		identifiers: {},
		isHouseholdMember: false,
	});
	return created.id;
}

async function seedField(name: string): Promise<string> {
	const rows = await db
		.insert(customField)
		.values({ name, slug: name.toLowerCase(), type: "text" })
		.returning({ id: customField.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("custom field was not inserted");
	return id;
}

/** Puts the documents back in the past, so that any bump shows. */
async function backdate(...ids: string[]): Promise<void> {
	await db
		.update(document)
		.set({ updatedAt: LONG_AGO })
		.where(inArray(document.id, ids));
	published.length = 0;
}

async function updatedAtOf(id: string): Promise<Date> {
	const [row] = await db
		.select({ updatedAt: document.updatedAt })
		.from(document)
		.where(eq(document.id, id));
	if (!row) throw new Error(`document ${id} is gone`);
	return row.updatedAt;
}

async function expectBumped(...ids: string[]): Promise<void> {
	for (const id of ids) {
		expect((await updatedAtOf(id)).getTime()).toBeGreaterThan(
			LONG_AGO.getTime(),
		);
	}
}

/** `"<event> <documentId>"` of every published delivery, in order. */
function events(): string[] {
	return published.map((item) => {
		const body = item.payload as WebhookDocumentEvent;
		return `${item.event} ${body.document.id}`;
	});
}

function bodyOf(index: number): WebhookDocumentEvent {
	const item = published[index];
	if (!item) throw new Error(`no delivery #${index}`);
	return item.payload as WebhookDocumentEvent;
}

describe("requirement 1: incremental listing with updatedSince", () => {
	test("returns only the documents changed after the cursor, oldest change first", async () => {
		await seedDocument("Seen", {
			updatedAt: new Date("2026-09-01T10:00:00.000Z"),
		});
		const late = await seedDocument("Late", {
			updatedAt: new Date("2026-09-03T10:00:00.000Z"),
		});
		const early = await seedDocument("Early", {
			updatedAt: new Date("2026-09-02T10:00:00.000Z"),
		});

		const page = await listDocuments(db, {
			...listDefaults,
			updatedSince: "2026-09-01T10:00:00.000Z",
		});

		// Strictly after: the document carrying the cursor itself is not repeated.
		expect(page.items.map((item) => item.id)).toEqual([early, late]);
		expect(page.items.map((item) => item.updatedAt.toISOString())).toEqual([
			"2026-09-02T10:00:00.000Z",
			"2026-09-03T10:00:00.000Z",
		]);
	});

	test("includes trashed documents, with their status and deletedAt", async () => {
		const trashed = await seedDocument("Dropped", {
			updatedAt: new Date("2026-09-02T10:00:00.000Z"),
			deletedAt: new Date("2026-09-02T10:00:00.000Z"),
		});
		const live = await seedDocument("Kept", {
			updatedAt: new Date("2026-09-03T10:00:00.000Z"),
		});

		const page = await listDocuments(db, {
			...listDefaults,
			updatedSince: "2026-09-01T00:00:00.000Z",
		});
		expect(page.items.map((item) => item.id)).toEqual([trashed, live]);
		expect(page.items[0]?.deletedAt?.toISOString()).toBe(
			"2026-09-02T10:00:00.000Z",
		);
		expect(page.items[0]?.status).toBe("active");

		// `deleted: "only"` still narrows the sync to the trash.
		const onlyTrash = await listDocuments(db, {
			...listDefaults,
			deleted: "only",
			updatedSince: "2026-09-01T00:00:00.000Z",
		});
		expect(onlyTrash.items.map((item) => item.id)).toEqual([trashed]);

		// Without a cursor, the trash stays out as before.
		const plain = await listDocuments(db, listDefaults);
		expect(plain.items.map((item) => item.id)).toEqual([live]);
	});

	test("afterId walks through documents a bulk action stamped at the same instant", async () => {
		const ids = [
			await seedDocument("A"),
			await seedDocument("B"),
			await seedDocument("C"),
		];
		const urgent = await seedTag("urgent");
		await bulkDocuments(db, {
			ids,
			action: { type: "addTags", tagIds: [urgent] },
		});
		const stamps = new Set(
			await Promise.all(
				ids.map(async (id) => (await updatedAtOf(id)).getTime()),
			),
		);
		// One statement, one instant: this is the case the tie-breaker is for.
		expect(stamps.size).toBe(1);

		const seen: string[] = [];
		let cursor = { updatedSince: LONG_AGO.toISOString() } as {
			updatedSince: string;
			afterId?: string;
		};
		for (let round = 0; round < 5; round += 1) {
			const page = await listDocuments(db, {
				...listDefaults,
				pageSize: 1,
				...cursor,
			});
			const last = page.items.at(-1);
			if (!last) break;
			seen.push(last.id);
			cursor = {
				updatedSince: last.updatedAt.toISOString(),
				afterId: last.id,
			};
		}
		expect(seen).toEqual([...ids].sort());
	});

	test("the cursor order wins over full-text ranking", async () => {
		const second = await seedDocument("Invoice two", {
			content: "invoice invoice invoice",
			updatedAt: new Date("2026-09-03T10:00:00.000Z"),
		});
		const first = await seedDocument("Invoice one", {
			content: "invoice",
			updatedAt: new Date("2026-09-02T10:00:00.000Z"),
		});

		const page = await listDocuments(db, {
			...listDefaults,
			query: "invoice",
			updatedSince: "2026-09-01T00:00:00.000Z",
		});
		expect(page.items.map((item) => item.id)).toEqual([first, second]);
	});

	test("with updatedSince, a sort other than updatedAt:asc is refused", async () => {
		for (const sort of [
			"documentDate:desc",
			"title:desc",
			"updatedAt:desc",
		] as const) {
			await expectOrpcError(
				listDocuments(db, {
					...listDefaults,
					sort,
					updatedSince: "2026-09-01T00:00:00.000Z",
				}),
				"BAD_REQUEST",
			);
		}
	});

	test("with updatedSince, sort updatedAt:asc is accepted", async () => {
		const id = await seedDocument("Late", {
			updatedAt: new Date("2026-09-02T10:00:00.000Z"),
		});
		const page = await listDocuments(db, {
			...listDefaults,
			sort: "updatedAt:asc",
			updatedSince: "2026-09-01T00:00:00.000Z",
		});
		expect(page.items.map((item) => item.id)).toEqual([id]);
	});

	test("a cursor with an offset designates the same instant", async () => {
		const after = await seedDocument("After", {
			updatedAt: new Date("2026-09-02T10:00:00.001Z"),
		});
		await seedDocument("At", {
			updatedAt: new Date("2026-09-02T10:00:00.000Z"),
		});

		const page = await listDocuments(db, {
			...listDefaults,
			updatedSince: "2026-09-02T12:00:00.000+02:00",
		});
		expect(page.items.map((item) => item.id)).toEqual([after]);
	});

	test("afterId without updatedSince is refused", async () => {
		await expectOrpcError(
			listDocuments(db, { ...listDefaults, afterId: "doc_x" }),
			"BAD_REQUEST",
		);
	});

	test("sorts on updatedAt both ways without a cursor", async () => {
		const old = await seedDocument("Old", {
			updatedAt: new Date("2026-09-01T10:00:00.000Z"),
		});
		const fresh = await seedDocument("Fresh", {
			updatedAt: new Date("2026-09-02T10:00:00.000Z"),
		});

		const desc = await listDocuments(db, {
			...listDefaults,
			sort: "updatedAt:desc",
		});
		expect(desc.items.map((item) => item.id)).toEqual([fresh, old]);
		const asc = await listDocuments(db, {
			...listDefaults,
			sort: "updatedAt:asc",
		});
		expect(asc.items.map((item) => item.id)).toEqual([old, fresh]);
	});
});

describe("requirement 2: every change bumps updated_at", () => {
	test("metadata", async () => {
		const id = await seedDocument("Lease");
		await updateDocument(db, id, { title: "Lease 2026" });
		await expectBumped(id);
	});

	test("category", async () => {
		const id = await seedDocument("Lease");
		await setDocumentCategory(db, id, await seedCategory("Housing"));
		await expectBumped(id);
	});

	test("tags: replace, add and remove", async () => {
		const id = await seedDocument("Lease");
		const urgent = await seedTag("urgent");
		await setDocumentTags(db, id, [urgent]);
		await expectBumped(id);

		const home = await seedTag("home");
		await backdate(id);
		await addDocumentTag(db, id, home);
		await expectBumped(id);

		await backdate(id);
		await removeDocumentTag(db, id, home);
		await expectBumped(id);
	});

	test("parties: replace, add and remove", async () => {
		const id = await seedDocument("Invoice");
		const edf = await seedParty("EDF");
		await setDocumentParties(db, id, [{ partyId: edf, role: "issuer" }]);
		await expectBumped(id);

		const engie = await seedParty("Engie");
		await backdate(id);
		await addDocumentParty(db, id, engie, "subject");
		await expectBumped(id);

		await backdate(id);
		await removeDocumentParty(db, id, engie, "subject");
		await expectBumped(id);
	});

	test("custom field values: set and clear", async () => {
		const id = await seedDocument("Invoice");
		const field = await seedField("Reference");
		await setDocumentFieldValue(db, id, field, { kind: "text", text: "A-1" });
		await expectBumped(id);

		await backdate(id);
		await clearDocumentFieldValue(db, id, field);
		await expectBumped(id);
	});

	test("document type: applied, then forced or excluded", async () => {
		const id = await seedDocument("Invoice");
		const type = await createDocumentType(
			db,
			createDocumentTypeInput.parse({ name: "Electricity bill" }),
		);
		await applyDocumentType(db, {
			documentTypeId: type.id,
			documentIds: [id],
			force: true,
		});
		await expectBumped(id);

		await backdate(id);
		await setDocumentOverride(db, {
			documentTypeId: type.id,
			documentId: id,
			included: false,
		});
		await expectBumped(id);
	});

	test("dossiers: filed, pulled out, dossier deleted", async () => {
		const id = await seedDocument("Lease");
		const housing = await createDossier(db, { name: "Housing" });
		await addDossierDocuments(db, { id: housing.id, documentIds: [id] });
		await expectBumped(id);

		await backdate(id);
		await removeDossierDocument(db, { id: housing.id, documentId: id });
		await expectBumped(id);

		await addDossierDocuments(db, { id: housing.id, documentIds: [id] });
		await backdate(id);
		await deleteDossier(db, housing.id);
		await expectBumped(id);
	});

	test("relations: both ends, added and removed", async () => {
		const from = await seedDocument("Amendment");
		const to = await seedDocument("Contract");
		const relation = await addRelation(db, {
			fromDocumentId: from,
			toDocumentId: to,
			kind: "related_to",
		});
		await expectBumped(from, to);

		await backdate(from, to);
		await removeRelation(db, relation.id);
		await expectBumped(from, to);
	});

	test("files: the kept document of a merge gains them", async () => {
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await db.insert(documentFile).values({
			documentId: duplicate,
			kind: "original",
			filename: "copy.pdf",
			mime: "application/pdf",
			size: 10,
			sha256: "copy-sha",
			storageKey: "docs/copy.pdf",
		});

		await mergeAsVersion(db, { documentId: duplicate, intoDocumentId: kept });
		await expectBumped(kept, duplicate);
	});

	test("sensitive flag", async () => {
		const id = await seedDocument("Blood test");
		await updateDocument(db, id, { sensitive: true });
		await expectBumped(id);
	});

	test("review approval and rejection", async () => {
		const id = await seedDocument("Payslip", { status: "review" });
		const guessed = await seedTag("salary");
		await db.insert(documentParty).values({
			documentId: id,
			partyId: await seedParty("ACME"),
			role: "issuer",
			source: "rule",
			confidence: 0.4,
		});
		await db.insert(documentTag).values({
			documentId: id,
			tagId: guessed,
			source: "rule",
			confidence: 0.4,
		});

		await rejectAssignment(db, { id, kind: "tag", ref: guessed });
		await expectBumped(id);

		await backdate(id);
		await approveReview(db, id);
		await expectBumped(id);
	});

	test("trash and restore", async () => {
		const id = await seedDocument("Old scan");
		await trashDocument(db, id);
		await expectBumped(id);

		await backdate(id);
		await restoreDocument(db, id);
		await expectBumped(id);
	});

	test("bulk actions on tags and parties", async () => {
		const ids = [await seedDocument("A"), await seedDocument("B")];
		const urgent = await seedTag("urgent");
		await bulkDocuments(db, {
			ids,
			action: { type: "addTags", tagIds: [urgent] },
		});
		await expectBumped(...ids);

		await backdate(...ids);
		await bulkDocuments(db, {
			ids,
			action: { type: "removeTags", tagIds: [urgent] },
		});
		await expectBumped(...ids);

		await backdate(...ids);
		await bulkDocuments(db, {
			ids,
			action: {
				type: "addParty",
				partyId: await seedParty("EDF"),
				role: "issuer",
			},
		});
		await expectBumped(...ids);
	});

	test("archive number", async () => {
		const id = await seedDocument("Deed");
		await assignAsn(db, id);
		await expectBumped(id);
	});

	test("a tag, a Party, a field or a category deleted or merged away", async () => {
		const id = await seedDocument("Invoice");
		const housing = await seedCategory("Housing");
		const field = await seedField("Reference");
		const urgent = await seedTag("urgent");
		const important = await seedTag("important");
		const edf = await seedParty("EDF");
		const edfCopy = await seedParty("EDF SA");
		await setDocumentCategory(db, id, housing);
		await setDocumentFieldValue(db, id, field, { kind: "text", text: "A-1" });
		await setDocumentTags(db, id, [urgent, important]);
		await setDocumentParties(db, id, [{ partyId: edfCopy, role: "issuer" }]);

		await backdate(id);
		await mergeTags(db, { sourceId: urgent, targetId: important });
		await expectBumped(id);

		await backdate(id);
		await deleteTag(db, important);
		await expectBumped(id);

		await backdate(id);
		await mergeParties(db, { sourceId: edfCopy, targetId: edf });
		await expectBumped(id);

		await backdate(id);
		await deleteCustomField(db, field);
		await expectBumped(id);

		await backdate(id);
		await deleteCategory(db, { id: housing });
		await expectBumped(id);
	});
});

describe("requirement 3: webhooks cover every change, from the service layer", () => {
	test("tags set through the service MCP calls emit document.updated once", async () => {
		const id = await seedDocument("Lease");
		const urgent = await seedTag("urgent");
		const home = await seedTag("home");

		await setDocumentTags(db, id, [urgent, home]);

		expect(events()).toEqual([`document.updated ${id}`]);
		expect(published[0]?.webhookId).toBeTruthy();
	});

	test("an approval that also applies a patch is still one event", async () => {
		const id = await seedDocument("Payslip", { status: "review" });

		await approveReview(db, id, { title: "Payslip September" });

		expect(events()).toEqual([`document.updated ${id}`]);
	});

	test("trash, restore, permanent deletion and merge have their own events", async () => {
		const id = await seedDocument("Old scan");
		await trashDocument(db, id);
		// Already in the trash: nothing changes, nothing is announced.
		await trashDocument(db, id);
		await restoreDocument(db, id);
		await restoreDocument(db, id);
		expect(events()).toEqual([
			`document.trashed ${id}`,
			`document.restored ${id}`,
		]);

		published.length = 0;
		const title = "Old scan";
		await deleteDocumentPermanently(db, id);
		expect(events()).toEqual([`document.deleted ${id}`]);
		// The row is gone: the body carries the last known state.
		expect(bodyOf(0).document.title).toBe(title);

		published.length = 0;
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await mergeAsVersion(db, { documentId: duplicate, intoDocumentId: kept });
		expect(events()).toEqual([
			`document.merged ${duplicate}`,
			`document.updated ${kept}`,
		]);
		expect(bodyOf(0)).toMatchObject({
			event: "document.merged",
			keptDocumentId: kept,
			document: { id: duplicate },
		});
	});

	test("a bulk action emits one event per document it changed", async () => {
		const tagged = await seedDocument("A");
		const untagged = await seedDocument("B");
		const urgent = await seedTag("urgent");
		await setDocumentTags(db, tagged, [urgent]);
		published.length = 0;

		await bulkDocuments(db, {
			ids: [tagged, untagged],
			action: { type: "addTags", tagIds: [urgent] },
		});
		// `tagged` already carried the tag: it did not change.
		expect(events()).toEqual([`document.updated ${untagged}`]);

		published.length = 0;
		await bulkDocuments(db, {
			ids: [tagged, untagged],
			action: { type: "trash" },
		});
		expect(events().sort()).toEqual(
			[`document.trashed ${tagged}`, `document.trashed ${untagged}`].sort(),
		);
	});

	test("taxonomy changes notify every document they reach", async () => {
		const first = await seedDocument("A");
		const second = await seedDocument("B");
		const urgent = await seedTag("urgent");
		await setDocumentTags(db, first, [urgent]);
		await setDocumentTags(db, second, [urgent]);
		published.length = 0;

		await deleteTag(db, urgent);

		expect(events().sort()).toEqual(
			[`document.updated ${first}`, `document.updated ${second}`].sort(),
		);
	});

	test("renaming a tag, a Party or a category leaves its documents unchanged", async () => {
		const id = await seedDocument("Lease");
		const urgent = await seedTag("urgent");
		const landlord = await seedParty("Landlord");
		const housing = await seedCategory("Housing");
		await setDocumentTags(db, id, [urgent]);
		await addDocumentParty(db, id, landlord, "issuer");
		await setDocumentCategory(db, id, housing);
		await backdate(id);

		await updateTag(db, { id: urgent, name: "pressing" });
		await updateParty(db, landlord, { name: "Owner" });
		await updateCategory(db, { id: housing, name: "Home" });

		// The document points to them by id: it did not change (issue #14).
		expect((await updatedAtOf(id)).getTime()).toBe(LONG_AGO.getTime());
		expect(published).toEqual([]);
	});

	test("a failed operation emits nothing", async () => {
		const id = await seedDocument("Lease");
		await trashDocument(db, id);
		published.length = 0;

		// The trash is read-only: the update is refused.
		await expectOrpcError(
			updateDocument(db, id, { title: "Lease 2026" }),
			"CONFLICT",
		);
		expect(published).toEqual([]);
	});

	test("an update that changes nothing announces nothing", async () => {
		const id = await seedDocument("Lease");
		await updateDocument(db, id, {});
		expect(published).toEqual([]);
	});

	test("without a bound queue, the services stay silent", async () => {
		const id = await seedDocument("Lease");
		unbind();
		try {
			await updateDocument(db, id, { title: "Lease 2026" });
			expect(published).toEqual([]);
		} finally {
			unbind = bindDocumentEvents({ db, queue } as unknown as IngestionContext);
		}
	});
});

describe("requirement 4: the payload keeps its shape and adds updatedAt", () => {
	test("the summary carries the same updatedAt as the listing", async () => {
		const id = await seedDocument("Lease");
		await updateDocument(db, id, { title: "Lease 2026" });

		const body = bodyOf(0);
		expect(body.event).toBe("document.updated");
		expect(Object.keys(body.document).sort()).toEqual(
			[
				"categoryId",
				"createdAt",
				"deletedAt",
				"documentDate",
				"id",
				"reviewReasons",
				"sensitive",
				"source",
				"sourceRef",
				"status",
				"title",
				"updatedAt",
			].sort(),
		);

		const listed = await listDocuments(db, {
			...listDefaults,
			updatedSince: LONG_AGO.toISOString(),
		});
		expect(body.document.updatedAt).toBe(
			listed.items[0]?.updatedAt.toISOString() ?? "missing",
		);
	});
});

/** The tombstone of `id`, `null` when there is none. */
async function tombstoneOf(
	id: string,
): Promise<{ reason: string; mergedIntoId: string | null } | null> {
	const [row] = await db
		.select({
			reason: documentTombstone.reason,
			mergedIntoId: documentTombstone.mergedIntoId,
		})
		.from(documentTombstone)
		.where(eq(documentTombstone.documentId, id));
	return row ?? null;
}

describe("stable document ids (issue #2) agree with the document events", () => {
	test("document.merged names the document the merged id now leads to", async () => {
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await mergeAsVersion(db, { documentId: duplicate, intoDocumentId: kept });

		expect(bodyOf(0)).toMatchObject({
			event: "document.merged",
			keptDocumentId: kept,
		});
		expect(await tombstoneOf(duplicate)).toEqual({
			reason: "merged",
			mergedIntoId: kept,
		});
		expect(await resolveDocumentId(db, duplicate)).toEqual({
			id: kept,
			redirectedFrom: duplicate,
		});
		// The merge also moves the kept document for the sync cursor.
		await expectBumped(kept);
	});

	test("a chain of merges: each event names its kept document, older ids follow", async () => {
		const first = await seedDocument("Invoice v1");
		const second = await seedDocument("Invoice v2");
		const third = await seedDocument("Invoice v3");
		await mergeAsVersion(db, { documentId: first, intoDocumentId: second });
		published.length = 0;
		await mergeAsVersion(db, { documentId: second, intoDocumentId: third });

		expect(bodyOf(0)).toMatchObject({
			event: "document.merged",
			document: { id: second },
			keptDocumentId: third,
		});
		// The id merged earlier is pointed straight at the new kept document.
		expect(await tombstoneOf(first)).toEqual({
			reason: "merged",
			mergedIntoId: third,
		});
		expect((await resolveDocumentId(db, first)).id).toBe(third);
	});

	test("a permanent deletion emits document.deleted and leaves a deleted tombstone", async () => {
		const id = await seedDocument("Old scan");
		await trashDocument(db, id);
		published.length = 0;

		await deleteDocumentPermanently(db, id);

		expect(events()).toEqual([`document.deleted ${id}`]);
		expect(await tombstoneOf(id)).toEqual({
			reason: "deleted",
			mergedIntoId: null,
		});
		await expectOrpcError(resolveDocumentId(db, id), "GONE");
	});

	test("purging a merged document emits document.deleted and keeps its redirect", async () => {
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await mergeAsVersion(db, { documentId: duplicate, intoDocumentId: kept });
		published.length = 0;

		await deleteDocumentPermanently(db, duplicate);

		expect(events()).toEqual([`document.deleted ${duplicate}`]);
		expect(await tombstoneOf(duplicate)).toEqual({
			reason: "merged",
			mergedIntoId: kept,
		});
		expect((await resolveDocumentId(db, duplicate)).id).toBe(kept);
	});

	test("restoring a merged document emits document.restored and ends its redirect", async () => {
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await mergeAsVersion(db, { documentId: duplicate, intoDocumentId: kept });
		published.length = 0;

		await restoreDocument(db, duplicate);

		expect(events()).toEqual([`document.restored ${duplicate}`]);
		expect(await tombstoneOf(duplicate)).toBeNull();
		expect(await resolveDocumentId(db, duplicate)).toEqual({
			id: duplicate,
			redirectedFrom: null,
		});
	});

	test("a bulk restore does the same for every merged document it brings back", async () => {
		const kept = await seedDocument("Invoice");
		const duplicate = await seedDocument("Invoice (copy)");
		await mergeAsVersion(db, { documentId: duplicate, intoDocumentId: kept });
		published.length = 0;

		await bulkDocuments(db, {
			ids: [duplicate, kept],
			action: { type: "restore" },
		});

		// `kept` was not in the trash: neither restored nor announced.
		expect(events()).toEqual([`document.restored ${duplicate}`]);
		expect(await tombstoneOf(duplicate)).toBeNull();
	});
});
