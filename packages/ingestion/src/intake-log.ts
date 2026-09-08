import type { Db } from "@docstore/db";
import { intakeLog, intakeSource } from "@docstore/db/schema/intake";
import type { ArchiveResult } from "@docstore/shared/archive";
import { archiveEntryRef } from "@docstore/shared/archive";
import type { IntakeOutcome, IntakeStats } from "@docstore/shared/intake";
import { INTAKE_LOG_RETENTION_DAYS } from "@docstore/shared/intake";
import { eq, lt } from "drizzle-orm";

/**
 * Intake source log (`intake_log`) and counters of a source.
 *
 * Leaf module: neither `folder.ts` nor `mail-intake.ts` depends on the other,
 * both go through here.
 */

/** Outcome of a run, accumulated in `intake_source.stats`. */
export interface IntakeRunResult {
	imported: number;
	duplicates: number;
	errors: number;
	skipped: number;
}

export function emptyRunResult(): IntakeRunResult {
	return { imported: 0, duplicates: 0, errors: 0, skipped: 0 };
}

/** Maximum length kept in `intake_log.message` and `last_error`. */
const MAX_MESSAGE_LENGTH = 2000;

export interface IntakeLogEntry {
	sourceId: string;
	filename: string;
	outcome: IntakeOutcome;
	documentId?: string | null;
	message?: string | null;
}

/** Writes a log row; a write failure does not block the run. */
export async function logIntake(db: Db, entry: IntakeLogEntry): Promise<void> {
	try {
		await db.insert(intakeLog).values({
			sourceId: entry.sourceId,
			documentId: entry.documentId ?? null,
			filename: entry.filename.slice(0, 500),
			outcome: entry.outcome,
			message: entry.message?.slice(0, MAX_MESSAGE_LENGTH) ?? null,
		});
	} catch (error) {
		console.error("[intake] unable to write the log entry", error);
	}
}

/**
 * Journals what an archive produced: one row per entry, so the log of a
 * source reads the same whether the file arrived alone or inside a ZIP.
 *
 * The archive itself only gets a row when it was kept as a document; in
 * `extract` mode it leaves nothing behind but its entries.
 */
export async function logArchiveRun(
	db: Db,
	sourceId: string,
	filename: string,
	archive: ArchiveResult,
	result: IntakeRunResult,
): Promise<void> {
	if (archive.archiveDocumentId) {
		result.imported += 1;
		await logIntake(db, {
			sourceId,
			filename,
			outcome: "imported",
			documentId: archive.archiveDocumentId,
			message: `Archive kept (${archive.mode}).`,
		});
	}
	for (const entry of archive.extracted) {
		result.imported += 1;
		await logIntake(db, {
			sourceId,
			filename: archiveEntryRef(filename, entry.entry),
			outcome: "imported",
			documentId: entry.documentId,
		});
	}
	for (const entry of archive.duplicates) {
		result.duplicates += 1;
		await logIntake(db, {
			sourceId,
			filename: archiveEntryRef(filename, entry.entry),
			outcome: "duplicate",
			documentId: entry.duplicateOf || null,
			message: entry.trashed
				? "Content already stored on a document in the trash."
				: `Content already present (document ${entry.duplicateOf}).`,
		});
	}
	for (const entry of archive.skipped) {
		result.skipped += 1;
		await logIntake(db, {
			sourceId,
			filename: archiveEntryRef(filename, entry.entry),
			outcome: "skipped",
			message: entry.message,
		});
	}
}

/** Records the end of a run: timestamp, error and accumulated counters. */
export async function finishRun(
	db: Db,
	sourceId: string,
	result: IntakeRunResult,
	error?: unknown,
): Promise<void> {
	const rows = await db
		.select({ stats: intakeSource.stats })
		.from(intakeSource)
		.where(eq(intakeSource.id, sourceId))
		.limit(1);
	const current: IntakeStats = rows[0]?.stats ?? {
		imported: 0,
		duplicates: 0,
		errors: 0,
	};

	const message =
		error === undefined || error === null
			? null
			: (error instanceof Error ? error.message : String(error)).slice(
					0,
					MAX_MESSAGE_LENGTH,
				);

	await db
		.update(intakeSource)
		.set({
			lastRunAt: new Date(),
			lastError: message,
			stats: {
				imported: current.imported + result.imported,
				duplicates: current.duplicates + result.duplicates,
				errors: current.errors + result.errors,
			},
		})
		.where(eq(intakeSource.id, sourceId));
}

/**
 * Purges the log beyond the retention window (30 days).
 * Called at server startup.
 */
export async function purgeIntakeLogs(
	db: Db,
	retentionDays: number = INTAKE_LOG_RETENTION_DAYS,
): Promise<number> {
	const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
	const deleted = await db
		.delete(intakeLog)
		.where(lt(intakeLog.createdAt, cutoff))
		.returning({ id: intakeLog.id });
	return deleted.length;
}
