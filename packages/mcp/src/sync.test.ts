import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mergeAsVersion } from "@docstore/api/services/document.service";
import { bindDocumentEvents } from "@docstore/api/services/document-events";
import { document } from "@docstore/db/schema/document";
import { documentTag, tag } from "@docstore/db/schema/tag";
import { webhook, webhookDelivery } from "@docstore/db/schema/webhook";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import {
	deliverWebhook,
	type IngestionContext,
	type IngestionQueue,
	type WebhookDeliverPayload,
} from "@docstore/ingestion";
import { WEBHOOK_EVENTS } from "@docstore/shared/webhook";
import {
	createMcpTestClient,
	insertTestUser,
	type McpTestHarness,
} from "./test-utils";

/**
 * Issue #3, "How we will know it is done": an agent stores the max
 * `updatedAt` it saw, a tag is added through MCP, a document is trashed and
 * another merged; the next `updatedSince` query returns exactly those
 * documents, and one webhook per change was delivered (`webhook_delivery`).
 */

type SummaryItem = { id: string; updatedAt: string; deletedAt: string | null };
type SearchPage = { items: SummaryItem[]; total: number };

let db: TestDb;
let ctx: IngestionContext;
let unbind: () => void;
let userId: string;
let harness: McpTestHarness | undefined;
const published: WebhookDeliverPayload[] = [];

/** The jobs are kept, then delivered by hand: no pg-boss worker needed. */
const queue = {
	publishWebhookDeliver: async (payload: WebhookDeliverPayload) => {
		published.push(payload);
		return "job_webhook";
	},
} as unknown as IngestionQueue;

beforeAll(async () => {
	db = await createTestDb();
	ctx = { db, queue } as unknown as IngestionContext;
	unbind = bindDocumentEvents(ctx);
});

afterAll(async () => {
	unbind();
	await harness?.close();
	await db.$client.end();
});

beforeEach(async () => {
	await harness?.close();
	harness = undefined;
	await truncateAll(db);
	userId = await insertTestUser(db);
	published.length = 0;
});

function structured<T>(result: unknown): T {
	return (result as { structuredContent?: unknown }).structuredContent as T;
}

async function seedDocument(title: string, updatedAt: Date): Promise<string> {
	const rows = await db
		.insert(document)
		.values({ title, status: "active", createdById: userId, updatedAt })
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document was not inserted");
	return id;
}

describe("scenario: an agent syncs incrementally", () => {
	test("the next updatedSince query returns exactly the changed documents, and one webhook per change is delivered", async () => {
		const received: string[] = [];
		const server = Bun.serve({
			port: 0,
			fetch: async (request) => {
				received.push(request.headers.get("X-Docstore-Event") ?? "");
				await request.text();
				return new Response("ok");
			},
		});
		try {
			await db.insert(webhook).values({
				name: "Life wiki",
				url: `http://127.0.0.1:${server.port}/hook`,
				secret: "shared-signing-secret",
				events: [...WEBHOOK_EVENTS],
				enabled: true,
			});

			const before = new Date("2026-09-01T08:00:00.000Z");
			const lease = await seedDocument("Lease", before);
			const scan = await seedDocument("Old scan", before);
			const copy = await seedDocument("Invoice (copy)", before);
			const invoice = await seedDocument("Invoice", before);
			const untouched = await seedDocument("Passport", before);
			const urgentRows = await db
				.insert(tag)
				.values({ name: "urgent" })
				.returning({ id: tag.id });
			const urgent = urgentRows[0]?.id ?? "";
			const homeRows = await db
				.insert(tag)
				.values({ name: "home" })
				.returning({ id: tag.id });
			const home = homeRows[0]?.id ?? "";
			await db
				.insert(documentTag)
				.values({ documentId: lease, tagId: home, source: "manual" });

			harness = await createMcpTestClient({
				db,
				userId,
				scopes: ["read", "write"],
			});
			const { client } = harness;

			// First visit: the agent reads everything and keeps the max updatedAt.
			const first = structured<SearchPage>(
				await client.callTool({
					name: "search_documents",
					arguments: { updatedSince: "2000-01-01T00:00:00.000Z" },
				}),
			);
			expect(first.total).toBe(5);
			const cursor = first.items
				.map((item) => item.updatedAt)
				.sort()
				.at(-1);
			expect(cursor).toBe(before.toISOString());

			// A tag is added through MCP.
			await client.callTool({
				name: "set_document_tags",
				arguments: { id: lease, tagIds: [home, urgent] },
			});
			// A document is trashed (MCP).
			await client.callTool({
				name: "trash_document",
				arguments: { id: scan },
			});
			// Another is merged (the service behind `document.mergeAsVersion`).
			await mergeAsVersion(db, { documentId: copy, intoDocumentId: invoice });

			// Next visit.
			const next = structured<SearchPage>(
				await client.callTool({
					name: "search_documents",
					arguments: { updatedSince: cursor },
				}),
			);
			const changed = next.items.map((item) => item.id);
			// The kept document of the merge changed too: it gained the files and
			// the `version_of` relation.
			expect([...changed].sort()).toEqual([lease, scan, copy, invoice].sort());
			expect(changed).not.toContain(untouched);
			const byId = new Map(next.items.map((item) => [item.id, item]));
			expect(byId.get(scan)?.deletedAt).not.toBeNull();
			expect(byId.get(copy)?.deletedAt).not.toBeNull();
			expect(byId.get(lease)?.deletedAt).toBeNull();

			// One webhook per change, delivered and logged.
			for (const job of published) {
				await deliverWebhook(ctx, job);
			}
			const deliveries = await db
				.select({
					event: webhookDelivery.event,
					payload: webhookDelivery.payload,
					statusCode: webhookDelivery.statusCode,
				})
				.from(webhookDelivery);
			const logged = deliveries
				.map((row) => {
					const body = row.payload as { document: { id: string } };
					return `${row.event} ${body.document.id}`;
				})
				.sort();
			expect(logged).toEqual(
				[
					`document.updated ${lease}`,
					`document.trashed ${scan}`,
					`document.merged ${copy}`,
					`document.updated ${invoice}`,
				].sort(),
			);
			expect(deliveries.every((row) => row.statusCode === 200)).toBe(true);
			expect(received).toHaveLength(4);

			// The agent's next cursor comes from the last item; nothing is left.
			const last = next.items.at(-1);
			const after = structured<SearchPage>(
				await client.callTool({
					name: "search_documents",
					arguments: { updatedSince: last?.updatedAt, afterId: last?.id },
				}),
			);
			expect(after.items).toEqual([]);
		} finally {
			server.stop(true);
		}
	});
});
