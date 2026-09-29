import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { Db } from "@docstore/db";
import { activityLog } from "@docstore/db/schema/activity";
import { document } from "@docstore/db/schema/document";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { listActivityInput } from "@docstore/shared/activity";
import type { ListDocumentsInput } from "@docstore/shared/document";
import { eq, sql } from "drizzle-orm";
import { createTestUser, type TestUser } from "../test-utils";
import { listActivity } from "./activity.service";
import { listDocuments } from "./document.service";

/**
 * Issue #12: every timestamp column is `timestamptz`, so a value means the
 * same instant whatever the time zone of the Postgres session. `db` runs in
 * the server time zone (UTC); `paris` is a second connection to the same
 * database with `SET TIME ZONE 'Europe/Paris'` on every session.
 */

let db: TestDb;
let paris: Db & { $client: { end(): Promise<void> } };
let owner: TestUser;

function inParis(connectionString: string): string {
	const url = new URL(connectionString);
	url.searchParams.set("options", "-c TimeZone=Europe/Paris");
	return url.toString();
}

beforeAll(async () => {
	db = await createTestDb();
	// Imported once the test database exists, like `createTestDb` does: the
	// module validates the server environment when it is evaluated.
	const { createDb } = await import("@docstore/db");
	paris = createDb(inParis(db.connectionString)) as typeof paris;
});

afterAll(async () => {
	await paris.$client.end();
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
});

const listDefaults: ListDocumentsInput = {
	deleted: "exclude",
	page: 1,
	pageSize: 25,
	sort: "documentDate:desc",
};

async function updatedAtIn(target: Db, id: string): Promise<Date> {
	const [row] = await target
		.select({ updatedAt: document.updatedAt })
		.from(document)
		.where(eq(document.id, id));
	if (!row) throw new Error(`document ${id} is gone`);
	return row.updatedAt;
}

describe("a session with SET TIME ZONE 'Europe/Paris' reads and writes the same instants", () => {
	test("the Paris connection really runs in Europe/Paris", async () => {
		const shown = await paris.execute<{ TimeZone: string }>(
			sql`show time zone`,
		);
		expect(shown.rows[0]?.TimeZone).toBe("Europe/Paris");
	});

	test("an instant written from Paris reads back the same from UTC, and the other way round", async () => {
		const instant = new Date("2026-07-14T10:00:00.123Z");
		const [fromParis] = await paris
			.insert(document)
			.values({
				title: "Written in Paris",
				status: "active",
				createdById: owner.id,
				updatedAt: instant,
				deletedAt: instant,
			})
			.returning({ id: document.id });
		const [fromUtc] = await db
			.insert(document)
			.values({
				title: "Written in UTC",
				status: "active",
				createdById: owner.id,
				updatedAt: instant,
			})
			.returning({ id: document.id });
		if (!fromParis || !fromUtc) throw new Error("documents not inserted");

		for (const target of [db, paris]) {
			for (const id of [fromParis.id, fromUtc.id]) {
				expect((await updatedAtIn(target, id)).toISOString()).toBe(
					instant.toISOString(),
				);
			}
		}
		// Raw SQL compares instants, not wall-clock values.
		const same = await paris.execute<{ same: boolean }>(sql`
			select ${document.updatedAt} = '2026-07-14T12:00:00.123+02:00'::timestamptz as same
			from ${document} where ${document.id} = ${fromParis.id}
		`);
		expect(same.rows[0]?.same).toBe(true);
	});

	test("a default now() written from Paris is the current instant", async () => {
		const before = Date.now();
		const [row] = await paris
			.insert(document)
			.values({ title: "Defaulted", status: "active", createdById: owner.id })
			.returning({
				createdAt: document.createdAt,
				updatedAt: document.updatedAt,
			});
		const after = Date.now();
		if (!row) throw new Error("document not inserted");
		// A `timestamp` column would have stored the Paris wall clock: one or two
		// hours off.
		for (const value of [row.createdAt, row.updatedAt]) {
			expect(value.getTime()).toBeGreaterThanOrEqual(before - 1_000);
			expect(value.getTime()).toBeLessThanOrEqual(after + 1_000);
		}
		// The millisecond default of #7 holds in any time zone.
		const sub = await paris.execute<{ sub: string }>(sql`
			select extract(microseconds from ${document.updatedAt})::bigint % 1000 as sub
			from ${document}
		`);
		expect(Number(sub.rows[0]?.sub)).toBe(0);
	});

	test("the updatedSince cursor designates the same documents from both sessions", async () => {
		const at = new Date("2026-09-02T10:00:00.000Z");
		const after = new Date("2026-09-02T10:00:00.001Z");
		const [first] = await db
			.insert(document)
			.values([
				{ title: "At", status: "active", createdById: owner.id, updatedAt: at },
				{
					title: "After",
					status: "active",
					createdById: owner.id,
					updatedAt: after,
				},
			])
			.returning({ id: document.id });
		if (!first) throw new Error("documents not inserted");

		for (const target of [db, paris]) {
			const page = await listDocuments(target, {
				...listDefaults,
				updatedSince: "2026-09-02T12:00:00.000+02:00",
			});
			expect(page.items.map((item) => item.title)).toEqual(["After"]);
			expect(page.items[0]?.updatedAt.toISOString()).toBe(after.toISOString());

			// The `(updated_at, id)` keyset resumes on the exact instant it read.
			const resumed = await listDocuments(target, {
				...listDefaults,
				updatedSince: at.toISOString(),
				afterId: "doc_",
			});
			expect(resumed.items.map((item) => item.title).sort()).toEqual([
				"After",
				"At",
			]);
		}
	});

	test("the activity log windows mean the same instants from Paris", async () => {
		await paris.insert(activityLog).values([
			{
				createdAt: new Date("2026-09-02T09:59:59.999Z"),
				kind: "read",
				action: "document.list",
				actorType: "user",
				objectType: "document",
			},
			{
				createdAt: new Date("2026-09-02T10:00:00.000Z"),
				kind: "read",
				action: "document.get",
				actorType: "user",
				objectType: "document",
			},
		]);

		for (const target of [db, paris]) {
			const page = await listActivity(
				target,
				listActivityInput.parse({ since: "2026-09-02T12:00:00.000+02:00" }),
			);
			expect(page.items.map((item) => item.action)).toEqual(["document.get"]);
		}
	});
});
