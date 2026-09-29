import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resetSessionReadDedup } from "@docstore/api/services/activity.service";
import { createApiKey } from "@docstore/api/services/api-key.service";
import { bindDocumentEvents } from "@docstore/api/services/document-events";
import { createTestClient } from "@docstore/api/test-utils";
import { auth } from "@docstore/auth";
import { createId } from "@docstore/db/id";
import { user } from "@docstore/db/schema/auth";
import { tag } from "@docstore/db/schema/tag";
import { webhook } from "@docstore/db/schema/webhook";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import {
	createIngestionContext,
	type IngestionBinding,
	type IngestionQueue,
	intakeFile,
	isCreated,
	settleActivityReads,
	type WebhookDeliverPayload,
} from "@docstore/ingestion";
import {
	WEBHOOK_EVENTS,
	type WebhookDocumentEvent,
} from "@docstore/shared/webhook";
import { deriveStorageMasterKey } from "@docstore/storage";
import type { Hono } from "hono";
import { createApp } from "./app";

/**
 * Issue #15 end to end, through the real HTTP application: the MCP route, the
 * file routes and the export name the key that acted, and the key records its
 * last use.
 */

const PDF_PATH = fileURLToPath(
	new URL(
		"../../../packages/ocr/test/fixtures/text-layer.pdf",
		import.meta.url,
	),
);
const APP_SECRET = "activity-log-secret-activity-log-secret";
const ACCEPT = "application/json, text/event-stream";

let db: TestDb;
let app: Hono;
let owner: { id: string; name: string; email: string };
let pdf: Uint8Array;
let storageRoot: string;
let ingestion: IngestionBinding;
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
	pdf = new Uint8Array(await Bun.file(PDF_PATH).arrayBuffer());
	storageRoot = join(
		process.env.TEMP ?? "/tmp",
		`docstore-activity-test-${createId("")}`,
	);
});

afterAll(async () => {
	unbind?.();
	await db.$client.end();
});

beforeEach(async () => {
	await settleActivityReads();
	await truncateAll(db);
	resetSessionReadDedup();
	published.length = 0;

	owner = {
		id: createId("usr_"),
		name: "Kris",
		email: `${createId("")}@example.test`,
	};
	await db.insert(user).values(owner);
	await db.insert(webhook).values({
		name: "Life wiki",
		url: "http://127.0.0.1:9/hook",
		secret: "shared-signing-secret",
		events: [...WEBHOOK_EVENTS],
		enabled: true,
	});

	ingestion = {
		ctx: createIngestionContext({
			db,
			storagePath: storageRoot,
			tools: {
				tesseractPath: process.env.TESSERACT_PATH || undefined,
				tessdataPrefix: process.env.TESSDATA_PREFIX || undefined,
				popplerPath: process.env.POPPLER_PATH || undefined,
			},
			encryption: { masterKey: deriveStorageMasterKey(APP_SECRET) },
		}),
	};
	unbind?.();
	unbind = bindDocumentEvents({ ...ingestion.ctx, queue });

	app = createApp({
		db,
		auth,
		ingestion,
		corsOrigin: "http://127.0.0.1:3001",
		appSecret: APP_SECRET,
		logRequests: false,
	});
});

async function seedKey(
	name: string,
	scopes: ("read" | "write" | "sensitive" | "admin")[],
): Promise<{ id: string; secret: string }> {
	const created = await createApiKey(db, owner.id, { name, scopes });
	return { id: created.key.id, secret: created.secret };
}

/** Real intake of a unique PDF: every call yields a new sha256. */
async function seedDocument(
	options: { sensitive?: boolean } = {},
): Promise<{ documentId: string; fileId: string }> {
	const suffix = new TextEncoder().encode(`\n% ${createId("")}\n`);
	const bytes = new Uint8Array(pdf.byteLength + suffix.byteLength);
	bytes.set(pdf, 0);
	bytes.set(suffix, pdf.byteLength);
	const result = await intakeFile(ingestion.ctx, {
		data: bytes,
		filename: "invoice.pdf",
		mime: "application/pdf",
		createdById: owner.id,
		title: "EDF invoice",
		...(options.sensitive ? { defaults: { sensitive: true } } : {}),
	});
	if (!isCreated(result)) throw new Error("the fixture was not ingested");
	published.length = 0;
	return result;
}

/** JSON-RPC result of a tool call, whether answered as JSON or as SSE. */
async function callTool(
	secret: string,
	name: string,
	args: Record<string, unknown>,
): Promise<{ isError?: boolean; structuredContent?: Record<string, unknown> }> {
	const response = await app.request("/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: ACCEPT,
			Authorization: `Bearer ${secret}`,
			"X-Forwarded-For": "198.51.100.23",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name, arguments: args },
		}),
	});
	expect(response.status).toBe(200);
	const text = await response.text();
	const json = text.trimStart().startsWith("{")
		? text
		: (text
				.split("\n")
				.find((line) => line.startsWith("data:"))
				?.slice(5) ?? "{}");
	const body = JSON.parse(json) as {
		result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
	};
	if (!body.result) throw new Error(`no result: ${text}`);
	return body.result;
}

describe("How we will know it is done (issue #15)", () => {
	test("after an agent tags a document through MCP with key wiki-arch, the document page, the document.updated webhook, the Activity page and the key list all name wiki-arch", async () => {
		const key = await seedKey("wiki-arch", ["read", "write"]);
		const { documentId } = await seedDocument();
		const [energy] = await db
			.insert(tag)
			.values({ name: "energy" })
			.returning({ id: tag.id });
		if (!energy) throw new Error("tag was not inserted");

		const result = await callTool(key.secret, "set_document_tags", {
			id: documentId,
			tagIds: [energy.id],
		});
		expect(result.isError).toBeFalsy();

		// The web app, as a browser session.
		const web = createTestClient(db, owner);

		// The Activity section of the document page.
		const onDocument = await web.activity.list({
			objectId: documentId,
			kind: "change",
		});
		const tagged = onDocument.items.find(
			(entry) => entry.action === "document.tagged",
		);
		expect(tagged?.actor).toEqual({
			type: "api_key",
			userId: owner.id,
			apiKeyId: key.id,
			name: "wiki-arch",
		});
		expect(tagged?.summary).toEqual({
			added: [{ id: energy.id, name: "energy" }],
			removed: [],
		});

		// The `document.updated` webhook.
		const updated = published
			.map((item) => item.payload as WebhookDocumentEvent)
			.find((body) => body.event === "document.updated");
		expect(updated?.document.id).toBe(documentId);
		expect(updated?.actor.apiKeyId).toBe(key.id);
		expect(updated?.actor.name).toBe("wiki-arch");

		// The global Activity page, filtered on the key.
		const byKey = await web.activity.list({ actorKeyId: key.id });
		expect(byKey.items.map((entry) => entry.action)).toContain(
			"document.tagged",
		);

		// Settings → API keys: used a moment ago, from the client address.
		const keys = await web.apiKey.list({});
		const listed = keys.find((item) => item.id === key.id);
		expect(listed?.lastUsedAt).not.toBeNull();
		expect(Date.now() - (listed?.lastUsedAt?.getTime() ?? 0)).toBeLessThan(
			60_000,
		);
		expect(listed?.lastUsedIp).toBe("198.51.100.23");
	});

	test("list_activity with mine: true shows the agent what it did itself", async () => {
		const arch = await seedKey("wiki-arch", ["read", "write"]);
		const hermes = await seedKey("hermes", ["read", "write"]);
		const { documentId } = await seedDocument();

		await callTool(hermes.secret, "trash_document", { id: documentId });
		const result = await callTool(arch.secret, "list_activity", {
			mine: true,
		});
		expect(result.structuredContent?.total).toBe(0);

		const theirs = await callTool(hermes.secret, "list_activity", {
			mine: true,
			action: "document.",
		});
		const items = theirs.structuredContent?.items as {
			action: string;
			objectId: string;
			actor: { name: string };
		}[];
		expect(items.map((item) => item.action)).toEqual(["document.trashed"]);
		expect(items[0]?.objectId).toBe(documentId);
		expect(items[0]?.actor.name).toBe("hermes");
	});
});

describe("requirement: reads are traced (D-02)", () => {
	test("reading the text of a sensitive document through MCP is logged as a sensitive read, masked or not", async () => {
		const reader = await seedKey("wiki-arch", ["read"]);
		const trusted = await seedKey("hermes", ["read", "sensitive"]);
		const { documentId } = await seedDocument({ sensitive: true });

		await callTool(reader.secret, "get_document_text", { id: documentId });
		await callTool(trusted.secret, "get_document_text", { id: documentId });
		await settleActivityReads();

		const page = await createTestClient(db, owner).activity.list({
			action: "document.text_read",
			sensitive: true,
		});
		const byName = Object.fromEntries(
			page.items.map((entry) => [entry.actor.name, entry.summary.masked]),
		);
		expect(byName).toEqual({ "wiki-arch": true, hermes: false });
	});

	test("a download through /d/ by an API key is logged; a thumbnail is not", async () => {
		const key = await seedKey("wiki-arch", ["read"]);
		const { documentId, fileId } = await seedDocument();

		const download = await app.request(`/d/${documentId}`, {
			headers: { Authorization: `Bearer ${key.secret}` },
		});
		expect(download.status).toBe(200);
		await download.arrayBuffer();
		await app.request(`/files/${fileId}/thumbnail`, {
			headers: { Authorization: `Bearer ${key.secret}` },
		});
		await settleActivityReads();

		const page = await createTestClient(db, owner).activity.list({
			kind: "read",
		});
		expect(page.items).toHaveLength(1);
		expect(page.items[0]).toMatchObject({
			action: "document.downloaded",
			objectId: documentId,
			sensitive: false,
			actor: { apiKeyId: key.id, name: "wiki-arch" },
			summary: { fileId, filename: "invoice.pdf", route: "/d/:docId" },
		});
	});

	test("an export is logged with the ids of the documents it contains, not their files", async () => {
		const key = await seedKey("wiki-arch", ["read"]);
		const { documentId } = await seedDocument();

		const response = await app.request("/api/export", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${key.secret}`,
			},
			body: JSON.stringify({}),
		});
		expect(response.status).toBe(200);
		await response.arrayBuffer();
		await settleActivityReads();

		const page = await createTestClient(db, owner).activity.list({
			action: "export.downloaded",
		});
		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.actor.apiKeyId).toBe(key.id);
		expect(page.items[0]?.summary).toMatchObject({
			count: 1,
			documentIds: [documentId],
		});
	});
});
