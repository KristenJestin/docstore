import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { webhook, webhookDelivery } from "@docstore/db/schema/webhook";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import {
	WEBHOOK_EVENT_HEADER,
	WEBHOOK_SIGNATURE_HEADER,
} from "@docstore/shared/webhook";
import { asc, eq } from "drizzle-orm";
import type { IngestionContext } from "./context";
import { intakeFile } from "./intake";
import type { WebhookDeliverPayload } from "./jobs";
import type { IngestionQueue } from "./queue";
import { applyOperations } from "./rules";
import {
	createTestIngestion,
	FIXTURES,
	insertTestUser,
	readFixture,
	type TestIngestion,
} from "./test-utils";
import {
	deliverWebhook,
	signPayload,
	verifySignature,
	webhookDocumentSummary,
} from "./webhook";

let db: TestDb;
let ingestion: TestIngestion;
let ctx: IngestionContext;
let userId: string;
let pdf: Uint8Array;

const SECRET = "shared-signing-secret";

interface Received {
	body: string;
	event: string | null;
	signature: string | null;
}

/** Ephemeral HTTP server: port 0, stopped at the end of each test. */
function serve(handler: (received: Received) => Response): {
	url: string;
	received: Received[];
	stop: () => void;
} {
	const received: Received[] = [];
	const server = Bun.serve({
		port: 0,
		fetch: async (request) => {
			const entry: Received = {
				body: await request.text(),
				event: request.headers.get(WEBHOOK_EVENT_HEADER),
				signature: request.headers.get(WEBHOOK_SIGNATURE_HEADER),
			};
			received.push(entry);
			return handler(entry);
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}/hook`,
		received,
		stop: () => server.stop(true),
	};
}

beforeAll(async () => {
	db = await createTestDb();
	ingestion = await createTestIngestion(db);
	ctx = ingestion.ctx;
	pdf = await readFixture(FIXTURES.textLayerPdf);
});

afterAll(async () => {
	await ingestion.cleanup();
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	userId = await insertTestUser(db);
});

async function createWebhookRow(url: string): Promise<string> {
	const rows = await db
		.insert(webhook)
		.values({
			name: "Home Assistant",
			url,
			secret: SECRET,
			events: ["document.created", "document.processed"],
			enabled: true,
		})
		.returning();
	const row = rows[0];
	if (!row) throw new Error("webhook not created");
	return row.id;
}

describe("signPayload", () => {
	test("produces a verifiable signature and rejects a different key", () => {
		const body = JSON.stringify({ event: "ping" });
		const signature = signPayload(body, SECRET);
		expect(signature.startsWith("sha256=")).toBe(true);
		expect(verifySignature(body, SECRET, signature)).toBe(true);
		expect(verifySignature(body, "other-secret", signature)).toBe(false);
		expect(verifySignature(`${body} `, SECRET, signature)).toBe(false);
	});
});

describe("deliverWebhook", () => {
	test("posts the signed body and logs the delivery", async () => {
		const server = serve(() => new Response("ok", { status: 200 }));
		try {
			const webhookId = await createWebhookRow(server.url);
			const outcome = await deliverWebhook(ctx, {
				webhookId,
				event: "document.created",
				payload: { event: "document.created", document: { id: "doc_1" } },
			});

			expect(outcome.delivered).toBe(true);
			expect(outcome.statusCode).toBe(200);

			const call = server.received[0];
			if (!call) throw new Error("no call received");
			expect(call.event).toBe("document.created");
			expect(call.signature).not.toBeNull();
			// The consumer verifies exactly like this, on the receiving side.
			expect(verifySignature(call.body, SECRET, call.signature ?? "")).toBe(
				true,
			);
			expect(JSON.parse(call.body)).toMatchObject({
				event: "document.created",
			});

			const [delivery] = await db.select().from(webhookDelivery);
			expect(delivery?.statusCode).toBe(200);
			expect(delivery?.attempt).toBe(1);
			expect(delivery?.error).toBeNull();

			const [row] = await db
				.select()
				.from(webhook)
				.where(eq(webhook.id, webhookId));
			expect(row?.lastStatus).toBe(200);
			expect(row?.lastCalledAt).not.toBeNull();
		} finally {
			server.stop();
		}
	});

	test("replays after a 500 and records attempt 2", async () => {
		let calls = 0;
		const server = serve(() => {
			calls += 1;
			return calls === 1
				? new Response("boom", { status: 500 })
				: new Response("ok", { status: 200 });
		});
		try {
			const webhookId = await createWebhookRow(server.url);
			const payload = {
				webhookId,
				event: "document.processed",
				payload: { event: "document.processed" },
			};

			// First attempt: the target fails, `deliverWebhook` throws so that
			// pg-boss retries (retryLimit 5, retryBackoff).
			let failed: unknown;
			try {
				await deliverWebhook(ctx, payload, 1);
			} catch (error) {
				failed = error;
			}
			expect(failed).toBeInstanceOf(Error);

			// Retry, exactly as the worker would replay it.
			const outcome = await deliverWebhook(ctx, payload, 2);
			expect(outcome.delivered).toBe(true);

			const deliveries = await db
				.select()
				.from(webhookDelivery)
				.orderBy(asc(webhookDelivery.attempt));
			expect(deliveries).toHaveLength(2);
			expect(deliveries[0]?.attempt).toBe(1);
			expect(deliveries[0]?.statusCode).toBe(500);
			expect(deliveries[0]?.error).toBe("HTTP 500");
			expect(deliveries[1]?.attempt).toBe(2);
			expect(deliveries[1]?.statusCode).toBe(200);
			expect(deliveries[1]?.error).toBeNull();
		} finally {
			server.stop();
		}
	});

	test("logs the network failure without an HTTP code", async () => {
		// Closed port: the connection is refused before any response.
		const webhookId = await createWebhookRow("http://127.0.0.1:1/hook");
		let failed: unknown;
		try {
			await deliverWebhook(ctx, { webhookId, event: "ping", payload: {} });
		} catch (error) {
			failed = error;
		}
		expect(failed).toBeInstanceOf(Error);

		const [delivery] = await db.select().from(webhookDelivery);
		expect(delivery?.statusCode).toBeNull();
		expect(delivery?.error).toBeTruthy();
	});

	test("gives up without an error if the webhook was disabled meanwhile", async () => {
		const server = serve(() => new Response("ok", { status: 200 }));
		try {
			const webhookId = await createWebhookRow(server.url);
			await db
				.update(webhook)
				.set({ enabled: false })
				.where(eq(webhook.id, webhookId));

			const outcome = await deliverWebhook(ctx, {
				webhookId,
				event: "ping",
				payload: {},
			});
			expect(outcome.delivered).toBe(false);
			expect(server.received).toHaveLength(0);
			expect(await db.select().from(webhookDelivery)).toHaveLength(0);
		} finally {
			server.stop();
		}
	});

	test("delivers to an ad hoc URL (rule action) without a signature", async () => {
		const server = serve(() => new Response("ok", { status: 200 }));
		try {
			const outcome = await deliverWebhook(ctx, {
				url: server.url,
				event: "rule.webhook",
				payload: { event: "rule.webhook" },
			});
			expect(outcome.delivered).toBe(true);
			expect(server.received[0]?.signature).toBeNull();

			const [delivery] = await db.select().from(webhookDelivery);
			expect(delivery?.webhookId).toBeNull();
			expect(delivery?.event).toBe("rule.webhook");
		} finally {
			server.stop();
		}
	});
});

describe("webhookDocumentSummary", () => {
	test("summarizes a real document", async () => {
		const created = await intakeFile(ctx, {
			data: pdf,
			filename: "invoice.pdf",
			mime: "application/pdf",
			createdById: userId,
			source: "link",
			sourceRef: "ulk_test",
		});
		if (!created.documentId) throw new Error("document not created");

		const summary = await webhookDocumentSummary(db, created.documentId);
		expect(summary).toMatchObject({
			id: created.documentId,
			title: "invoice",
			status: "processing",
			source: "link",
			sourceRef: "ulk_test",
			sensitive: false,
			reviewReasons: [],
		});
		expect(await webhookDocumentSummary(db, "doc_missing")).toBeNull();
	});
});

describe("emitEvent", () => {
	/** Minimal queue: we only observe what is published. */
	function stubQueue(): {
		queue: IngestionQueue;
		published: WebhookDeliverPayload[];
	} {
		const published: WebhookDeliverPayload[] = [];
		const queue = {
			publishWebhookDeliver: async (payload: WebhookDeliverPayload) => {
				published.push(payload);
				return "job_webhook";
			},
			// `intakeFile` also publishes the document processing: the stub must
			// absorb it without doing anything with it.
			publishDocumentProcess: async () => "job_process",
		} as unknown as IngestionQueue;
		return { queue, published };
	}

	test("`document.created` is sent at intake, to the subscribers only", async () => {
		const { queue, published } = stubQueue();
		const subscriber = await createWebhookRow("http://127.0.0.1:9/subscriber");
		// Subscribed to another event: it must receive nothing.
		await db.insert(webhook).values({
			name: "Other",
			url: "http://127.0.0.1:9/other",
			secret: SECRET,
			events: ["reminder.due"],
			enabled: true,
		});

		const created = await intakeFile(
			{ ...ctx, queue },
			{
				data: pdf,
				filename: "invoice.pdf",
				mime: "application/pdf",
				createdById: userId,
				source: "folder",
				sourceRef: "src_1",
			},
		);

		const deliveries = published.filter(
			(item) => item.event === "document.created",
		);
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]?.webhookId).toBe(subscriber);
		expect(deliveries[0]?.payload).toMatchObject({
			event: "document.created",
			document: { id: created.documentId, source: "folder" },
		});
	});

	test("a disabled webhook receives nothing", async () => {
		const { queue, published } = stubQueue();
		const id = await createWebhookRow("http://127.0.0.1:9/subscriber");
		await db.update(webhook).set({ enabled: false }).where(eq(webhook.id, id));

		await intakeFile(
			{ ...ctx, queue },
			{
				data: pdf,
				filename: "invoice.pdf",
				mime: "application/pdf",
				createdById: userId,
			},
		);

		expect(published).toEqual([]);
	});

	test("the `webhook` rule action publishes an ad hoc delivery", async () => {
		const { queue, published } = stubQueue();
		const withQueue = { ...ctx, queue };
		const created = await intakeFile(withQueue, {
			data: pdf,
			filename: "invoice.pdf",
			mime: "application/pdf",
			createdById: userId,
		});
		if (!created.documentId) throw new Error("document not created");
		published.length = 0;

		const outcome = await applyOperations(
			db,
			created.documentId,
			[{ type: "webhook", url: "http://127.0.0.1:9/rule" }],
			{ ruleId: "rul_1", ingestion: withQueue },
		);

		expect(outcome.applied).toHaveLength(1);
		expect(published).toHaveLength(1);
		expect(published[0]).toMatchObject({
			url: "http://127.0.0.1:9/rule",
			event: "rule.webhook",
		});
		expect(published[0]?.webhookId).toBeUndefined();
	});

	test("without an ingestion context, the `webhook` action stays inert", async () => {
		const created = await intakeFile(ctx, {
			data: pdf,
			filename: "invoice.pdf",
			mime: "application/pdf",
			createdById: userId,
		});
		if (!created.documentId) throw new Error("document not created");

		const outcome = await applyOperations(
			db,
			created.documentId,
			[{ type: "webhook", url: "http://127.0.0.1:9/rule" }],
			{},
		);
		expect(outcome.applied).toEqual([]);
	});
});
