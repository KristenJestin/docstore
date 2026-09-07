import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { intakeSource } from "@docstore/db/schema/intake";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { IngestionBinding, MailConnection } from "@docstore/ingestion";
import {
	createTestIngestion,
	FakeMailClient,
	type TestIngestion,
} from "@docstore/ingestion/test-utils";
import { MANAGED_INTAKE_SOURCE_MESSAGE } from "@docstore/shared/intake";
import { decryptSecret } from "../services/crypto.service";
import { testIntakeSource } from "../services/intake-source.service";
import {
	loadServerConfig,
	syncManagedIntakeSources,
} from "../services/server-config.service";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

/**
 * `intakeSource`, `uploadLink` and `webhook` routers (iteration 6).
 *
 * The sensitive part is the IMAP password: it comes in as plaintext, never
 * comes back out, and an update without a password keeps the previous one.
 */

let db: TestDb;
let owner: TestUser;
let client: ReturnType<typeof createTestClient>;

const APP_SECRET_FOR_TEST = "test-secret-long-enough-01234567890123456";

/**
 * Connection parameters handed to the IMAP client, captured so the tests can
 * see which host, mailbox and password `intakeSource.test` actually used.
 */
const connections: MailConnection[] = [];
let ingestion: TestIngestion;
let binding: IngestionBinding;

beforeAll(async () => {
	db = await createTestDb();
	process.env.APP_SECRET = APP_SECRET_FOR_TEST;
	ingestion = await createTestIngestion(db, {
		createMailClient: (connection) => {
			connections.push(connection);
			return new FakeMailClient({ messages: [] });
		},
		decryptSecret: (payload) => decryptSecret(payload, APP_SECRET_FOR_TEST),
	});
	binding = { ctx: ingestion.ctx };
});

afterAll(async () => {
	await ingestion.cleanup();
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	connections.length = 0;
	owner = await createTestUser(db);
	client = createTestClient(db, owner);
});

const folderDraft = {
	type: "folder" as const,
	path: "/data/inbox",
	recursive: true,
	pollSeconds: 60,
	afterImport: "keep" as const,
};

const mailDraft = {
	type: "mail" as const,
	host: "imap.gmail.com",
	port: 993,
	secure: true,
	username: "camille@example.com",
	password: "application-password",
	mailbox: "INBOX",
	pollSeconds: 300,
	onlyUnseen: true,
	afterImport: "mark_seen" as const,
	attachmentsOnly: true,
	importBodyAsPdf: false,
};

describe("intakeSource", () => {
	test("creates, lists and reads back a watched folder", async () => {
		const created = await client.intakeSource.create({
			name: "Scanner",
			config: folderDraft,
		});
		expect(created.id).toStartWith("src_");
		expect(created.type).toBe("folder");
		expect(created.stats).toEqual({ imported: 0, duplicates: 0, errors: 0 });

		const list = await client.intakeSource.list({});
		expect(list).toHaveLength(1);

		const detail = await client.intakeSource.get({ id: created.id });
		expect(detail.config).toMatchObject({
			path: "/data/inbox",
			recursive: true,
		});
	});

	test("encrypts the IMAP password and never returns it", async () => {
		const created = await client.intakeSource.create({
			name: "Invoices mailbox",
			config: mailDraft,
		});

		expect(created.config).toMatchObject({ type: "mail", hasPassword: true });
		expect(JSON.stringify(created.config)).not.toContain(
			"application-password",
		);

		const [row] = await db.select().from(intakeSource);
		const stored = row?.config;
		if (stored?.type !== "mail" || !stored.passwordEncrypted) {
			throw new Error("password not stored");
		}
		expect(stored.passwordEncrypted).not.toContain("application-password");
		expect(decryptSecret(stored.passwordEncrypted, APP_SECRET_FOR_TEST)).toBe(
			"application-password",
		);
	});

	test("an update without a password keeps the stored one", async () => {
		const created = await client.intakeSource.create({
			name: "Invoices mailbox",
			config: mailDraft,
		});
		const [before] = await db.select().from(intakeSource);
		const previous =
			before?.config.type === "mail" ? before.config.passwordEncrypted : null;

		const { password, ...withoutPassword } = mailDraft;
		const updated = await client.intakeSource.update({
			id: created.id,
			config: { ...withoutPassword, mailbox: "Invoices" },
		});
		expect(updated.config).toMatchObject({
			mailbox: "Invoices",
			hasPassword: true,
		});

		const [after] = await db.select().from(intakeSource);
		const current =
			after?.config.type === "mail" ? after.config.passwordEncrypted : null;
		expect(current).toBe(previous);
	});

	test("`test` merges the draft over the stored config and keeps the password", async () => {
		const created = await client.intakeSource.create({
			name: "Invoices mailbox",
			config: mailDraft,
		});

		// The edit form never receives the stored secret, so it cannot resend it:
		// the draft comes back without a password.
		const { password, ...withoutPassword } = mailDraft;
		const result = await testIntakeSource(db, binding, {
			id: created.id,
			draft: { ...withoutPassword, mailbox: "Archive", onlyUnseen: false },
		});

		expect(result.ok).toBe(true);
		const connection = connections.at(-1);
		// Draft wins on every field…
		expect(connection?.mailbox).toBe("Archive");
		// …except the password, taken from the stored (encrypted) config.
		expect(connection?.password).toBe("application-password");
	});

	test("`test` prefers the password typed in the draft over the stored one", async () => {
		const created = await client.intakeSource.create({
			name: "Invoices mailbox",
			config: mailDraft,
		});

		await testIntakeSource(db, binding, {
			id: created.id,
			draft: { ...mailDraft, password: "brand-new-password" },
		});
		expect(connections.at(-1)?.password).toBe("brand-new-password");
	});

	test("`test` refuses a draft whose type differs from the stored source", async () => {
		const created = await client.intakeSource.create({
			name: "Scanner",
			config: folderDraft,
		});

		await expectOrpcError(
			testIntakeSource(db, binding, { id: created.id, draft: mailDraft }),
			"BAD_REQUEST",
		);
	});

	test("refuses to change the type of a source", async () => {
		const created = await client.intakeSource.create({
			name: "Scanner",
			config: folderDraft,
		});
		await expectOrpcError(
			client.intakeSource.update({ id: created.id, config: mailDraft }),
			"BAD_REQUEST",
		);
	});

	test("rejects `importBodyAsPdf: true` (out of v1 scope)", async () => {
		await expectOrpcError(
			client.intakeSource.create({
				name: "Mailbox",
				config: { ...mailDraft, importBodyAsPdf: true },
			}),
			"BAD_REQUEST",
		);
	});

	test("rejects `afterImport: move` without a destination", async () => {
		await expectOrpcError(
			client.intakeSource.create({
				name: "Scanner",
				config: { ...folderDraft, afterImport: "move" },
			}),
			"BAD_REQUEST",
		);
	});

	test("toggles, logs and deletes", async () => {
		const created = await client.intakeSource.create({
			name: "Scanner",
			config: folderDraft,
		});

		const disabled = await client.intakeSource.toggle({
			id: created.id,
			enabled: false,
		});
		expect(disabled.enabled).toBe(false);

		const logs = await client.intakeSource.logs({ id: created.id, page: 1 });
		expect(logs.items).toEqual([]);
		expect(logs.total).toBe(0);

		expect(await client.intakeSource.delete({ id: created.id })).toEqual({
			id: created.id,
			deleted: true,
		});
		await expectOrpcError(
			client.intakeSource.get({ id: created.id }),
			"NOT_FOUND",
		);
	});

	test("`runNow` without a processing queue answers SERVICE_UNAVAILABLE", async () => {
		const created = await client.intakeSource.create({
			name: "Scanner",
			config: folderDraft,
		});
		await expectOrpcError(
			client.intakeSource.runNow({ id: created.id }),
			"SERVICE_UNAVAILABLE",
		);
	});

	test("a server-defined source is read-only, but stays testable", async () => {
		const path = join(
			await mkdtemp(join(tmpdir(), "docstore-intake-")),
			"docstore.config.json",
		);
		await writeFile(
			path,
			JSON.stringify({
				intakeSources: [
					{
						key: "inbox",
						name: "Server inbox",
						type: "folder",
						config: { path: "/data/inbox" },
					},
				],
			}),
			"utf8",
		);
		const { config } = await loadServerConfig({
			path,
			env: {},
			inboxPath: null,
		});
		await syncManagedIntakeSources(db, config);

		const [source] = await client.intakeSource.list({});
		if (!source) throw new Error("the managed source was not created");
		expect(source.managed).toBe(true);
		expect(source.managedKey).toBe("inbox");

		for (const call of [
			client.intakeSource.update({ id: source.id, name: "Renamed" }),
			client.intakeSource.toggle({ id: source.id, enabled: false }),
			client.intakeSource.delete({ id: source.id }),
		]) {
			const error = await expectOrpcError(call, "FORBIDDEN");
			expect(error.message).toBe(MANAGED_INTAKE_SOURCE_MESSAGE);
		}

		// Reading the log and testing the connection stay allowed.
		expect(
			(await client.intakeSource.logs({ id: source.id, page: 1 })).total,
		).toBe(0);
		expect(
			await testIntakeSource(db, binding, { id: source.id }),
		).toMatchObject({ ok: false });
		expect((await client.intakeSource.get({ id: source.id })).managed).toBe(
			true,
		);
	});

	test("a source created through the API is not managed", async () => {
		const created = await client.intakeSource.create({
			name: "Scanner",
			config: folderDraft,
		});
		expect(created.managed).toBe(false);
		expect(created.managedKey).toBeNull();
	});

	test("an API key without the admin scope cannot create a source", async () => {
		const limited = createTestClient(db, owner, {
			id: "key_1",
			scopes: ["read", "write"],
		});
		await expectOrpcError(
			limited.intakeSource.create({ name: "Scanner", config: folderDraft }),
			"FORBIDDEN",
		);
	});
});

describe("uploadLink", () => {
	test("creates a link with its public URL then disables it", async () => {
		const created = await client.uploadLink.create({
			name: "Accountant upload",
			message: "Please upload the financial statements here.",
			maxUses: 3,
		});

		expect(created.link.id).toStartWith("ulk_");
		expect(created.link.token).toHaveLength(32);
		expect(created.url).toEndWith(`/u/${created.link.token}`);
		expect(created.link.uses).toBe(0);

		const updated = await client.uploadLink.update({
			id: created.link.id,
			name: "Upload 2026",
		});
		expect(updated.name).toBe("Upload 2026");

		const disabled = await client.uploadLink.disable({ id: created.link.id });
		expect(disabled.enabled).toBe(false);

		expect(await client.uploadLink.list({})).toHaveLength(1);
		expect(await client.uploadLink.delete({ id: created.link.id })).toEqual({
			id: created.link.id,
			deleted: true,
		});
	});

	test("two links have different tokens", async () => {
		const first = await client.uploadLink.create({ name: "A" });
		const second = await client.uploadLink.create({ name: "B" });
		expect(first.link.token).not.toBe(second.link.token);
	});

	test("`list` carries the public URL, so the front never rebuilds it", async () => {
		const created = await client.uploadLink.create({ name: "Accountant" });

		const [listed] = await client.uploadLink.list({});
		expect(listed?.url).toBe(created.url);
		expect(listed?.url).toEndWith(`/u/${created.link.token}`);
		// The page, not the endpoint: `/api/u/<token>` is what that page calls.
		expect(listed?.url).not.toContain("/api/u/");

		const updated = await client.uploadLink.update({
			id: created.link.id,
			name: "Accountant 2026",
		});
		expect(updated.url).toBe(created.url);
	});
});

describe("webhook", () => {
	test("creates a webhook with a generated secret and an empty log", async () => {
		const created = await client.webhook.create({
			name: "Home Assistant",
			url: "https://ha.example.test/hook",
			events: ["document.created", "reminder.due"],
		});

		expect(created.id).toStartWith("whk_");
		expect(created.secret).toHaveLength(64);
		expect(created.events).toEqual(["document.created", "reminder.due"]);
		expect(created.lastStatus).toBeNull();

		const deliveries = await client.webhook.deliveries({
			id: created.id,
			page: 1,
		});
		expect(deliveries.items).toEqual([]);

		const updated = await client.webhook.update({
			id: created.id,
			enabled: false,
		});
		expect(updated.enabled).toBe(false);
		expect(updated.secret).toBe(created.secret);

		expect(await client.webhook.delete({ id: created.id })).toEqual({
			id: created.id,
			deleted: true,
		});
	});

	test("`test` without a processing queue answers SERVICE_UNAVAILABLE", async () => {
		const created = await client.webhook.create({
			name: "Home Assistant",
			url: "https://ha.example.test/hook",
			events: ["document.created"],
		});
		await expectOrpcError(
			client.webhook.test({ id: created.id }),
			"SERVICE_UNAVAILABLE",
		);
	});

	test("rejects an unknown event", async () => {
		await expectOrpcError(
			client.webhook.create({
				name: "Target",
				url: "https://example.test/hook",
				// biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
				events: ["document.exploded"] as any,
			}),
			"BAD_REQUEST",
		);
	});
});

describe("intake defaults — referenced entities", () => {
	test("uploadLink.create refuses a category, tag or Party that does not exist", async () => {
		for (const defaults of [
			{ categoryId: "cat_absent" },
			{ tagIds: ["tag_absent"] },
			{ partyId: "prt_absent" },
		]) {
			await expectOrpcError(
				client.uploadLink.create({ name: "Broken", defaults }),
				"NOT_FOUND",
			);
		}
		expect(await client.uploadLink.list({})).toHaveLength(0);
	});

	test("uploadLink.update checks them too", async () => {
		const created = await client.uploadLink.create({ name: "Accountant" });
		await expectOrpcError(
			client.uploadLink.update({
				id: created.link.id,
				defaults: { categoryId: "cat_absent" },
			}),
			"NOT_FOUND",
		);
	});

	test("existing references are accepted", async () => {
		const category = await client.category.create({ name: "Invoice" });
		const tag = await client.tag.create({ name: "energy" });
		const party = await client.party.create({ type: "company", name: "EDF" });

		const created = await client.uploadLink.create({
			name: "Accountant",
			defaults: {
				categoryId: category.id,
				tagIds: [tag.id],
				partyId: party.id,
			},
		});
		expect(created.link.defaults.categoryId).toBe(category.id);
	});

	test("intakeSource.create and update check them as well", async () => {
		await expectOrpcError(
			client.intakeSource.create({
				name: "Scanner",
				config: folderDraft,
				defaults: { partyId: "prt_absent" },
			}),
			"NOT_FOUND",
		);

		const created = await client.intakeSource.create({
			name: "Scanner",
			config: folderDraft,
		});
		await expectOrpcError(
			client.intakeSource.update({
				id: created.id,
				defaults: { tagIds: ["tag_absent"] },
			}),
			"NOT_FOUND",
		);
	});

	test("an upload link expiry in the past is refused", async () => {
		await expectOrpcError(
			client.uploadLink.create({
				name: "Expired",
				expiresAt: new Date(Date.now() - 60_000).toISOString(),
			}),
			"BAD_REQUEST",
		);
	});
});
