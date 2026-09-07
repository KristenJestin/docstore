import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "@docstore/db";
import type {
	DefaultOcrProviderOptions,
	ExternalTools,
	OcrProvider,
	ResolvedTools,
} from "@docstore/ocr";
import { DefaultOcrProvider, resolveTools } from "@docstore/ocr";
import type { StorageDriver } from "@docstore/storage";
import { EncryptedStorageDriver, FsStorageDriver } from "@docstore/storage";
import type { MailClientFactory } from "./mail";
import { createImapClient } from "./mail-imap";
import type { IngestionQueue } from "./queue";
import type { IngestionWorker } from "./worker";

/**
 * Pipeline dependencies. Everything is injected: no ingestion module reads
 * `process.env` (see CLAUDE.md).
 */
export interface IngestionContext {
	db: Db;
	storage: StorageDriver;
	/** Root of the file storage (`STORAGE_PATH`), reported by `/health`. */
	storagePath: string;
	/**
	 * Storage for the files of documents flagged `sensitive` (SPEC §2): the same
	 * driver wrapped in AES-256-GCM encryption.
	 *
	 * Falls back to `storage` when no master key was supplied (unit contexts):
	 * `encryptionEnabled` says which of the two is in use, and
	 * `document_file.encrypted` records what was actually written.
	 */
	secureStorage: StorageDriver;
	/** True when `secureStorage` really encrypts. */
	encryptionEnabled: boolean;
	ocr: OcrProvider;
	tools: ResolvedTools;
	/** Working directory for temporary files. */
	tmpDir: string;
	/** Absent in unit tests: intake then publishes no job. */
	queue?: IngestionQueue;
	/**
	 * Reminder recomputation, run by the `reminders.generate` job.
	 *
	 * The function lives in `@docstore/api` (business services): it is injected
	 * by `apps/server` so as not to create an ingestion → api dependency.
	 */
	generateReminders?: GenerateRemindersHook;
	/**
	 * Decryption of stored secrets (IMAP password).
	 *
	 * The implementation lives in `@docstore/api` (`crypto.service`) and the key
	 * in `APP_SECRET`: it is injected by `apps/server` so as not to create an
	 * ingestion → api dependency nor to read the environment here.
	 */
	decryptSecret?: DecryptSecretHook;
	/** IMAP client factory; replaced by a fake in tests. */
	createMailClient?: MailClientFactory;
}

/** Signature of the reminder recomputation injected into the context. */
export type GenerateRemindersHook = (
	db: Db,
) => Promise<{ created: number; updated: number; removed: number }>;

/** Signature of the decryption injected into the context. */
export type DecryptSecretHook = (payload: string) => string;

/**
 * What the application (HTTP server, CLI) keeps at hand: the context, the queue
 * and, if the worker runs in the same process, its stop handle.
 */
export interface IngestionBinding {
	ctx: IngestionContext;
	/** Absent if the queue could not start, or in tests. */
	queue?: IngestionQueue;
	worker?: IngestionWorker;
}

export interface CreateIngestionContextOptions {
	db: Db;
	/** File storage root (`STORAGE_PATH`). */
	storagePath: string;
	/** Paths of the external binaries (tesseract, poppler). */
	tools?: ExternalTools;
	tmpDir?: string;
	queue?: IngestionQueue;
	/** Default OCR provider settings (render dpi, languages, timeout). */
	ocrOptions?: DefaultOcrProviderOptions;
	/** Reminder recomputation, injected by the server (see `IngestionContext`). */
	generateReminders?: GenerateRemindersHook;
	/** Decryption of stored secrets (see `IngestionContext`). */
	decryptSecret?: DecryptSecretHook;
	/** IMAP client factory; defaults to `imapflow`. */
	createMailClient?: MailClientFactory;
	/**
	 * Encryption at rest of sensitive documents. The master key is derived from
	 * `APP_SECRET` by `apps/server` (`deriveStorageMasterKey`): ingestion never
	 * reads the environment.
	 */
	encryption?: { masterKey: Uint8Array };
}

/** Default temporary directory. */
export function defaultTmpDir(): string {
	return join(tmpdir(), "docstore-ingestion");
}

/**
 * Builds the ingestion context: on-disk storage, resolved external tools and
 * the default OCR provider.
 *
 * Throws `MissingToolError` if a binary cannot be found.
 */
export function createIngestionContext(
	options: CreateIngestionContextOptions,
): IngestionContext {
	const tools = resolveTools(options.tools ?? {});
	const storage = new FsStorageDriver({ rootDir: options.storagePath });
	const masterKey = options.encryption?.masterKey;
	return {
		db: options.db,
		storage,
		storagePath: options.storagePath,
		secureStorage: masterKey
			? new EncryptedStorageDriver(storage, { masterKey })
			: storage,
		encryptionEnabled: Boolean(masterKey),
		ocr: new DefaultOcrProvider(tools, options.ocrOptions),
		tools,
		tmpDir: options.tmpDir ?? defaultTmpDir(),
		queue: options.queue,
		generateReminders: options.generateReminders,
		decryptSecret: options.decryptSecret,
		createMailClient: options.createMailClient ?? createImapClient,
	};
}
