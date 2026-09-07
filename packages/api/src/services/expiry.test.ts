import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { document } from "@docstore/db/schema/document";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { FUTURE_EXPIRY_MESSAGE } from "@docstore/shared/common";
import { createTestUser, expectOrpcError, type TestUser } from "../test-utils";
import { createApiKey } from "./api-key.service";
import { assertFutureExpiry } from "./expiry";
import { createShareLink } from "./share-link.service";
import { createUploadLink, updateUploadLink } from "./upload-link.service";

/**
 * Every credential-like object refuses an expiry that has already passed.
 *
 * The shared Zod inputs carry the rule, but the MCP tools declare their own
 * input schemas and call the services directly: these tests go through the
 * services for exactly that reason — an oRPC-only guard is a guard with a hole
 * in it.
 */

let db: TestDb;
let owner: TestUser;

beforeAll(async () => {
	db = await createTestDb();
	process.env.PUBLIC_URL ||= "http://127.0.0.1:3000";
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
});

const past = () => new Date(Date.now() - 60_000).toISOString();
const future = () => new Date(Date.now() + 60_000).toISOString();

async function seedDocument(): Promise<string> {
	const rows = await db
		.insert(document)
		.values({ title: "Invoice", status: "active", createdById: owner.id })
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

describe("assertFutureExpiry", () => {
	test("accepts an absent expiry and refuses a stale one", () => {
		const now = new Date("2026-09-06T12:00:00.000Z");
		expect(() => assertFutureExpiry(null, now)).not.toThrow();
		expect(() => assertFutureExpiry(undefined, now)).not.toThrow();
		expect(() =>
			assertFutureExpiry("2026-09-06T12:00:01.000Z", now),
		).not.toThrow();
		// The instant itself is already gone.
		expect(() => assertFutureExpiry("2026-09-06T12:00:00.000Z", now)).toThrow(
			FUTURE_EXPIRY_MESSAGE,
		);
		expect(() => assertFutureExpiry("not a date", now)).toThrow();
	});
});

describe("expiry guards in the services", () => {
	test("shareLink.create refuses a past expiry", async () => {
		const documentId = await seedDocument();
		const error = await expectOrpcError(
			createShareLink(db, owner.id, {
				documentId,
				expiresAt: past(),
				allowDownload: true,
			}),
			"BAD_REQUEST",
		);
		expect(error.message).toBe(FUTURE_EXPIRY_MESSAGE);

		const { link } = await createShareLink(db, owner.id, {
			documentId,
			expiresAt: future(),
			allowDownload: true,
		});
		expect(link.expiresAt).not.toBeNull();
	});

	test("uploadLink.create and update refuse a past expiry", async () => {
		await expectOrpcError(
			createUploadLink(db, owner.id, {
				name: "Send me the deed",
				expiresAt: past(),
				defaults: {},
				enabled: true,
			}),
			"BAD_REQUEST",
		);

		const { link } = await createUploadLink(db, owner.id, {
			name: "Send me the deed",
			expiresAt: future(),
			defaults: {},
			enabled: true,
		});
		await expectOrpcError(
			updateUploadLink(db, { id: link.id, expiresAt: past() }),
			"BAD_REQUEST",
		);
	});

	test("apiKey.create refuses a past expiry", async () => {
		await expectOrpcError(
			createApiKey(db, owner.id, {
				name: "Agent",
				scopes: ["read"],
				expiresAt: past(),
			}),
			"BAD_REQUEST",
		);

		const created = await createApiKey(db, owner.id, {
			name: "Agent",
			scopes: ["read"],
			expiresAt: future(),
		});
		expect(created.key.expiresAt).not.toBeNull();
	});
});
