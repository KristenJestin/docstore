import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { document, documentFile } from "@docstore/db/schema/document";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import { thumbnailKey } from "@docstore/storage";
import { eq, sql } from "drizzle-orm";
import { intakeFile, isCreated } from "./intake";
import { REMINDERS_GENERATE_CRON } from "./jobs";
import { createQueue, type IngestionQueue, PGBOSS_SCHEMA } from "./queue";
import {
	createTestIngestion,
	FIXTURES,
	insertTestUser,
	readFixture,
	type TestIngestion,
} from "./test-utils";
import { type IngestionWorker, startWorker } from "./worker";

const TIMEOUT = 60_000;

let db: TestDb;
let ingestion: TestIngestion;
let queue: IngestionQueue;
let worker: IngestionWorker | undefined;
/** Number of times the `reminders.generate` job ran. */
let reminderRuns = 0;

beforeAll(async () => {
	db = await createTestDb();
	// pg-boss must live in the same database as the drizzle connection: the
	// per-package test database, not the raw `DATABASE_URL_TEST`.
	const connectionString = db.connectionString;
	queue = createQueue({ connectionString, max: 2 });
	await queue.start();
	ingestion = await createTestIngestion(db, {
		queue,
		// The reminder recomputation lives in `@docstore/api`: the worker only
		// knows the hook the server injects, so the test injects a spy.
		generateReminders: async () => {
			reminderRuns += 1;
			return { created: 0, updated: 0, removed: 0 };
		},
	});
	worker = await startWorker(ingestion.ctx, queue, {
		pollingIntervalSeconds: 1,
	});
	await truncateAll(db);
}, TIMEOUT);

afterAll(async () => {
	await worker?.stop();
	await queue.stop();
	// The pg-boss schema is not managed by the drizzle migrations: we drop it
	// explicitly to leave the test database clean.
	await db.execute(sql.raw(`drop schema if exists ${PGBOSS_SCHEMA} cascade`));
	await ingestion.cleanup();
	await db.$client.end();
}, TIMEOUT);

/** Waits for a condition to become true, by polling the database. */
async function waitFor<T>(
	read: () => Promise<T | undefined>,
	predicate: (value: T) => boolean,
	timeoutMs: number,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let last: T | undefined;
	while (Date.now() < deadline) {
		last = await read();
		if (last !== undefined && predicate(last)) return last;
		await Bun.sleep(250);
	}
	throw new Error(
		`Timed out (${timeoutMs} ms). Last value: ${JSON.stringify(last)}`,
	);
}

describe("worker pg-boss", () => {
	test(
		"an intake publishes a job processed end to end",
		async () => {
			const userId = await insertTestUser(db);
			const result = await intakeFile(ingestion.ctx, {
				data: await readFixture(FIXTURES.textLayerPdf),
				filename: "EDF Invoice.pdf",
				mime: "application/pdf",
				createdById: userId,
			});
			if (!isCreated(result)) throw new Error("expected a created document");

			const doc = await waitFor(
				async () => {
					const [row] = await db
						.select()
						.from(document)
						.where(eq(document.id, result.documentId));
					return row;
				},
				(row) => row.status !== "processing",
				TIMEOUT - 10_000,
			);

			// `analyze` finds neither category nor Issuer: Review queue.
			expect(doc.status).toBe("review");
			expect(doc.content).toContain("FACTURE");
			expect(doc.processingError).toBeNull();

			const [file] = await db
				.select()
				.from(documentFile)
				.where(eq(documentFile.id, result.fileId));
			expect(file?.pageCount).toBe(2);
			expect(file?.thumbnailKey).toBe(
				thumbnailKey(result.documentId, result.fileId),
			);
			expect(await ingestion.ctx.storage.exists(file?.thumbnailKey ?? "")).toBe(
				true,
			);
		},
		TIMEOUT,
	);

	test(
		"the startup publish reaches the reminders worker",
		async () => {
			const before = reminderRuns;
			const jobId = await queue.publishRemindersGenerate();
			expect(jobId).toBeTruthy();

			await waitFor(
				async () => reminderRuns,
				(runs) => runs > before,
				TIMEOUT - 10_000,
			);
		},
		TIMEOUT,
	);

	test("the daily cron is registered on the queue", async () => {
		const schedules = (await queue.boss.getSchedules()) as {
			name: string;
			cron: string;
		}[];
		const reminders = schedules.find(
			(row) => row.name === "reminders.generate",
		);
		expect(reminders?.cron).toBe(REMINDERS_GENERATE_CRON);
	});

	test("health exposes the state of the queue", async () => {
		const health = await queue.health();
		expect(health.started).toBe(true);
		expect(typeof health.pending).toBe("number");
	});
});
