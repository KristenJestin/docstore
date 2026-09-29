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
import type { ApiKeyScope } from "@docstore/shared/api-key";
import { WEBHOOK_EVENTS } from "@docstore/shared/webhook";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

/**
 * Issue #11: listing an object needs the same scope as managing it. `admin`
 * for API keys, webhooks, upload links and intake sources; `write` for share
 * links, whose list returns working public URLs.
 */

let db: TestDb;
let owner: TestUser;
let session: ReturnType<typeof createTestClient>;
let ids: { webhook: string; intakeSource: string };

beforeAll(async () => {
	db = await createTestDb();
	process.env.APP_SECRET = "test-secret-long-enough-01234567890123456";
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
	session = createTestClient(db, owner);

	// One object of each kind, created from a browser session.
	const rows = await db
		.insert(document)
		.values({ title: "Water bill", status: "active", createdById: owner.id })
		.returning({ id: document.id });
	const documentId = rows[0]?.id;
	if (!documentId) throw new Error("document not inserted");
	await session.shareLink.create({ documentId, allowDownload: true });
	await session.uploadLink.create({ name: "Accountant" });
	await session.apiKey.create({ name: "Agent", scopes: ["read"] });
	const hook = await session.webhook.create({
		name: "Home automation",
		url: "https://example.com/hook",
		events: [WEBHOOK_EVENTS[0]],
	});
	const source = await session.intakeSource.create({
		name: "Scanner",
		config: {
			type: "folder",
			path: "/data/inbox",
			recursive: true,
			pollSeconds: 60,
			afterImport: "keep",
		},
	});
	ids = { webhook: hook.id, intakeSource: source.id };
});

function keyClient(scopes: ApiKeyScope[]) {
	return createTestClient(db, owner, { id: "key_list_scopes", scopes });
}

/** Every procedure of the issue, called with valid input. */
function adminLists(client: ReturnType<typeof createTestClient>) {
	return {
		"uploadLink.list": () => client.uploadLink.list({}),
		"apiKey.list": () => client.apiKey.list({}),
		"webhook.deliveries": () => client.webhook.deliveries({ id: ids.webhook }),
		"intakeSource.list": () => client.intakeSource.list({}),
		"intakeSource.get": () => client.intakeSource.get({ id: ids.intakeSource }),
		"intakeSource.logs": () =>
			client.intakeSource.logs({ id: ids.intakeSource }),
	};
}

describe("Docstore SHALL require the scope that manages an object to list it", () => {
	test("WHEN a read-only key calls shareLink.list THEN the response is 403 FORBIDDEN", async () => {
		const error = await expectOrpcError(
			keyClient(["read"]).shareLink.list({}),
			"FORBIDDEN",
		);
		expect(error.status).toBe(403);
		expect(error.message).toContain('"write" scope');
	});

	test("WHEN a read-only key calls an admin list procedure THEN the response is 403 FORBIDDEN", async () => {
		for (const call of Object.values(adminLists(keyClient(["read"])))) {
			const error = await expectOrpcError(call(), "FORBIDDEN");
			expect(error.status).toBe(403);
			expect(error.message).toContain('"admin" scope');
		}
	});

	test("WHEN a write key calls an admin list procedure THEN the response is 403 FORBIDDEN", async () => {
		const client = keyClient(["read", "write"]);
		for (const call of Object.values(adminLists(client))) {
			await expectOrpcError(call(), "FORBIDDEN");
		}
		// Share links are managed with `write`: that key may list them.
		expect(await client.shareLink.list({})).toHaveLength(1);
	});

	test("WHEN an admin key calls every list procedure THEN it succeeds", async () => {
		const client = keyClient(["admin"]);
		expect(await client.shareLink.list({})).toHaveLength(1);
		expect(await client.uploadLink.list({})).toHaveLength(1);
		expect(await client.apiKey.list({})).toHaveLength(1);
		expect((await client.webhook.deliveries({ id: ids.webhook })).total).toBe(
			0,
		);
		expect(await client.intakeSource.list({})).toHaveLength(1);
		expect((await client.intakeSource.get({ id: ids.intakeSource })).name).toBe(
			"Scanner",
		);
		expect(
			(await client.intakeSource.logs({ id: ids.intakeSource })).total,
		).toBe(0);
	});

	test("WHEN a browser session calls every list procedure THEN it is unaffected", async () => {
		expect(await session.shareLink.list({})).toHaveLength(1);
		expect(await session.uploadLink.list({})).toHaveLength(1);
		expect(await session.apiKey.list({})).toHaveLength(1);
		for (const call of Object.values(adminLists(session))) {
			await call();
		}
	});

	test("WHEN a read-only key calls settings.serverInfo THEN it still succeeds", async () => {
		const info = await keyClient(["read"]).settings.serverInfo({});
		expect(info.version).toBeTruthy();
	});
});
