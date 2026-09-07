import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { apiKey as apiKeyTable } from "@docstore/db/schema/api-key";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { API_KEY_PREFIX } from "@docstore/shared/api-key";
import { eq } from "drizzle-orm";
import {
	authenticateApiKey,
	hashApiKey,
	resolveApiKey,
} from "../services/api-key.service";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

let db: TestDb;
let owner: TestUser;
let client: ReturnType<typeof createTestClient>;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
	client = createTestClient(db, owner);
});

describe("apiKey.create", () => {
	test("returns the secret only once and stores only its hash", async () => {
		const { key, secret } = await client.apiKey.create({
			name: "MCP agent",
			scopes: ["read", "write"],
		});

		expect(secret.startsWith(API_KEY_PREFIX)).toBe(true);
		expect(secret).toHaveLength(API_KEY_PREFIX.length + 40);
		expect(key.prefix).toBe(secret.slice(0, 8));
		expect(key.scopes).toEqual(["read", "write"]);
		expect(key.revokedAt).toBeNull();
		expect(key.expiresAt).toBeNull();

		const rows = await db
			.select()
			.from(apiKeyTable)
			.where(eq(apiKeyTable.id, key.id));
		expect(rows[0]?.hashedKey).toBe(hashApiKey(secret));
		// The plaintext secret appears nowhere in the database.
		expect(rows[0]?.hashedKey).not.toBe(secret);

		const listed = await client.apiKey.list({});
		expect(listed).toHaveLength(1);
		expect(JSON.stringify(listed)).not.toContain(secret);
	});
});

describe("key resolution", () => {
	test("resolves the bearer and its scopes, then records the usage", async () => {
		const { key, secret } = await client.apiKey.create({
			name: "Read",
			scopes: ["read"],
		});

		const principal = await resolveApiKey(db, secret);
		expect(principal).toEqual({
			id: key.id,
			userId: owner.id,
			scopes: ["read"],
		});

		const rows = await db
			.select()
			.from(apiKeyTable)
			.where(eq(apiKeyTable.id, key.id));
		expect(rows[0]?.lastUsedAt).not.toBeNull();
	});

	test("an unknown secret resolves to nothing", async () => {
		expect(await resolveApiKey(db, `${API_KEY_PREFIX}nonexistent`)).toBeNull();
	});

	test("reads the Authorization header like X-API-Key", async () => {
		const { key, secret } = await client.apiKey.create({
			name: "Headers",
			scopes: ["read"],
		});

		const bearer = await authenticateApiKey(
			db,
			new Headers({ authorization: `Bearer ${secret}` }),
		);
		expect(bearer?.id).toBe(key.id);

		const direct = await authenticateApiKey(
			db,
			new Headers({ "x-api-key": secret }),
		);
		expect(direct?.id).toBe(key.id);

		// A Better Auth token is not an API key.
		expect(
			await authenticateApiKey(
				db,
				new Headers({ authorization: "Bearer session-token" }),
			),
		).toBeNull();
	});
});

describe("revocation and expiry", () => {
	test("a revoked key no longer authenticates", async () => {
		const { key, secret } = await client.apiKey.create({
			name: "To revoke",
			scopes: ["read"],
		});

		const revoked = await client.apiKey.revoke({ id: key.id });
		expect(revoked.revokedAt).not.toBeNull();
		expect(await resolveApiKey(db, secret)).toBeNull();
	});

	test("an expiry in the past is refused", async () => {
		await expectOrpcError(
			client.apiKey.create({
				name: "Expired",
				scopes: ["read"],
				expiresAt: new Date(Date.now() - 60_000).toISOString(),
			}),
			"BAD_REQUEST",
		);
	});

	test("an expired key no longer authenticates", async () => {
		const { key, secret } = await client.apiKey.create({
			name: "Expiring",
			scopes: ["read"],
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		});
		// Only time can expire a key: the API refuses to mint one already dead.
		await db
			.update(apiKeyTable)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(eq(apiKeyTable.id, key.id));

		expect(await resolveApiKey(db, secret)).toBeNull();
	});

	test("delete permanently removes the key", async () => {
		const { key } = await client.apiKey.create({
			name: "To delete",
			scopes: ["read"],
		});

		expect(await client.apiKey.delete({ id: key.id })).toEqual({
			id: key.id,
			deleted: true,
		});
		expect(await client.apiKey.list({})).toHaveLength(0);
		await expectOrpcError(client.apiKey.delete({ id: key.id }), "NOT_FOUND");
	});
});

describe("scopes", () => {
	test("a `read` key cannot mutate", async () => {
		const readClient = createTestClient(db, owner, {
			id: "key_test_read",
			scopes: ["read"],
		});

		expect(await readClient.tag.list({})).toEqual([]);
		await expectOrpcError(
			readClient.tag.create({ name: "Rejected" }),
			"FORBIDDEN",
		);
	});

	test("a `write` key mutates but does not administer keys", async () => {
		const writeClient = createTestClient(db, owner, {
			id: "key_test_write",
			scopes: ["read", "write"],
		});

		const tag = await writeClient.tag.create({ name: "Allowed" });
		expect(tag.name).toBe("Allowed");

		await expectOrpcError(
			writeClient.apiKey.create({ name: "Escalation", scopes: ["admin"] }),
			"FORBIDDEN",
		);
	});

	test("`admin` implies every scope", async () => {
		const adminClient = createTestClient(db, owner, {
			id: "key_test_admin",
			scopes: ["admin"],
		});

		const tag = await adminClient.tag.create({ name: "Admin" });
		expect(tag.name).toBe("Admin");
		const created = await adminClient.apiKey.create({
			name: "Sub-key",
			scopes: ["read"],
		});
		expect(created.secret.startsWith(API_KEY_PREFIX)).toBe(true);
	});

	test("a browser session keeps every right", async () => {
		const tag = await client.tag.create({ name: "Session" });
		expect(tag.id).toBeTruthy();
	});
});
