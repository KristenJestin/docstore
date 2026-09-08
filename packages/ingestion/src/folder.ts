import { access, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { IntakeSourceRow } from "@docstore/db/schema/intake";
import { ARCHIVE_MIME } from "@docstore/shared/archive";
import type { FolderConfig } from "@docstore/shared/intake";
import { sniffArchive } from "./archive";
import type { IngestionContext } from "./context";
import {
	ArchiveError,
	DuplicateOriginalError,
	UnsupportedMediaError,
} from "./errors";
import { intakeFile, isArchive, isDuplicate } from "./intake";
import type { IntakeRunResult } from "./intake-log";
import { emptyRunResult, logArchiveRun, logIntake } from "./intake-log";
import { MAGIC_BYTES_LENGTH, resolveIntakeMime } from "./media";

/**
 * Watched folder (SPEC §5, watched folder intake source).
 *
 * A folder scanner inevitably sees files that are still being written: the size
 * of each candidate is read twice, `stabilityDelayMs` apart, and only stable
 * files are ingested. The others come back on the next round.
 */

/** Delay between the two size readings. */
export const STABILITY_DELAY_MS = 2000;

/** Maximum depth explored in recursive mode. */
const MAX_DEPTH = 10;

/** Number of files processed per run. */
export const FOLDER_SCAN_LIMIT = 200;

export interface FolderRunOptions {
	/** Shortcut for the tests; 2 s in production. */
	stabilityDelayMs?: number;
	limit?: number;
}

function sleep(ms: number): Promise<void> {
	return new Promise((done) => setTimeout(done, ms));
}

/** Name filter expression, ignored if it is invalid. */
function filePatternOf(config: FolderConfig): RegExp | null {
	if (!config.filePattern) return null;
	try {
		return new RegExp(config.filePattern, "i");
	} catch {
		return null;
	}
}

/** Candidate files of the folder, sorted absolute paths. */
export async function scanFolderFiles(
	config: FolderConfig,
	limit = FOLDER_SCAN_LIMIT,
): Promise<string[]> {
	const root = resolve(config.path);
	const pattern = filePatternOf(config);
	const found: string[] = [];

	const walk = async (directory: string, depth: number): Promise<void> => {
		if (found.length >= limit) return;
		const entries = await readdir(directory, { withFileTypes: true });
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (found.length >= limit) return;
			// Hidden files and editor temporaries are not documents: a scanner that
			// picks them up mostly creates noise.
			if (entry.name.startsWith(".") || entry.name.endsWith("~")) continue;
			const full = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (config.recursive && depth < MAX_DEPTH) await walk(full, depth + 1);
				continue;
			}
			if (!entry.isFile()) continue;
			if (pattern && !pattern.test(entry.name)) continue;
			found.push(full);
		}
	};

	await walk(root, 0);
	return found;
}

/**
 * Only keeps the files whose size has not moved between two readings.
 * A single delay for the whole batch: two readings, not two per file.
 */
export async function stableFiles(
	paths: string[],
	delayMs = STABILITY_DELAY_MS,
): Promise<string[]> {
	if (paths.length === 0) return [];

	const first = new Map<string, number>();
	for (const path of paths) {
		try {
			first.set(path, (await stat(path)).size);
		} catch {
			// Gone between the scan and the reading: nothing to do.
		}
	}

	await sleep(delayMs);

	const stable: string[] = [];
	for (const [path, size] of first) {
		try {
			if ((await stat(path)).size === size) stable.push(path);
		} catch {
			// Same: the file is no longer there.
		}
	}
	return stable;
}

/** Free destination in `moveTo` (suffix `-1`, `-2`… on collision). */
async function freeDestination(
	directory: string,
	filename: string,
): Promise<string> {
	const extension = extname(filename);
	const stem = basename(filename, extension);
	for (let index = 0; index < 100; index++) {
		const candidate = join(
			directory,
			index === 0 ? filename : `${stem}-${index}${extension}`,
		);
		try {
			await access(candidate);
		} catch {
			return candidate;
		}
	}
	return join(directory, `${stem}-${Date.now()}${extension}`);
}

/** Applies `afterImport` to a processed file. */
export async function applyAfterImport(
	config: FolderConfig,
	path: string,
): Promise<void> {
	if (config.afterImport === "keep") return;
	if (config.afterImport === "delete") {
		await rm(path, { force: true });
		return;
	}
	if (!config.moveTo) return;
	const directory = resolve(config.moveTo);
	await mkdir(directory, { recursive: true });
	const destination = await freeDestination(directory, basename(path));
	try {
		await rename(path, destination);
	} catch {
		// `rename` fails across two file systems: copy then delete.
		await Bun.write(destination, Bun.file(path));
		await rm(path, { force: true });
	}
}

export interface FolderTestResult {
	ok: boolean;
	candidates: number;
	message: string;
}

/** `intakeSource.test` for a folder: readability and candidate files. */
export async function testFolderConfig(
	config: FolderConfig,
): Promise<FolderTestResult> {
	const root = resolve(config.path);
	try {
		const info = await stat(root);
		if (!info.isDirectory()) {
			return {
				ok: false,
				candidates: 0,
				message: `"${root}" is not a folder.`,
			};
		}
	} catch {
		return {
			ok: false,
			candidates: 0,
			message: `Folder "${root}" not found or unreadable.`,
		};
	}

	try {
		const files = await scanFolderFiles(config);
		return {
			ok: true,
			candidates: files.length,
			message: `Folder readable: ${files.length} candidate file(s).`,
		};
	} catch (error) {
		return {
			ok: false,
			candidates: 0,
			message: `Unable to read: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Polls a watched folder: ingestion of the stable files, logging and then
 * `afterImport`.
 *
 * An error on one file does not interrupt the run; it is logged and counted.
 * The file stays in place for the next pass.
 */
export async function runFolderSource(
	ctx: IngestionContext,
	source: IntakeSourceRow,
	config: FolderConfig,
	createdById: string,
	options: FolderRunOptions = {},
): Promise<IntakeRunResult> {
	const result = emptyRunResult();
	const scanned = await scanFolderFiles(
		config,
		options.limit ?? FOLDER_SCAN_LIMIT,
	);
	const files = await stableFiles(
		scanned,
		options.stabilityDelayMs ?? STABILITY_DELAY_MS,
	);
	result.skipped += scanned.length - files.length;

	for (const path of files) {
		const filename = basename(path);
		let data: Uint8Array;
		try {
			data = new Uint8Array(await Bun.file(path).arrayBuffer());
		} catch (error) {
			result.errors += 1;
			await logIntake(ctx.db, {
				sourceId: source.id,
				filename,
				outcome: "error",
				message: `Unable to read: ${error instanceof Error ? error.message : String(error)}`,
			});
			continue;
		}

		const head = data.subarray(0, MAGIC_BYTES_LENGTH);
		let mime: string;
		try {
			// A ZIP dropped in the folder is a container, not an unsupported type:
			// `intakeFile` expands or keeps it according to `intake.archives`.
			mime = sniffArchive(head)
				? ARCHIVE_MIME
				: resolveIntakeMime(head, filename);
		} catch (error) {
			if (!(error instanceof UnsupportedMediaError)) throw error;
			result.skipped += 1;
			await logIntake(ctx.db, {
				sourceId: source.id,
				filename,
				outcome: "skipped",
				message: error.message,
			});
			continue;
		}

		try {
			const outcome = await intakeFile(ctx, {
				data,
				filename,
				mime,
				createdById,
				source: "folder",
				sourceRef: source.id,
				defaults: source.defaults,
			});

			if (isArchive(outcome)) {
				await logArchiveRun(
					ctx.db,
					source.id,
					filename,
					outcome.archive,
					result,
				);
			} else if (isDuplicate(outcome)) {
				result.duplicates += 1;
				await logIntake(ctx.db, {
					sourceId: source.id,
					filename,
					outcome: "duplicate",
					documentId: outcome.duplicateOf,
					message: `Content already present (document ${outcome.duplicateOf}).`,
				});
			} else {
				result.imported += 1;
				await logIntake(ctx.db, {
					sourceId: source.id,
					filename,
					outcome: "imported",
					documentId: outcome.documentId,
				});
			}
			await applyAfterImport(config, path);
		} catch (error) {
			// A ZIP that cannot be expanded is skipped, not retried for ever: the
			// next poll would hit the same corrupt or locked file.
			if (error instanceof ArchiveError) {
				result.skipped += 1;
				await logIntake(ctx.db, {
					sourceId: source.id,
					filename,
					outcome: "skipped",
					message: error.message,
				});
				continue;
			}
			// Content attached to a document in the trash: the file stays in place,
			// deleting or moving it would lose the only copy.
			if (error instanceof DuplicateOriginalError) {
				result.duplicates += 1;
				await logIntake(ctx.db, {
					sourceId: source.id,
					filename,
					outcome: "duplicate",
					message: error.message,
				});
				continue;
			}
			result.errors += 1;
			await logIntake(ctx.db, {
				sourceId: source.id,
				filename,
				outcome: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return result;
}
