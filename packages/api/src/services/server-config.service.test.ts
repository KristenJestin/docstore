// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${VAR}` is the placeholder syntax of the configuration file, written literally on purpose.
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { intakeSource } from "@docstore/db/schema/intake";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { EMPTY_SERVER_CONFIG } from "@docstore/shared/server-config";
import { asc } from "drizzle-orm";
import { decryptSecret } from "./crypto.service";
import {
	countManagedIntakeSources,
	loadServerConfig,
	ServerConfigError,
	syncManagedIntakeSources,
} from "./server-config.service";

/**
 * Server configuration file: loading (placeholders, errors) and its
 * synchronisation into `intake_source`.
 */

let db: TestDb;
let directory: string;

const APP_SECRET_FOR_TEST = "test-secret-long-enough-01234567890123456";

beforeAll(async () => {
	db = await createTestDb();
	process.env.APP_SECRET = APP_SECRET_FOR_TEST;
	directory = await mkdtemp(join(tmpdir(), "docstore-config-"));
});

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
});

/** Writes a configuration file and returns its path. */
async function writeConfig(name: string, content: unknown): Promise<string> {
	const path = join(directory, name);
	await writeFile(
		path,
		typeof content === "string" ? content : JSON.stringify(content),
		"utf8",
	);
	return path;
}

const folderSource = {
	key: "inbox",
	name: "Server inbox",
	type: "folder",
	config: { path: "/data/inbox", recursive: true },
};

async function managedRows() {
	return db.select().from(intakeSource).orderBy(asc(intakeSource.name));
}

describe("loadServerConfig", () => {
	test("an absent file is an empty configuration, not an error", async () => {
		const loaded = await loadServerConfig({
			path: join(directory, "missing.json"),
			env: {},
			inboxPath: null,
		});
		expect(loaded.exists).toBe(false);
		expect(loaded.config).toEqual(EMPTY_SERVER_CONFIG);
	});

	test("resolves `${VAR}` from the environment", async () => {
		const path = await writeConfig("mail.json", {
			intakeSources: [
				{
					key: "billing-mail",
					type: "mail",
					config: {
						host: "imap.example.test",
						username: "billing@example.test",
						password: "${MAIL_PASSWORD}",
					},
				},
			],
		});
		const loaded = await loadServerConfig({
			path,
			env: { MAIL_PASSWORD: "s3cret" },
			inboxPath: null,
		});
		expect(loaded.config.intakeSources[0]?.config).toMatchObject({
			type: "mail",
			password: "s3cret",
		});
	});

	test("a missing variable stops the load, naming the key", async () => {
		const path = await writeConfig("missing-var.json", {
			intakeSources: [
				{
					key: "billing-mail",
					type: "mail",
					config: {
						host: "imap.example.test",
						username: "billing@example.test",
						password: "${MAIL_PASSWORD}",
					},
				},
			],
		});
		const error = await loadServerConfig({ path, env: {}, inboxPath: null })
			.then(() => null)
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ServerConfigError);
		expect((error as Error).message).toContain("MAIL_PASSWORD");
	});

	test("invalid JSON is reported as such", async () => {
		const path = await writeConfig("broken.json", "{ nope");
		const error = await loadServerConfig({ path, env: {}, inboxPath: null })
			.then(() => null)
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ServerConfigError);
		expect((error as Error).message).toContain("not valid JSON");
	});

	test("a schema violation names the offending field", async () => {
		const path = await writeConfig("invalid.json", {
			intakeSources: [{ key: "inbox", type: "folder", config: { path: "" } }],
		});
		const error = await loadServerConfig({ path, env: {}, inboxPath: null })
			.then(() => null)
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ServerConfigError);
		expect((error as Error).message).toContain("intakeSources.0.config.path");
	});

	test("only `.json` is supported in v1", async () => {
		await expect(
			loadServerConfig({
				path: join(directory, "config.yaml"),
				env: {},
				inboxPath: null,
			}),
		).rejects.toBeInstanceOf(ServerConfigError);
	});

	test("INBOX_PATH synthesizes a source when the file declares none", async () => {
		const path = await writeConfig("empty.json", { intakeSources: [] });
		const loaded = await loadServerConfig({
			path,
			env: {},
			inboxPath: "/data/inbox",
		});
		expect(loaded.config.intakeSources).toHaveLength(1);
		expect(loaded.config.intakeSources[0]).toMatchObject({
			key: "inbox",
			type: "folder",
		});
		expect(loaded.config.intakeSources[0]?.config).toMatchObject({
			afterImport: "move",
			moveTo: "/data/inbox/imported",
		});
	});

	test("INBOX_PATH stands back when the file already watches the folder", async () => {
		const path = await writeConfig("declared.json", {
			intakeSources: [
				{ key: "scanner", type: "folder", config: { path: "/data/inbox" } },
			],
		});
		const loaded = await loadServerConfig({
			path,
			env: {},
			inboxPath: "/data/inbox",
		});
		expect(loaded.config.intakeSources).toHaveLength(1);
		expect(loaded.config.intakeSources[0]?.key).toBe("scanner");
	});

	test("`INBOX_PATH` is read from the environment when not passed", async () => {
		const path = await writeConfig("env-inbox.json", { intakeSources: [] });
		const loaded = await loadServerConfig({
			path,
			env: { INBOX_PATH: "/srv/inbox" },
		});
		expect(loaded.config.intakeSources[0]?.config).toMatchObject({
			path: "/srv/inbox",
		});
	});
});

describe("syncManagedIntakeSources", () => {
	test("creates the declared sources, then leaves them alone", async () => {
		const path = await writeConfig("sync.json", {
			intakeSources: [folderSource],
		});
		const { config } = await loadServerConfig({
			path,
			env: {},
			inboxPath: null,
		});

		expect(await syncManagedIntakeSources(db, config)).toEqual({
			created: 1,
			updated: 0,
			unchanged: 0,
			deleted: 0,
		});

		const [row] = await managedRows();
		expect(row?.managedKey).toBe("inbox");
		expect(row?.name).toBe("Server inbox");
		expect(row?.config).toMatchObject({ type: "folder", path: "/data/inbox" });

		// Idempotence: a second run touches nothing at all.
		expect(await syncManagedIntakeSources(db, config)).toEqual({
			created: 0,
			updated: 0,
			unchanged: 1,
			deleted: 0,
		});
		const [again] = await managedRows();
		expect(again?.id).toBe(row?.id);
		expect(again?.updatedAt).toEqual(row?.updatedAt as Date);
	});

	test("updates a source whose declaration changed, keeping its id", async () => {
		const first = await writeConfig("update-a.json", {
			intakeSources: [folderSource],
		});
		const created = await loadServerConfig({
			path: first,
			env: {},
			inboxPath: null,
		});
		await syncManagedIntakeSources(db, created.config);
		const [before] = await managedRows();

		const second = await writeConfig("update-b.json", {
			intakeSources: [
				{
					...folderSource,
					name: "Renamed",
					enabled: false,
					config: { path: "/data/other", recursive: false },
				},
			],
		});
		const changed = await loadServerConfig({
			path: second,
			env: {},
			inboxPath: null,
		});
		expect(await syncManagedIntakeSources(db, changed.config)).toMatchObject({
			created: 0,
			updated: 1,
		});

		const [after] = await managedRows();
		expect(after?.id).toBe(before?.id);
		expect(after?.name).toBe("Renamed");
		expect(after?.enabled).toBe(false);
		expect(after?.config).toMatchObject({ path: "/data/other" });
	});

	test("encrypts the mailbox password and keeps it stable across runs", async () => {
		const path = await writeConfig("mail-sync.json", {
			intakeSources: [
				{
					key: "billing-mail",
					type: "mail",
					config: {
						host: "imap.example.test",
						username: "billing@example.test",
						password: "${MAIL_PASSWORD}",
					},
				},
			],
		});
		const load = () =>
			loadServerConfig({
				path,
				env: { MAIL_PASSWORD: "s3cret" },
				inboxPath: null,
			});

		await syncManagedIntakeSources(db, (await load()).config);
		const [row] = await managedRows();
		const stored = row?.config;
		if (stored?.type !== "mail") throw new Error("expected a mail source");
		expect(stored.passwordEncrypted).not.toBe("s3cret");
		expect(decryptSecret(stored.passwordEncrypted ?? "")).toBe("s3cret");

		// Re-encrypting on every startup would make the row look modified.
		expect(
			await syncManagedIntakeSources(db, (await load()).config),
		).toMatchObject({ updated: 0, unchanged: 1 });
	});

	test("deletes the managed rows whose key left the file", async () => {
		const path = await writeConfig("delete-a.json", {
			intakeSources: [folderSource, { ...folderSource, key: "scanner" }],
		});
		await syncManagedIntakeSources(
			db,
			(await loadServerConfig({ path, env: {}, inboxPath: null })).config,
		);
		expect(await countManagedIntakeSources(db)).toBe(2);

		expect(
			await syncManagedIntakeSources(db, { intakeSources: [] }),
		).toMatchObject({ deleted: 2 });
		expect(await countManagedIntakeSources(db)).toBe(0);
	});

	test("never touches the sources created through the interface", async () => {
		await db.insert(intakeSource).values({
			type: "folder",
			name: "Handmade",
			config: {
				type: "folder",
				path: "/srv/manual",
				recursive: false,
				pollSeconds: 30,
				afterImport: "keep",
			},
			defaults: {},
			stats: { imported: 0, duplicates: 0, errors: 0 },
		});

		await syncManagedIntakeSources(db, { intakeSources: [] });

		const rows = await managedRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.name).toBe("Handmade");
		expect(rows[0]?.managedKey).toBeNull();
		expect(await countManagedIntakeSources(db)).toBe(0);
	});
});
