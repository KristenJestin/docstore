import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { appendFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { document } from "@docstore/db/schema/document";
import { intakeLog, intakeSource } from "@docstore/db/schema/intake";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import type { FolderConfig } from "@docstore/shared/intake";
import { asc, eq } from "drizzle-orm";
import type { IngestionContext } from "./context";
import { scanFolderFiles, stableFiles } from "./folder";
import { runIntakeSource } from "./intake-source";
import {
	createTestIngestion,
	FIXTURES,
	insertTestUser,
	readFixture,
	type TestIngestion,
} from "./test-utils";

let db: TestDb;
let ingestion: TestIngestion;
let ctx: IngestionContext;
let userId: string;
let inbox: string;
let archive: string;
let textLayerPdf: Uint8Array;
let scannedPdf: Uint8Array;

/** Shortened stability delay: the tests do not wait 2 s per run. */
const STABILITY_MS = 120;

beforeAll(async () => {
	db = await createTestDb();
	ingestion = await createTestIngestion(db);
	ctx = ingestion.ctx;
	textLayerPdf = await readFixture(FIXTURES.textLayerPdf);
	scannedPdf = await readFixture(FIXTURES.scannedPdf);
});

afterAll(async () => {
	await ingestion.cleanup();
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	userId = await insertTestUser(db);
	const root = await mkdtemp(join(tmpdir(), "docstore-inbox-"));
	inbox = join(root, "inbox");
	archive = join(root, "archive");
	await mkdir(inbox, { recursive: true });
});

/** Creates a watched folder source pointing at the test tmpdir. */
async function createFolderSource(
	overrides: Partial<FolderConfig> = {},
): Promise<string> {
	const config: FolderConfig = {
		type: "folder",
		path: inbox,
		recursive: false,
		pollSeconds: 30,
		afterImport: "keep",
		...overrides,
	};
	const rows = await db
		.insert(intakeSource)
		.values({
			type: "folder",
			name: "Living room scanner",
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

async function logsOf(sourceId: string) {
	return db
		.select()
		.from(intakeLog)
		.where(eq(intakeLog.sourceId, sourceId))
		.orderBy(asc(intakeLog.filename), asc(intakeLog.createdAt));
}

describe("scanFolderFiles", () => {
	test("ignores hidden files and honours `filePattern`", async () => {
		await Bun.write(join(inbox, "a.pdf"), textLayerPdf);
		await Bun.write(join(inbox, ".hidden.pdf"), textLayerPdf);
		await Bun.write(join(inbox, "note.txt"), "hello");

		const all = await scanFolderFiles({
			type: "folder",
			path: inbox,
			recursive: false,
			pollSeconds: 30,
			afterImport: "keep",
		});
		expect(all.map((path) => path.split(/[\\/]/).pop())).toEqual([
			"a.pdf",
			"note.txt",
		]);

		const filtered = await scanFolderFiles({
			type: "folder",
			path: inbox,
			recursive: false,
			pollSeconds: 30,
			afterImport: "keep",
			filePattern: "\\.pdf$",
		});
		expect(filtered).toHaveLength(1);
	});

	test("descends into subfolders only when `recursive`", async () => {
		await mkdir(join(inbox, "2026"), { recursive: true });
		await Bun.write(join(inbox, "2026", "b.pdf"), textLayerPdf);

		const flat = await scanFolderFiles({
			type: "folder",
			path: inbox,
			recursive: false,
			pollSeconds: 30,
			afterImport: "keep",
		});
		expect(flat).toHaveLength(0);

		const deep = await scanFolderFiles({
			type: "folder",
			path: inbox,
			recursive: true,
			pollSeconds: 30,
			afterImport: "keep",
		});
		expect(deep).toHaveLength(1);
	});
});

describe("stableFiles", () => {
	test("discards a file whose size moves during the window", async () => {
		const growing = join(inbox, "in-progress.pdf");
		const settled = join(inbox, "finished.pdf");
		await Bun.write(growing, textLayerPdf);
		await Bun.write(settled, scannedPdf);

		const pending = stableFiles([growing, settled], STABILITY_MS);
		await appendFile(growing, "extra bytes");
		const stable = await pending;

		expect(stable).toEqual([settled]);
	});
});

describe("runIntakeSource (watched folder)", () => {
	test("imports the PDFs, skips the text file and reports the duplicate", async () => {
		await Bun.write(join(inbox, "invoice.pdf"), textLayerPdf);
		await Bun.write(join(inbox, "scan.pdf"), scannedPdf);
		await Bun.write(join(inbox, "notes.txt"), "this is not a document");
		// Same content as `invoice.pdf` under another name: caught by the hash.
		await Bun.write(join(inbox, "copy-invoice.pdf"), textLayerPdf);

		const sourceId = await createFolderSource();
		const result = await runIntakeSource(ctx, sourceId, {
			createdById: userId,
			stabilityDelayMs: STABILITY_MS,
		});

		expect(result.imported).toBe(2);
		expect(result.duplicates).toBe(1);
		expect(result.errors).toBe(0);
		expect(result.skipped).toBe(1);

		const documents = await db.select().from(document);
		expect(documents).toHaveLength(2);
		for (const row of documents) {
			expect(row.source).toBe("folder");
			expect(row.sourceRef).toBe(sourceId);
		}

		const logs = await logsOf(sourceId);
		const byName = new Map(logs.map((row) => [row.filename, row.outcome]));
		expect(byName.get("scan.pdf")).toBe("imported");
		expect(byName.get("notes.txt")).toBe("skipped");
		// The folder is walked in alphabetical order: the first of the two
		// identical copies is imported, the second becomes the duplicate.
		expect(byName.get("copy-invoice.pdf")).toBe("imported");
		expect(byName.get("invoice.pdf")).toBe("duplicate");

		const [source] = await db
			.select()
			.from(intakeSource)
			.where(eq(intakeSource.id, sourceId));
		expect(source?.stats).toEqual({ imported: 2, duplicates: 1, errors: 0 });
		expect(source?.lastError).toBeNull();
		expect(source?.lastRunAt).not.toBeNull();
	});

	test("`afterImport: move` moves the processed files, duplicate included", async () => {
		await Bun.write(join(inbox, "invoice.pdf"), textLayerPdf);
		await Bun.write(join(inbox, "copy.pdf"), textLayerPdf);
		await Bun.write(join(inbox, "notes.txt"), "not imported");

		const sourceId = await createFolderSource({
			afterImport: "move",
			moveTo: archive,
		});
		const result = await runIntakeSource(ctx, sourceId, {
			createdById: userId,
			stabilityDelayMs: STABILITY_MS,
		});

		expect(result.imported).toBe(1);
		expect(result.duplicates).toBe(1);

		expect((await readdir(archive)).sort()).toEqual([
			"copy.pdf",
			"invoice.pdf",
		]);
		// The skipped file stays in place: nothing was done with it.
		expect(await readdir(inbox)).toEqual(["notes.txt"]);
	});

	test("`afterImport: delete` deletes the imported files", async () => {
		await Bun.write(join(inbox, "invoice.pdf"), textLayerPdf);
		const sourceId = await createFolderSource({ afterImport: "delete" });

		await runIntakeSource(ctx, sourceId, {
			createdById: userId,
			stabilityDelayMs: STABILITY_MS,
		});

		expect(await readdir(inbox)).toEqual([]);
	});

	test("applies the default values of the source", async () => {
		await Bun.write(join(inbox, "payslip.pdf"), textLayerPdf);
		const sourceId = await createFolderSource();
		await db
			.update(intakeSource)
			.set({ defaults: { sensitive: true } })
			.where(eq(intakeSource.id, sourceId));

		await runIntakeSource(ctx, sourceId, {
			createdById: userId,
			stabilityDelayMs: STABILITY_MS,
		});

		const [row] = await db.select().from(document);
		expect(row?.sensitive).toBe(true);
	});

	test("a folder that cannot be found lands in `lastError`", async () => {
		const missing = join(inbox, "missing");
		const sourceId = await createFolderSource({ path: missing });

		const result = await runIntakeSource(ctx, sourceId, {
			createdById: userId,
			stabilityDelayMs: STABILITY_MS,
		});

		expect(result.imported).toBe(0);
		const [source] = await db
			.select()
			.from(intakeSource)
			.where(eq(intakeSource.id, sourceId));
		expect(source?.lastError).toBeTruthy();
	});

	test("does not touch a file that is still being written", async () => {
		const growing = join(inbox, "in-progress.pdf");
		await Bun.write(growing, textLayerPdf);
		const sourceId = await createFolderSource({ afterImport: "delete" });

		// The file grows without interruption: whenever the two size readings
		// happen, they cannot coincide.
		const writer = setInterval(() => {
			void appendFile(growing, "more of the scan is coming\n").catch(() => {});
		}, 20);
		let result: Awaited<ReturnType<typeof runIntakeSource>>;
		try {
			result = await runIntakeSource(ctx, sourceId, {
				createdById: userId,
				stabilityDelayMs: 400,
			});
		} finally {
			clearInterval(writer);
		}

		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(1);
		expect(await readdir(inbox)).toEqual(["in-progress.pdf"]);
		expect(await db.select().from(document)).toHaveLength(0);
	});
});
