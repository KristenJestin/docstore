import type { Db } from "@docstore/db";
import type { IntakeSourceRow } from "@docstore/db/schema/intake";
import { intakeLog, intakeSource } from "@docstore/db/schema/intake";
import type { IngestionBinding } from "@docstore/ingestion";
import { testIntakeConfig } from "@docstore/ingestion";
import type {
	CreateIntakeSourceInput,
	IntakeLog,
	IntakeSource,
	IntakeSourceConfig,
	IntakeSourceConfigInput,
	ListIntakeLogsInput,
	RunIntakeSourceResult,
	TestIntakeSourceInput,
	TestIntakeSourceResult,
	ToggleIntakeSourceInput,
	UpdateIntakeSourceInput,
} from "@docstore/shared/intake";
import {
	EMPTY_INTAKE_STATS,
	MANAGED_INTAKE_SOURCE_MESSAGE,
	toPublicConfig,
} from "@docstore/shared/intake";
import type { Paginated } from "@docstore/shared/pagination";
import { paginationMeta } from "@docstore/shared/pagination";
import { ORPCError } from "@orpc/server";
import { asc, desc, eq, sql } from "drizzle-orm";
import { encryptSecret } from "./crypto.service";
import { assertIntakeDefaults } from "./intake-defaults.service";

/**
 * Intake channels (SPEC §2 "Misc", §5).
 *
 * The IMAP password comes in as plaintext and goes out encrypted: no procedure
 * reads it back. An `update` without `password` keeps the stored one.
 */

function toIntakeSource(row: IntakeSourceRow): IntakeSource {
	return {
		id: row.id,
		type: row.type,
		name: row.name,
		enabled: row.enabled,
		managed: row.managedKey !== null,
		managedKey: row.managedKey,
		config: toPublicConfig(row.config),
		defaults: row.defaults,
		lastRunAt: row.lastRunAt,
		lastError: row.lastError,
		stats: row.stats,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * Storable configuration: the plaintext password is encrypted, and its absence
 * keeps the existing secret.
 */
function toStoredConfig(
	input: IntakeSourceConfigInput,
	existing?: IntakeSourceConfig,
): IntakeSourceConfig {
	if (input.type === "folder") return input;
	const { password, ...rest } = input;
	const previous =
		existing?.type === "mail" ? existing.passwordEncrypted : null;
	return {
		...rest,
		passwordEncrypted: password ? encryptSecret(password) : previous,
	};
}

export async function listIntakeSources(db: Db): Promise<IntakeSource[]> {
	const rows = await db
		.select()
		.from(intakeSource)
		.orderBy(asc(intakeSource.createdAt), asc(intakeSource.id));
	return rows.map(toIntakeSource);
}

async function requireRow(db: Db, id: string): Promise<IntakeSourceRow> {
	const rows = await db
		.select()
		.from(intakeSource)
		.where(eq(intakeSource.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Intake source "${id}" not found.`,
		});
	}
	return row;
}

/**
 * Same as `requireRow`, for the procedures that write.
 *
 * A source declared in the configuration file is rewritten at every startup:
 * editing it here would be undone without warning, so it is refused. Reading,
 * testing and polling it stay allowed.
 */
async function requireEditableRow(
	db: Db,
	id: string,
): Promise<IntakeSourceRow> {
	const row = await requireRow(db, id);
	if (row.managedKey !== null) {
		throw new ORPCError("FORBIDDEN", {
			message: MANAGED_INTAKE_SOURCE_MESSAGE,
		});
	}
	return row;
}

export async function getIntakeSource(
	db: Db,
	id: string,
): Promise<IntakeSource> {
	return toIntakeSource(await requireRow(db, id));
}

export async function createIntakeSource(
	db: Db,
	input: CreateIntakeSourceInput,
): Promise<IntakeSource> {
	await assertIntakeDefaults(db, input.defaults);
	const config = toStoredConfig(input.config);
	const rows = await db
		.insert(intakeSource)
		.values({
			type: config.type,
			name: input.name,
			enabled: input.enabled,
			config,
			defaults: input.defaults,
			stats: EMPTY_INTAKE_STATS,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The intake source could not be created.",
		});
	}
	return toIntakeSource(row);
}

export async function updateIntakeSource(
	db: Db,
	input: UpdateIntakeSourceInput,
): Promise<IntakeSource> {
	const existing = await requireEditableRow(db, input.id);

	if (input.config && input.config.type !== existing.type) {
		throw new ORPCError("BAD_REQUEST", {
			message: "The type of an intake source cannot change.",
		});
	}

	if (input.defaults) await assertIntakeDefaults(db, input.defaults);

	const config = input.config
		? toStoredConfig(input.config, existing.config)
		: existing.config;

	const rows = await db
		.update(intakeSource)
		.set({
			name: input.name ?? existing.name,
			enabled: input.enabled ?? existing.enabled,
			config,
			defaults: input.defaults ?? existing.defaults,
		})
		.where(eq(intakeSource.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Intake source "${input.id}" not found.`,
		});
	}
	return toIntakeSource(row);
}

export async function toggleIntakeSource(
	db: Db,
	input: ToggleIntakeSourceInput,
): Promise<IntakeSource> {
	await requireEditableRow(db, input.id);
	const rows = await db
		.update(intakeSource)
		.set({ enabled: input.enabled })
		.where(eq(intakeSource.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Intake source "${input.id}" not found.`,
		});
	}
	return toIntakeSource(row);
}

export async function deleteIntakeSource(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	await requireEditableRow(db, id);
	await db.delete(intakeSource).where(eq(intakeSource.id, id));
	return { id, deleted: true };
}

/** Publishes an immediate poll. Without a queue, nothing is enqueued. */
export async function runIntakeSourceNow(
	db: Db,
	ingestion: IngestionBinding | undefined,
	id: string,
): Promise<RunIntakeSourceResult> {
	const row = await requireRow(db, id);
	if (!ingestion?.queue) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "The processing queue is not available on this server.",
		});
	}
	const jobId = await ingestion.queue.publishIntakePoll(row.type, row.id);
	return { id: row.id, jobId, queued: jobId !== null };
}

/**
 * Tests a stored source, an unpersisted draft, or a draft laid over a stored
 * source.
 *
 * In the last case the draft wins on every field, except the password: the edit
 * form never receives the stored secret, so an absent password means "keep the
 * one on file" — exactly like `update`.
 */
export async function testIntakeSource(
	db: Db,
	ingestion: IngestionBinding | undefined,
	input: TestIntakeSourceInput,
): Promise<TestIntakeSourceResult> {
	if (!ingestion) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "The ingestion pipeline is not available on this server.",
		});
	}

	const stored = input.id ? (await requireRow(db, input.id)).config : undefined;
	const draft = input.draft;

	if (!draft) {
		if (!stored) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Provide `id` or `draft`.",
			});
		}
		return testIntakeConfig(ingestion.ctx, stored);
	}

	if (stored && draft.type !== stored.type) {
		throw new ORPCError("BAD_REQUEST", {
			message: "The type of an intake source cannot change.",
		});
	}

	if (draft.type === "folder") {
		return testIntakeConfig(ingestion.ctx, draft);
	}

	// Mail: the plaintext password goes straight to the IMAP client rather than
	// being encrypted only to be decrypted one line later. Without one, the
	// stored (encrypted) secret is handed over and `testMailConfig` decrypts it.
	const { password, ...rest } = draft;
	const passwordEncrypted =
		!password && stored?.type === "mail" ? stored.passwordEncrypted : null;
	return testIntakeConfig(
		ingestion.ctx,
		{ ...rest, passwordEncrypted },
		password,
	);
}

export async function listIntakeLogs(
	db: Db,
	input: ListIntakeLogsInput,
): Promise<Paginated<IntakeLog>> {
	await requireRow(db, input.id);

	const totals = await db
		.select({ value: sql<number>`count(*)::int` })
		.from(intakeLog)
		.where(eq(intakeLog.sourceId, input.id));
	const total = totals[0]?.value ?? 0;

	const items = await db
		.select()
		.from(intakeLog)
		.where(eq(intakeLog.sourceId, input.id))
		.orderBy(desc(intakeLog.createdAt), desc(intakeLog.id))
		.limit(input.pageSize)
		.offset((input.page - 1) * input.pageSize);

	return {
		items,
		...paginationMeta(total, input.page, input.pageSize),
	};
}
