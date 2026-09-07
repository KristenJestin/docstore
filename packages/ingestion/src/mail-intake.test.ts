import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { document } from "@docstore/db/schema/document";
import { intakeLog, intakeSource } from "@docstore/db/schema/intake";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import type { MailConfig } from "@docstore/shared/intake";
import { asc, eq } from "drizzle-orm";
import type { IngestionContext } from "./context";
import { runIntakeSource } from "./intake-source";
import type { MailMessage } from "./mail";
import { buildSubject } from "./subject";
import {
	createTestIngestion,
	emptyMailActions,
	type FakeMailActions,
	FakeMailClient,
	type FakeMailMessage,
	FIXTURES,
	insertTestUser,
	readFixture,
	type TestIngestion,
} from "./test-utils";

let db: TestDb;
let userId: string;
let pdf: Uint8Array;

/** "Encrypted" password of the fake context (see `createTestIngestion`). */
const ENCRYPTED_PASSWORD = "enc:app-password";

const RECEIVED_AT = new Date("2026-03-04T08:30:00.000Z");

beforeAll(async () => {
	db = await createTestDb();
	pdf = await readFixture(FIXTURES.textLayerPdf);
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	userId = await insertTestUser(db);
});

function baseConfig(overrides: Partial<MailConfig> = {}): MailConfig {
	return {
		type: "mail",
		host: "imap.example.test",
		port: 993,
		secure: true,
		username: "camille@example.test",
		passwordEncrypted: ENCRYPTED_PASSWORD,
		mailbox: "INBOX",
		pollSeconds: 300,
		onlyUnseen: true,
		afterImport: "mark_seen",
		attachmentsOnly: true,
		importBodyAsPdf: false,
		...overrides,
	};
}

async function createMailSource(config: MailConfig): Promise<string> {
	const rows = await db
		.insert(intakeSource)
		.values({
			type: "mail",
			name: "Invoices mailbox",
			enabled: true,
			config,
			defaults: {},
			stats: { imported: 0, duplicates: 0, errors: 0 },
		})
		.returning();
	const row = rows[0];
	if (!row) throw new Error("source not created");
	return row.id;
}

function messages(): FakeMailMessage[] {
	return [
		{
			uid: 11,
			messageId: "<invoice-2026-03@edf.example>",
			from: "invoice@edf.example",
			subject: "Your March invoice",
			receivedAt: RECEIVED_AT,
			attachments: [
				{
					filename: "march-invoice.pdf",
					mime: "application/pdf",
					content: pdf,
				},
			],
		},
		{
			uid: 12,
			messageId: "<newsletter@edf.example>",
			from: "news@edf.example",
			subject: "Our monthly tips",
			receivedAt: RECEIVED_AT,
			attachments: [],
		},
	];
}

/** Ingestion context wired to a fake mailbox. */
async function withFakeMailbox(options: {
	messages?: FakeMailMessage[];
	failConnect?: string;
	actions?: FakeMailActions;
}): Promise<TestIngestion & { ctx: IngestionContext }> {
	const list = options.messages ?? [];
	const actions = options.actions ?? emptyMailActions();
	return createTestIngestion(db, {
		createMailClient: () =>
			new FakeMailClient({
				messages: list,
				actions,
				...(options.failConnect ? { failConnect: options.failConnect } : {}),
			}),
	});
}

describe("runIntakeSource (mailbox)", () => {
	test("imports the attachment, keeps the mail context and marks as seen", async () => {
		const actions = emptyMailActions();
		const ingestion = await withFakeMailbox({
			messages: messages(),
			actions,
		});
		const sourceId = await createMailSource(baseConfig());

		const result = await runIntakeSource(ingestion.ctx, sourceId, {
			createdById: userId,
		});

		expect(result.imported).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.errors).toBe(0);

		const [doc] = await db.select().from(document);
		expect(doc?.source).toBe("mail");
		expect(doc?.sourceRef).toBe("<invoice-2026-03@edf.example>");
		expect(doc?.title).toBe("march-invoice.pdf");
		expect(doc?.receivedAt).toBe("2026-03-04");
		expect(doc?.intakeMeta?.mail).toEqual({
			from: "invoice@edf.example",
			subject: "Your March invoice",
			receivedAt: RECEIVED_AT.toISOString(),
		});

		// Both messages are acknowledged, including the one without attachment.
		expect(actions.markedSeen.sort()).toEqual([11, 12]);
		expect(actions.moved).toEqual([]);
		expect(actions.deleted).toEqual([]);

		const logs = await db
			.select()
			.from(intakeLog)
			.where(eq(intakeLog.sourceId, sourceId))
			.orderBy(asc(intakeLog.filename));
		expect(logs.map((row) => row.outcome).sort()).toEqual([
			"imported",
			"skipped",
		]);

		await ingestion.cleanup();
	});

	test("`buildSubject` hands `mail.from` and `mail.subject` to the rules", async () => {
		const ingestion = await withFakeMailbox({ messages: messages() });
		const sourceId = await createMailSource(baseConfig());
		await runIntakeSource(ingestion.ctx, sourceId, { createdById: userId });

		const [doc] = await db.select().from(document);
		if (!doc) throw new Error("missing document");
		const prepared = await buildSubject(db, doc.id);
		expect(prepared?.subject.mail).toEqual({
			from: "invoice@edf.example",
			subject: "Your March invoice",
			receivedAt: RECEIVED_AT.toISOString(),
		});
		expect(prepared?.subject.source).toBe("mail");

		await ingestion.cleanup();
	});

	test("`afterImport: move` moves the message instead of marking it seen", async () => {
		const actions = emptyMailActions();
		const ingestion = await withFakeMailbox({ messages: messages(), actions });
		const sourceId = await createMailSource(
			baseConfig({ afterImport: "move", moveTo: "Archive/2026" }),
		);

		await runIntakeSource(ingestion.ctx, sourceId, { createdById: userId });

		expect(actions.markedSeen).toEqual([]);
		expect(actions.moved).toEqual([
			{ uid: 11, mailbox: "Archive/2026" },
			{ uid: 12, mailbox: "Archive/2026" },
		]);

		await ingestion.cleanup();
	});

	test("filters on the sender and the subject", async () => {
		const ingestion = await withFakeMailbox({ messages: messages() });
		const sourceId = await createMailSource(
			baseConfig({ from: "news@", subjectPattern: "tips" }),
		);

		const result = await runIntakeSource(ingestion.ctx, sourceId, {
			createdById: userId,
		});

		// Only the newsletter passes the filter, and it has no attachment.
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);

		await ingestion.cleanup();
	});

	test("an authentication error feeds `lastError`", async () => {
		const ingestion = await withFakeMailbox({
			failConnect: "IMAP credentials rejected (AUTHENTICATIONFAILED).",
		});
		const sourceId = await createMailSource(baseConfig());

		const result = await runIntakeSource(ingestion.ctx, sourceId, {
			createdById: userId,
		});

		expect(result.imported).toBe(0);
		expect(result.errors).toBe(1);

		const [source] = await db
			.select()
			.from(intakeSource)
			.where(eq(intakeSource.id, sourceId));
		expect(source?.lastError).toContain("AUTHENTICATIONFAILED");
		expect(source?.lastRunAt).not.toBeNull();

		await ingestion.cleanup();
	});

	test("a second pass on the same message does not create a duplicate", async () => {
		const shared: FakeMailMessage[] = messages();
		const ingestion = await withFakeMailbox({ messages: shared });
		const sourceId = await createMailSource(
			baseConfig({ onlyUnseen: false, afterImport: "mark_seen" }),
		);

		await runIntakeSource(ingestion.ctx, sourceId, { createdById: userId });
		const second = await runIntakeSource(ingestion.ctx, sourceId, {
			createdById: userId,
		});

		expect(second.imported).toBe(0);
		expect(second.duplicates).toBe(1);
		expect(await db.select().from(document)).toHaveLength(1);

		await ingestion.cleanup();
	});
});

describe("MailMessage", () => {
	test("the type does expose the fields expected by the pipeline", () => {
		const message: MailMessage = messages()[0] as MailMessage;
		expect(message.attachments[0]?.filename).toBe("march-invoice.pdf");
	});
});
