import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { intakeSource } from "@docstore/db/schema/intake";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { APP_VERSION } from "@docstore/shared/settings";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

/**
 * `settings` router: the stored values and `serverInfo`, which the interface
 * uses to build the MCP command line instead of hardcoding an origin.
 */

let db: TestDb;
let owner: TestUser;
let client: ReturnType<typeof createTestClient>;

const previousEnv = {
	BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
	PUBLIC_URL: process.env.PUBLIC_URL,
	DOCSTORE_CONFIG: process.env.DOCSTORE_CONFIG,
};

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	for (const [key, value] of Object.entries(previousEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
	client = createTestClient(db, owner);
	process.env.BETTER_AUTH_URL = "http://localhost:3000";
	process.env.DOCSTORE_CONFIG = "/data/config/docstore.json";
	delete process.env.PUBLIC_URL;
});

describe("settings.serverInfo", () => {
	test("reports both origins, the version and the configuration path", async () => {
		const info = await client.settings.serverInfo({});
		expect(info.apiUrl).toBe("http://localhost:3000");
		// Without PUBLIC_URL the web origin falls back to the API one.
		expect(info.publicUrl).toBe("http://localhost:3000");
		expect(info.version).toBe(APP_VERSION);
		expect(info.configPath).toBe("/data/config/docstore.json");
		expect(info.managedIntakeSources).toBe(0);
	});

	test("PUBLIC_URL wins for the web origin, trailing slash removed", async () => {
		process.env.PUBLIC_URL = "https://docs.example.test/";
		const info = await client.settings.serverInfo({});
		expect(info.publicUrl).toBe("https://docs.example.test");
		expect(info.apiUrl).toBe("http://localhost:3000");
	});

	test("counts only the server-defined sources", async () => {
		const config = {
			type: "folder" as const,
			path: "/data/inbox",
			recursive: false,
			pollSeconds: 30,
			afterImport: "keep" as const,
		};
		await db.insert(intakeSource).values([
			{
				type: "folder",
				name: "Server inbox",
				managedKey: "inbox",
				config,
				defaults: {},
				stats: { imported: 0, duplicates: 0, errors: 0 },
			},
			{
				type: "folder",
				name: "Handmade",
				config,
				defaults: {},
				stats: { imported: 0, duplicates: 0, errors: 0 },
			},
		]);

		expect((await client.settings.serverInfo({})).managedIntakeSources).toBe(1);
	});

	test("requires an authenticated caller", async () => {
		const anonymous = createTestClient(db, null);
		await expectOrpcError(anonymous.settings.serverInfo({}), "UNAUTHORIZED");
	});
});
