import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createId } from "@docstore/db/id";
import { user } from "@docstore/db/schema/auth";
import type { TestDb } from "@docstore/db/test-utils";
import type { ExternalTools } from "@docstore/ocr";
import { deriveStorageMasterKey } from "@docstore/storage";
import dotenv from "dotenv";
import type { GenerateRemindersHook, IngestionContext } from "./context";
import { createIngestionContext } from "./context";
import type {
	MailClient,
	MailClientFactory,
	MailMessage,
	MailSearchOptions,
} from "./mail";
import { MailConnectionError, matchesMailFilters } from "./mail";
import type { IngestionQueue } from "./queue";

// The dev env variables (binary paths, test DB) live in apps/server/.env, as
// for `@docstore/db/test-utils`.
dotenv.config({
	path: fileURLToPath(new URL("../../../apps/server/.env", import.meta.url)),
	quiet: true,
});

/** Paths of the external binaries, read from the environment. */
export const testToolOptions: ExternalTools = {
	tesseractPath: process.env.TESSERACT_PATH || undefined,
	tessdataPrefix: process.env.TESSDATA_PREFIX || undefined,
	popplerPath: process.env.POPPLER_PATH || undefined,
};

/** PDF fixtures shared with `@docstore/ocr`. */
export const FIXTURES = {
	textLayerPdf: fileURLToPath(
		new URL("../../ocr/test/fixtures/text-layer.pdf", import.meta.url),
	),
	scannedPdf: fileURLToPath(
		new URL("../../ocr/test/fixtures/scanned.pdf", import.meta.url),
	),
	scannedPng: fileURLToPath(
		new URL("../../ocr/test/fixtures/scanned.png", import.meta.url),
	),
	/** Invoice carrying a valid SIRET (Party matching). */
	invoiceSiretPdf: fileURLToPath(
		new URL("../../ocr/test/fixtures/invoice-siret.pdf", import.meta.url),
	),
	/** Payslip carrying a covered period and a payment date (`analyze`). */
	payslipPeriodPdf: fileURLToPath(
		new URL("../../ocr/test/fixtures/payslip-period.pdf", import.meta.url),
	),
} as const;

export async function readFixture(path: string): Promise<Uint8Array> {
	return new Uint8Array(await Bun.file(path).arrayBuffer());
}

export interface TestIngestion {
	ctx: IngestionContext;
	/** Root of the temporary storage, to be deleted at the end of the test. */
	rootDir: string;
	cleanup(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Fake mailbox client                                                  */
/* ------------------------------------------------------------------ */

/** Message injected into `FakeMailClient`. */
export interface FakeMailMessage extends MailMessage {
	seen?: boolean;
}

/** Trace of the `afterImport` actions applied by the pipeline. */
export interface FakeMailActions {
	markedSeen: number[];
	moved: { uid: number; mailbox: string }[];
	deleted: number[];
}

export interface FakeMailClientOptions {
	messages: FakeMailMessage[];
	/** Simulates an authentication failure on connect. */
	failConnect?: string;
	actions?: FakeMailActions;
}

export function emptyMailActions(): FakeMailActions {
	return { markedSeen: [], moved: [], deleted: [] };
}

/**
 * In-memory mailbox: same contract as the real IMAP client, without network.
 * The filters (`onlyUnseen`, `from`, `subjectPattern`) are applied as on the
 * server side so that the tests exercise the real selection logic.
 */
export class FakeMailClient implements MailClient {
	readonly actions: FakeMailActions;
	private connected = false;

	constructor(private readonly options: FakeMailClientOptions) {
		this.actions = options.actions ?? emptyMailActions();
	}

	async connect(): Promise<void> {
		if (this.options.failConnect) {
			throw new MailConnectionError(this.options.failConnect);
		}
		this.connected = true;
	}

	private candidates(options: MailSearchOptions): FakeMailMessage[] {
		if (!this.connected) {
			throw new MailConnectionError("Client not connected.");
		}
		return this.options.messages
			.filter((message) => !options.onlyUnseen || !message.seen)
			.filter((message) => matchesMailFilters(message, options));
	}

	async count(options: MailSearchOptions): Promise<number> {
		return this.candidates(options).length;
	}

	async search(options: MailSearchOptions): Promise<MailMessage[]> {
		return this.candidates(options);
	}

	async markSeen(uid: number): Promise<void> {
		this.actions.markedSeen.push(uid);
		const message = this.options.messages.find((item) => item.uid === uid);
		if (message) message.seen = true;
	}

	async move(uid: number, mailbox: string): Promise<void> {
		this.actions.moved.push({ uid, mailbox });
	}

	async delete(uid: number): Promise<void> {
		this.actions.deleted.push(uid);
	}

	async close(): Promise<void> {
		this.connected = false;
	}
}

/**
 * Ingestion context on a throwaway storage.
 *
 * 200 dpi is enough for the fixtures (16 pt text) and divides the OCR time
 * compared to the 300 dpi default.
 */
export async function createTestIngestion(
	db: TestDb,
	options: {
		queue?: IngestionQueue;
		createMailClient?: MailClientFactory;
		decryptSecret?: (payload: string) => string;
		/** Recomputation run by the `reminders.generate` job. */
		generateReminders?: GenerateRemindersHook;
		/** Set to `false` to exercise a server without encryption at rest. */
		encryption?: boolean;
	} = {},
): Promise<TestIngestion> {
	const rootDir = await mkdtemp(join(tmpdir(), "docstore-ingestion-test-"));
	const ctx = createIngestionContext({
		db,
		storagePath: join(rootDir, "storage"),
		tools: testToolOptions,
		tmpDir: join(rootDir, "tmp"),
		ocrOptions: { dpi: 200 },
		queue: options.queue,
		createMailClient: options.createMailClient,
		generateReminders: options.generateReminders,
		// Encryption at rest is on by default in tests, as on a real server: the
		// key is throwaway, one per context.
		encryption:
			options.encryption === false
				? undefined
				: { masterKey: deriveStorageMasterKey(`test-${rootDir}`) },
		// Fake encryption: the ingestion tests do not have to know `APP_SECRET`,
		// only the "encrypted → plain" contract matters here.
		decryptSecret:
			options.decryptSecret ?? ((payload) => payload.replace(/^enc:/, "")),
	});
	return {
		ctx,
		rootDir,
		cleanup: async () => {
			await rm(rootDir, { recursive: true, force: true });
		},
	};
}

/**
 * Awaits the rejection of a promise and returns the error.
 *
 * `expect(promise).rejects` of Bun 1.3.13 hangs when the promise runs `pg`
 * queries: we go through an explicit `try/catch` instead.
 */
export async function expectRejection(
	promise: Promise<unknown>,
	// biome-ignore lint/suspicious/noExplicitAny: error constructor signature
	kind?: new (...args: any[]) => Error,
): Promise<Error> {
	try {
		await promise;
	} catch (error) {
		if (kind && !(error instanceof kind)) {
			throw new Error(
				`Expected error ${kind.name}, received ${(error as Error)?.name}: ${String(error)}`,
			);
		}
		return error as Error;
	}
	throw new Error(
		`The promise resolved while a${kind ? ` ${kind.name}` : ""} rejection was expected.`,
	);
}

/** Creates a user (documents reference `created_by_id`). */
export async function insertTestUser(db: TestDb): Promise<string> {
	const id = createId("usr_");
	await db.insert(user).values({
		id,
		name: "Camille Moreau",
		email: `camille-${createId("")}@example.com`,
	});
	return id;
}
