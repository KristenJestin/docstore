import type { Db } from "@docstore/db";
import { user } from "@docstore/db/schema/auth";
import type { IntakeSourceRow } from "@docstore/db/schema/intake";
import { intakeSource } from "@docstore/db/schema/intake";
import type {
	IntakeSourceConfig,
	TestIntakeSourceResult,
} from "@docstore/shared/intake";
import { isDue } from "@docstore/shared/intake";
import { asc, eq } from "drizzle-orm";
import type { IngestionContext } from "./context";
import type { FolderRunOptions } from "./folder";
import { runFolderSource, testFolderConfig } from "./folder";
import type { IntakeRunResult } from "./intake-log";
import { emptyRunResult, finishRun } from "./intake-log";
import { runMailSource, testMailConfig } from "./mail-intake";

/**
 * Orchestration of the intake sources (SPEC §5).
 *
 * `dispatchIntakePolls` is the handler of the recurring `intake.poll` job: it
 * ingests nothing by itself, it elects the due sources and publishes one job per
 * source. `runIntakeSource` performs a run and keeps `last_run_at`,
 * `last_error` and `stats` up to date.
 */

/** Owner of the documents created by an automatic channel. */
export async function intakeOwnerId(db: Db): Promise<string | null> {
	// No source carries a user: the database is single-Household, the oldest
	// account acts as the owner of automatic imports.
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.orderBy(asc(user.createdAt), asc(user.id))
		.limit(1);
	return rows[0]?.id ?? null;
}

export async function loadIntakeSource(
	db: Db,
	id: string,
): Promise<IntakeSourceRow | null> {
	const rows = await db
		.select()
		.from(intakeSource)
		.where(eq(intakeSource.id, id))
		.limit(1);
	return rows[0] ?? null;
}

export async function listEnabledIntakeSources(
	db: Db,
): Promise<IntakeSourceRow[]> {
	return db
		.select()
		.from(intakeSource)
		.where(eq(intakeSource.enabled, true))
		.orderBy(asc(intakeSource.createdAt), asc(intakeSource.id));
}

export interface DispatchedPoll {
	sourceId: string;
	type: "folder" | "mail";
	jobId: string | null;
}

/**
 * `intake.poll` handler: publishes a run for each due source.
 *
 * Without a queue (tests, degraded server) nothing is published, but the list of
 * elected sources is returned: that is what the tests check.
 */
export async function dispatchIntakePolls(
	ctx: IngestionContext,
	now: Date = new Date(),
): Promise<DispatchedPoll[]> {
	const sources = await listEnabledIntakeSources(ctx.db);
	const dispatched: DispatchedPoll[] = [];

	for (const source of sources) {
		const config = source.config;
		if (!isDue(source.lastRunAt, config.pollSeconds, now)) continue;
		const jobId = ctx.queue
			? await ctx.queue.publishIntakePoll(source.type, source.id)
			: null;
		dispatched.push({ sourceId: source.id, type: source.type, jobId });
	}

	return dispatched;
}

export interface RunIntakeSourceOptions extends FolderRunOptions {
	/** Owner of the created documents; derived from the database if absent. */
	createdById?: string;
}

/**
 * Runs a complete poll for a source.
 *
 * Every error is captured: it lands in `last_error` and never prevents the
 * other sources from running (the pg-boss job therefore succeeds, and the
 * diagnostic stays visible on the source's page).
 */
export async function runIntakeSource(
	ctx: IngestionContext,
	sourceId: string,
	options: RunIntakeSourceOptions = {},
): Promise<IntakeRunResult> {
	const source = await loadIntakeSource(ctx.db, sourceId);
	if (!source) return emptyRunResult();

	const createdById = options.createdById ?? (await intakeOwnerId(ctx.db));
	if (!createdById) {
		await finishRun(
			ctx.db,
			sourceId,
			emptyRunResult(),
			new Error("No user: unable to assign the documents."),
		);
		return emptyRunResult();
	}

	try {
		const config = source.config;
		const result =
			config.type === "folder"
				? await runFolderSource(ctx, source, config, createdById, options)
				: await runMailSource(ctx, source, config, createdById);
		await finishRun(ctx.db, sourceId, result, null);
		return result;
	} catch (error) {
		const failed = emptyRunResult();
		failed.errors = 1;
		await finishRun(ctx.db, sourceId, failed, error);
		console.error(`[intake] source ${sourceId} failed`, error);
		return failed;
	}
}

/**
 * `intakeSource.test`: readable folder or reachable mailbox.
 *
 * `password` short-circuits the decryption: that is the case of a draft, whose
 * password has not been stored yet.
 */
export async function testIntakeConfig(
	ctx: IngestionContext,
	config: IntakeSourceConfig,
	password?: string,
): Promise<TestIntakeSourceResult> {
	return config.type === "folder"
		? testFolderConfig(config)
		: testMailConfig(ctx, config, password);
}
