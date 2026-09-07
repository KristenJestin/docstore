import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { intakeLog, intakeSource } from "@docstore/db/schema/intake";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import type { FolderConfig } from "@docstore/shared/intake";
import { eq } from "drizzle-orm";
import type { IngestionContext } from "./context";
import { purgeIntakeLogs } from "./intake-log";
import {
	dispatchIntakePolls,
	intakeOwnerId,
	runIntakeSource,
} from "./intake-source";
import {
	createTestIngestion,
	insertTestUser,
	type TestIngestion,
} from "./test-utils";

/**
 * `intake.poll` dispatcher and `intake_log` log.
 *
 * Without a queue in the context, `dispatchIntakePolls` publishes nothing but
 * returns the list of elected sources: exactly the decision we want to test.
 */

let db: TestDb;
let ingestion: TestIngestion;
let ctx: IngestionContext;
let userId: string;

const NOW = new Date("2026-03-04T12:00:00.000Z");

beforeAll(async () => {
	db = await createTestDb();
	ingestion = await createTestIngestion(db);
	ctx = ingestion.ctx;
});

afterAll(async () => {
	await ingestion.cleanup();
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	userId = await insertTestUser(db);
});

async function insertSource(options: {
	name: string;
	enabled?: boolean;
	pollSeconds?: number;
	lastRunAt?: Date | null;
}): Promise<string> {
	const config: FolderConfig = {
		type: "folder",
		path: "/data/inbox",
		recursive: false,
		pollSeconds: options.pollSeconds ?? 60,
		afterImport: "keep",
	};
	const rows = await db
		.insert(intakeSource)
		.values({
			type: "folder",
			name: options.name,
			enabled: options.enabled ?? true,
			config,
			defaults: {},
			stats: { imported: 0, duplicates: 0, errors: 0 },
			lastRunAt: options.lastRunAt ?? null,
		})
		.returning();
	const row = rows[0];
	if (!row) throw new Error("source not created");
	return row.id;
}

describe("dispatchIntakePolls", () => {
	test("only elects the enabled and due sources", async () => {
		const neverPolled = await insertSource({ name: "Never polled" });
		const overdue = await insertSource({
			name: "Due",
			pollSeconds: 60,
			lastRunAt: new Date(NOW.getTime() - 5 * 60_000),
		});
		await insertSource({
			name: "Too recent",
			pollSeconds: 3600,
			lastRunAt: new Date(NOW.getTime() - 60_000),
		});
		await insertSource({ name: "Disabled", enabled: false });

		const dispatched = await dispatchIntakePolls(ctx, NOW);

		expect(dispatched.map((item) => item.sourceId).sort()).toEqual(
			[neverPolled, overdue].sort(),
		);
		// No queue in the test context: nothing is published.
		expect(dispatched.every((item) => item.jobId === null)).toBe(true);
		expect(dispatched.every((item) => item.type === "folder")).toBe(true);
	});

	test("returns nothing when no source is configured", async () => {
		expect(await dispatchIntakePolls(ctx, NOW)).toEqual([]);
	});
});

describe("intakeOwnerId", () => {
	test("designates the oldest account", async () => {
		expect(await intakeOwnerId(db)).toBe(userId);
	});

	test("returns null when the database has no user", async () => {
		await truncateAll(db);
		expect(await intakeOwnerId(db)).toBeNull();
	});
});

describe("runIntakeSource", () => {
	test("ignores an unknown source without throwing", async () => {
		const result = await runIntakeSource(ctx, "src_unknown");
		expect(result).toEqual({
			imported: 0,
			duplicates: 0,
			errors: 0,
			skipped: 0,
		});
	});

	test("reports the missing user in `lastError`", async () => {
		const sourceId = await insertSource({ name: "Scanner" });
		// The source cannot be destroyed by the truncate: we only remove the user
		// by starting from an empty database and recreating it.
		await truncateAll(db);
		const orphan = await insertSource({ name: "Scanner" });

		const result = await runIntakeSource(ctx, orphan);
		expect(result.imported).toBe(0);
		expect(sourceId).not.toBe(orphan);

		const [row] = await db
			.select()
			.from(intakeSource)
			.where(eq(intakeSource.id, orphan));
		expect(row?.lastError).toContain("No user");
	});
});

describe("purgeIntakeLogs", () => {
	test("deletes the rows beyond the retention window", async () => {
		const sourceId = await insertSource({ name: "Scanner" });
		await db.insert(intakeLog).values([
			{
				sourceId,
				filename: "old.pdf",
				outcome: "imported",
				createdAt: new Date(Date.now() - 40 * 24 * 3600 * 1000),
			},
			{ sourceId, filename: "recent.pdf", outcome: "imported" },
		]);

		expect(await purgeIntakeLogs(db)).toBe(1);
		const remaining = await db.select().from(intakeLog);
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.filename).toBe("recent.pdf");
	});
});
