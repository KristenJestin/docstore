import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { activityLog } from "@docstore/db/schema/activity";
import { apiKey } from "@docstore/db/schema/api-key";
import { document } from "@docstore/db/schema/document";
import { tag } from "@docstore/db/schema/tag";
import { webhook } from "@docstore/db/schema/webhook";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import {
	type IngestionContext,
	type IngestionQueue,
	settleActivityReads,
	type WebhookDeliverPayload,
} from "@docstore/ingestion";
import type { ActivityEntry } from "@docstore/shared/activity";
import type { ApiKeyScope } from "@docstore/shared/api-key";
import {
	WEBHOOK_EVENTS,
	type WebhookDocumentEvent,
} from "@docstore/shared/webhook";
import { eq } from "drizzle-orm";
import { resetSessionReadDedup } from "../services/activity.service";
import {
	createApiKey,
	LAST_USED_THROTTLE_MS,
	resolveApiKey,
} from "../services/api-key.service";
import { addDocumentTag } from "../services/document.service";
import { bindDocumentEvents } from "../services/document-events";
import { createParty } from "../services/party.service";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

/**
 * Issue #15: "tell which API key did what". Every change is logged next to the
 * document events, under the key or the user of the request (or `system`),
 * with a short summary; reads are traced too (decision D-02 of the issue);
 * the webhooks name the actor; keys record when they were last used.
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
	await settleActivityReads();
	await truncateAll(db);
	resetSessionReadDedup();
	owner = await createTestUser(db, { name: "Kris" });
	published.length = 0;
	await db.insert(webhook).values({
		name: "Life wiki",
		url: "http://127.0.0.1:9/hook",
		secret: "shared-signing-secret",
		events: [...WEBHOOK_EVENTS],
		enabled: true,
	});
});

async function seedDocument(
	title: string,
	options: { sensitive?: boolean; content?: string } = {},
): Promise<string> {
	const [row] = await db
		.insert(document)
		.values({
			title,
			status: "active",
			createdById: owner.id,
			sensitive: options.sensitive ?? false,
			content: options.content ?? null,
		})
		.returning({ id: document.id });
	if (!row) throw new Error("document was not inserted");
	return row.id;
}

async function seedTag(name: string): Promise<string> {
	const [row] = await db.insert(tag).values({ name }).returning({ id: tag.id });
	if (!row) throw new Error("tag was not inserted");
	return row.id;
}

async function seedKey(
	name: string,
	scopes: ApiKeyScope[] = ["read", "write"],
): Promise<{ id: string; scopes: ApiKeyScope[]; secret: string }> {
	const created = await createApiKey(db, owner.id, { name, scopes });
	return { id: created.key.id, scopes, secret: created.secret };
}

/** Changes of the log, oldest first, the key creations left out. */
async function changes(): Promise<ActivityEntry[]> {
	const page = await createTestClient(db, owner).activity.list({
		kind: "change",
		pageSize: 100,
	});
	return page.items.filter((entry) => entry.objectType !== "api_key").reverse();
}

async function reads(): Promise<ActivityEntry[]> {
	await settleActivityReads();
	const page = await createTestClient(db, owner).activity.list({
		kind: "read",
		pageSize: 100,
	});
	return page.items.reverse();
}

describe("requirement: one entry per change, whatever the surface", () => {
	test("a document tagged with key wiki-arch is logged under wiki-arch, with the tag added", async () => {
		const key = await seedKey("wiki-arch");
		const documentId = await seedDocument("EDF invoice");
		const tagId = await seedTag("energy");

		await createTestClient(db, owner, key).document.addTag({
			id: documentId,
			tagId,
		});

		const [entry] = await changes();
		expect(entry?.action).toBe("document.tagged");
		expect(entry?.actor).toEqual({
			type: "api_key",
			userId: owner.id,
			apiKeyId: key.id,
			name: "wiki-arch",
		});
		expect(entry?.objectType).toBe("document");
		expect(entry?.objectId).toBe(documentId);
		expect(entry?.objectLabel).toBe("EDF invoice");
		expect(entry?.summary).toEqual({
			added: [{ id: tagId, name: "energy" }],
			removed: [],
		});
	});

	test("a change from a browser session is logged under the user, without a key", async () => {
		const documentId = await seedDocument("Lease");

		await createTestClient(db, owner).document.trash({ id: documentId });

		const [entry] = await changes();
		expect(entry?.action).toBe("document.trashed");
		expect(entry?.actor).toEqual({
			type: "user",
			userId: owner.id,
			apiKeyId: null,
			name: "Kris",
		});
	});

	test("a change made outside any request (pipeline, rules) is logged as system", async () => {
		const documentId = await seedDocument("Payslip");
		const tagId = await seedTag("salary");

		await addDocumentTag(db, documentId, tagId);

		const [entry] = await changes();
		expect(entry?.action).toBe("document.tagged");
		expect(entry?.actor).toEqual({
			type: "system",
			userId: null,
			apiKeyId: null,
			name: "system",
		});
	});

	test("the summary keeps the fields before and after, never the text of the notes", async () => {
		const documentId = await seedDocument("Scan 0042", {
			content: "IBAN FR76 3000 6000 0112 3456 7890 189",
		});

		await createTestClient(db, owner).document.update({
			id: documentId,
			title: "Bank statement",
			notes: "My secret thoughts",
		});

		const [entry] = await changes();
		expect(entry?.action).toBe("document.updated");
		expect(entry?.summary).toEqual({
			fields: {
				title: { before: "Scan 0042", after: "Bank statement" },
				notes: { changed: true },
			},
		});
		const raw = JSON.stringify(entry);
		expect(raw).not.toContain("secret thoughts");
		expect(raw).not.toContain("FR76");
	});

	test("an operation that fails writes no entry", async () => {
		const key = await seedKey("wiki-arch");
		const documentId = await seedDocument("Lease");

		await expectOrpcError(
			createTestClient(db, owner, key).document.addTag({
				id: documentId,
				tagId: "tag_missing",
			}),
			"NOT_FOUND",
		);

		expect(await changes()).toEqual([]);
	});

	test("a party merge is logged on the party, and each retagged document names it as the cause", async () => {
		const documentId = await seedDocument("Invoice");
		const source = await createParty(db, {
			type: "company",
			name: "EDF SA",
			aliases: [],
			identifiers: {},
			isHouseholdMember: false,
		});
		const target = await createParty(db, {
			type: "company",
			name: "EDF",
			aliases: [],
			identifiers: {},
			isHouseholdMember: false,
		});
		const client = createTestClient(db, owner);
		await client.document.addParty({
			id: documentId,
			partyId: source.id,
			role: "issuer",
		});
		await db.delete(activityLog);

		await client.party.mergeInto({ sourceId: source.id, targetId: target.id });

		const entries = await changes();
		expect(entries.map((entry) => entry.action)).toEqual([
			"party.merged",
			"document.updated",
		]);
		expect(entries[0]?.objectId).toBe(target.id);
		expect(entries[0]?.summary).toMatchObject({
			source: { id: source.id, name: "EDF SA" },
			documents: 1,
		});
		expect(entries[1]?.objectId).toBe(documentId);
		expect(entries[1]?.summary).toEqual({ via: "party.merged" });
	});

	test("a deleted key keeps its entries, still named", async () => {
		const key = await seedKey("hermes");
		const documentId = await seedDocument("Lease");
		await createTestClient(db, owner, key).document.trash({ id: documentId });

		await createTestClient(db, owner).apiKey.delete({ id: key.id });

		const [entry] = await changes();
		expect(entry?.actor.apiKeyId).toBe(key.id);
		expect(entry?.actor.name).toBe("hermes");
	});
});

describe("requirement: the log is readable and filterable", () => {
	test("activity.list filters by since, actorKeyId, objectId and action, newest first", async () => {
		const arch = await seedKey("wiki-arch");
		const windows = await seedKey("wiki-windows");
		const first = await seedDocument("First");
		const second = await seedDocument("Second");
		const third = await seedDocument("Third");
		const tagId = await seedTag("energy");

		await createTestClient(db, owner, arch).document.addTag({
			id: first,
			tagId,
		});
		const since = new Date().toISOString();
		await createTestClient(db, owner, arch).document.trash({ id: second });
		await createTestClient(db, owner, windows).document.addTag({
			id: third,
			tagId,
		});

		const client = createTestClient(db, owner);
		const byKey = await client.activity.list({ actorKeyId: arch.id });
		expect(byKey.items.map((entry) => entry.action)).toEqual([
			"document.trashed",
			"document.tagged",
		]);
		expect(byKey.total).toBe(2);

		const recent = await client.activity.list({
			since,
			action: "document.",
		});
		expect(recent.items.map((entry) => entry.actor.name)).toEqual([
			"wiki-windows",
			"wiki-arch",
		]);

		const onThird = await client.activity.list({
			objectId: third,
			action: "document.tagged",
		});
		expect(onThird.items).toHaveLength(1);
		expect(onThird.items[0]?.actor.apiKeyId).toBe(windows.id);

		const paged = await client.activity.list({ page: 2, pageSize: 1 });
		expect(paged.page).toBe(2);
		expect(paged.items).toHaveLength(1);
	});

	test("a key without the read scope cannot list the activity", async () => {
		const key = await seedKey("writer", ["write"]);
		await expectOrpcError(
			createTestClient(db, owner, key).activity.list({}),
			"FORBIDDEN",
		);
	});
});

describe("requirement: reads are traced (D-02)", () => {
	test("a document read by an API key is logged with the sensitive flag", async () => {
		const key = await seedKey("wiki-arch", ["read", "sensitive"]);
		const documentId = await seedDocument("Blood test", { sensitive: true });

		const client = createTestClient(db, owner, key);
		await client.document.get({ id: documentId });
		await client.document.get({ id: documentId });

		const entries = await reads();
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			action: "document.read",
			objectId: documentId,
			sensitive: true,
			actor: { type: "api_key", apiKeyId: key.id, name: "wiki-arch" },
		});

		const sensitiveByKeys = await createTestClient(db, owner).activity.list({
			kind: "read",
			sensitive: true,
			actorType: "api_key",
		});
		expect(sensitiveByKeys.total).toBe(2);
	});

	test("a document read by a browser session is logged once per minute", async () => {
		const documentId = await seedDocument("Lease");
		const client = createTestClient(db, owner);

		await client.document.get({ id: documentId });
		await client.document.get({ id: documentId });

		const entries = await reads();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			action: "document.read",
			sensitive: false,
			actor: { type: "user", userId: owner.id, apiKeyId: null },
		});
	});

	test("a search by an API key logs the query and filters, not the results; a session search is not logged", async () => {
		const key = await seedKey("wiki-arch");
		await seedDocument("EDF invoice", { content: "Électricité" });

		await createTestClient(db, owner, key).document.list({
			query: "électricité",
			year: 2026,
		});
		await createTestClient(db, owner).document.list({ query: "edf" });

		const entries = await reads();
		expect(entries).toHaveLength(1);
		expect(entries[0]?.action).toBe("search.performed");
		expect(entries[0]?.summary).toMatchObject({
			query: "électricité",
			year: 2026,
			total: 0,
		});
		expect(JSON.stringify(entries[0])).not.toContain("EDF invoice");
	});
});

describe("requirement: webhooks name the actor", () => {
	test("document.updated carries the key id for a key, and null for a browser session", async () => {
		const key = await seedKey("wiki-arch");
		const documentId = await seedDocument("Lease");
		const tagId = await seedTag("home");

		await createTestClient(db, owner, key).document.addTag({
			id: documentId,
			tagId,
		});
		await createTestClient(db, owner).document.removeTag({
			id: documentId,
			tagId,
		});

		const bodies = published.map(
			(item) => item.payload as WebhookDocumentEvent,
		);
		expect(bodies.map((body) => body.event)).toEqual([
			"document.updated",
			"document.updated",
		]);
		expect(bodies[0]?.actor).toEqual({
			type: "api_key",
			userId: owner.id,
			apiKeyId: key.id,
			name: "wiki-arch",
		});
		expect(bodies[1]?.actor.apiKeyId).toBeNull();
		expect(bodies[1]?.actor.type).toBe("user");
	});
});

describe("requirement: keys record when and from where they were last used", () => {
	test("lastUsedAt and the last IP are refreshed at most once a minute, and returned by apiKey.list", async () => {
		const key = await seedKey("wiki-arch");
		const start = new Date("2026-09-29T10:00:00.000Z");

		await resolveApiKey(db, key.secret, start, "203.0.113.7");
		await resolveApiKey(
			db,
			key.secret,
			new Date(start.getTime() + 30_000),
			"203.0.113.8",
		);

		const [row] = await db.select().from(apiKey).where(eq(apiKey.id, key.id));
		expect(row?.lastUsedAt?.toISOString()).toBe(start.toISOString());
		expect(row?.lastUsedIp).toBe("203.0.113.7");

		const later = new Date(start.getTime() + LAST_USED_THROTTLE_MS);
		await resolveApiKey(db, key.secret, later, "203.0.113.8");

		const [listed] = await createTestClient(db, owner).apiKey.list({});
		expect(listed?.lastUsedAt?.toISOString()).toBe(later.toISOString());
		expect(listed?.lastUsedIp).toBe("203.0.113.8");
	});
});
