import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { activityLog } from "@docstore/db/schema/activity";
import { document } from "@docstore/db/schema/document";
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
import type { ListDocumentsInput } from "@docstore/shared/document";
import { setExternalRefsInput } from "@docstore/shared/external-ref";
import {
	WEBHOOK_EVENTS,
	type WebhookDocumentEvent,
} from "@docstore/shared/webhook";
import { asc, eq, inArray } from "drizzle-orm";
import { createTestUser, expectOrpcError, type TestUser } from "../test-utils";
import {
	getDocument,
	listDocuments,
	mergeAsVersion,
	setDocumentExternalRefs,
	trashDocument,
} from "./document.service";
import { bindDocumentEvents } from "./document-events";

/**
 * Issue #4: a document knows which external notes (the life wiki) reference
 * it, and the wiki can list the documents it never cites.
 */

let db: TestDb;
let owner: TestUser;
let unbind: () => void;
const published: WebhookDeliverPayload[] = [];

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
	await db.insert(webhook).values({
		name: "Life wiki",
		url: "http://127.0.0.1:9/hook",
		secret: "shared-signing-secret",
		events: [...WEBHOOK_EVENTS],
		enabled: true,
	});
});

const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");
const EDF = "10-admin/12-logement/contrat-edf.md";

const listDefaults: ListDocumentsInput = {
	deleted: "exclude",
	page: 1,
	pageSize: 25,
	sort: "title:asc",
};

async function seedDocument(title: string): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title,
			status: "active",
			createdById: owner.id,
			updatedAt: LONG_AGO,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document was not inserted");
	return id;
}

async function backdate(...ids: string[]): Promise<void> {
	await db
		.update(document)
		.set({ updatedAt: LONG_AGO })
		.where(inArray(document.id, ids));
	published.length = 0;
	await db.delete(activityLog);
}

async function updatedAtOf(id: string): Promise<Date> {
	const [row] = await db
		.select({ updatedAt: document.updatedAt })
		.from(document)
		.where(eq(document.id, id));
	if (!row) throw new Error(`document ${id} is gone`);
	return row.updatedAt;
}

function events(): string[] {
	return published.map((item) => {
		const body = item.payload as WebhookDocumentEvent;
		return `${item.event} ${body.document.id}`;
	});
}

async function activity() {
	return db
		.select({
			action: activityLog.action,
			objectId: activityLog.objectId,
			summary: activityLog.summary,
		})
		.from(activityLog)
		.orderBy(asc(activityLog.createdAt));
}

async function titles(input: Partial<ListDocumentsInput>): Promise<string[]> {
	const page = await listDocuments(db, { ...listDefaults, ...input });
	return page.items.map((item) => item.title);
}

describe("requirement: a document carries the external notes that reference it", () => {
	test("WHEN the wiki declares a reference THEN document.get returns it with its url and label", async () => {
		const id = await seedDocument("EDF contract");

		await setDocumentExternalRefs(db, id, "wiki", [
			{
				ref: EDF,
				label: "Contrat EDF",
				url: "https://wiki.example/contrat-edf",
			},
		]);

		const detail = await getDocument(db, id);
		expect(
			detail.externalRefs.map(({ system, ref, url, label }) => ({
				system,
				ref,
				url,
				label,
			})),
		).toEqual([
			{
				system: "wiki",
				ref: EDF,
				url: "https://wiki.example/contrat-edf",
				label: "Contrat EDF",
			},
		]);
	});

	test("WHEN a system sets its references THEN the references of other systems are left alone, and an empty list clears only that system", async () => {
		const id = await seedDocument("EDF contract");
		await setDocumentExternalRefs(db, id, "notes", [{ ref: "n-1" }]);
		await setDocumentExternalRefs(db, id, "wiki", [
			{ ref: EDF },
			{ ref: "a.md" },
		]);

		let detail = await getDocument(db, id);
		expect(detail.externalRefs.map((item) => `${item.system}:${item.ref}`))
			// Ordered by system then ref.
			.toEqual(["notes:n-1", `wiki:${EDF}`, "wiki:a.md"]);

		await setDocumentExternalRefs(db, id, "wiki", [{ ref: "a.md" }]);
		detail = await getDocument(db, id);
		expect(
			detail.externalRefs.map((item) => `${item.system}:${item.ref}`),
		).toEqual(["notes:n-1", "wiki:a.md"]);

		await setDocumentExternalRefs(db, id, "wiki", []);
		detail = await getDocument(db, id);
		expect(
			detail.externalRefs.map((item) => `${item.system}:${item.ref}`),
		).toEqual(["notes:n-1"]);
	});

	test("WHEN the same ref is sent twice in one call THEN it is refused", async () => {
		const id = await seedDocument("EDF contract");
		await expectOrpcError(
			setDocumentExternalRefs(db, id, "wiki", [{ ref: EDF }, { ref: EDF }]),
			"BAD_REQUEST",
		);
		expect(
			setExternalRefsInput.safeParse({
				id,
				system: "wiki",
				refs: [{ ref: EDF }, { ref: EDF }],
			}).success,
		).toBe(false);
	});

	test("WHEN the system is not a lowercase slug or the url is not http(s) THEN the input is refused", () => {
		const base = { id: "doc_1", refs: [{ ref: EDF }] };
		expect(setExternalRefsInput.safeParse({ ...base, system: "wiki" }).success)
			// A valid call, for contrast.
			.toBe(true);
		expect(
			setExternalRefsInput.safeParse({ ...base, system: "Wiki" }).success,
		).toBe(false);
		expect(
			setExternalRefsInput.safeParse({ ...base, system: "my wiki" }).success,
		).toBe(false);
		expect(
			setExternalRefsInput.safeParse({
				...base,
				system: "wiki",
				refs: [{ ref: EDF, url: "javascript:alert(1)" }],
			}).success,
		).toBe(false);
	});

	test("WHEN the document is in the trash THEN setting its references is refused", async () => {
		const id = await seedDocument("EDF contract");
		await trashDocument(db, id);
		await expectOrpcError(
			setDocumentExternalRefs(db, id, "wiki", [{ ref: EDF }]),
			"CONFLICT",
		);
	});

	test("WHEN the document is permanently deleted THEN its references go with it", async () => {
		const id = await seedDocument("EDF contract");
		await setDocumentExternalRefs(db, id, "wiki", [{ ref: EDF }]);
		await db.delete(document).where(eq(document.id, id));
		expect(await titles({ referencedBy: "wiki" })).toEqual([]);
	});
});

describe("requirement: a change of references is a change of the document", () => {
	test("WHEN references change THEN updatedAt is bumped, document.updated is emitted and the activity log names the refs", async () => {
		const id = await seedDocument("EDF contract");
		await backdate(id);

		await setDocumentExternalRefs(db, id, "wiki", [
			{ ref: EDF, label: "Contrat EDF" },
		]);

		expect((await updatedAtOf(id)).getTime()).toBeGreaterThan(
			LONG_AGO.getTime(),
		);
		expect(events()).toEqual([`document.updated ${id}`]);
		expect(await activity()).toEqual([
			{
				action: "document.external_refs_set",
				objectId: id,
				summary: { system: "wiki", added: [{ name: EDF }], removed: [] },
			},
		]);
	});

	test("WHEN the same references are sent again THEN nothing is bumped, emitted or logged", async () => {
		const id = await seedDocument("EDF contract");
		await setDocumentExternalRefs(db, id, "wiki", [
			{ ref: EDF, label: "Contrat EDF" },
		]);
		await backdate(id);

		await setDocumentExternalRefs(db, id, "wiki", [
			{ ref: EDF, label: "Contrat EDF" },
		]);

		expect((await updatedAtOf(id)).getTime()).toBe(LONG_AGO.getTime());
		expect(events()).toEqual([]);
		expect(await activity()).toEqual([]);
	});

	test("WHEN only the label or url of a ref changes THEN it is a change, logged as updated", async () => {
		const id = await seedDocument("EDF contract");
		await setDocumentExternalRefs(db, id, "wiki", [{ ref: EDF }]);
		await backdate(id);

		await setDocumentExternalRefs(db, id, "wiki", [
			{ ref: EDF, label: "Contrat EDF" },
		]);

		expect(events()).toEqual([`document.updated ${id}`]);
		expect((await activity())[0]?.summary).toEqual({
			system: "wiki",
			added: [],
			removed: [],
			updated: [{ name: EDF }],
		});
		expect((await getDocument(db, id)).externalRefs[0]?.label).toBe(
			"Contrat EDF",
		);
	});

	test("WHEN references are removed THEN the activity log names the removed refs", async () => {
		const id = await seedDocument("EDF contract");
		await setDocumentExternalRefs(db, id, "wiki", [{ ref: EDF }]);
		await backdate(id);

		await setDocumentExternalRefs(db, id, "wiki", []);

		expect(events()).toEqual([`document.updated ${id}`]);
		expect((await activity())[0]?.summary).toEqual({
			system: "wiki",
			added: [],
			removed: [{ name: EDF }],
		});
	});
});

describe("requirement: documents filter on who references them", () => {
	test("WHEN filtering referencedBy / notReferencedBy a system THEN only the cited / uncited documents come back", async () => {
		const cited = await seedDocument("A cited");
		const other = await seedDocument("B cited elsewhere");
		await seedDocument("C uncited");
		await setDocumentExternalRefs(db, cited, "wiki", [{ ref: EDF }]);
		await setDocumentExternalRefs(db, other, "notes", [{ ref: "n-1" }]);

		expect(await titles({ referencedBy: "wiki" })).toEqual(["A cited"]);
		expect(await titles({ notReferencedBy: "wiki" })).toEqual([
			"B cited elsewhere",
			"C uncited",
		]);
		expect(await titles({ referencedBy: "notes" })).toEqual([
			"B cited elsewhere",
		]);
	});

	test("WHEN the wiki cites a document THEN notReferencedBy wiki no longer lists it", async () => {
		const id = await seedDocument("EDF contract");
		expect(await titles({ notReferencedBy: "wiki" })).toEqual(["EDF contract"]);

		await setDocumentExternalRefs(db, id, "wiki", [{ ref: EDF }]);

		expect(await titles({ notReferencedBy: "wiki" })).toEqual([]);
	});
});

describe("requirement: a merged document hands its references to the kept one", () => {
	test("WHEN a document is merged as a version THEN its references move to the kept document, a shared ref keeping the kept one's label", async () => {
		const kept = await seedDocument("EDF contract");
		const duplicate = await seedDocument("EDF contract (scan)");
		await setDocumentExternalRefs(db, kept, "wiki", [
			{ ref: EDF, label: "Kept label" },
		]);
		await setDocumentExternalRefs(db, duplicate, "wiki", [
			{ ref: EDF, label: "Duplicate label" },
			{ ref: "20-finance/energie.md" },
		]);

		await mergeAsVersion(db, {
			documentId: duplicate,
			intoDocumentId: kept,
		});

		const detail = await getDocument(db, kept);
		expect(detail.externalRefs.map((item) => [item.ref, item.label])).toEqual([
			[EDF, "Kept label"],
			["20-finance/energie.md", null],
		]);
		expect((await getDocument(db, duplicate)).externalRefs).toEqual([]);
	});
});
