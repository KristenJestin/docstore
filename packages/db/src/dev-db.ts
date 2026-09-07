import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { createDb } from "./index";
import { seedIfEmpty, seedTaxonomy } from "./seed";

/**
 * Development database bootstrap, used by `scripts/dev.ts` and `bun run
 * db:reset`.
 *
 * Every git worktree runs against its own database (`docstore_wt_<slug>`), so
 * the launcher has to be able to create one on the fly, migrate it and seed it
 * before the server starts — exactly what `createTestDb` does for the test
 * databases, minus the truncation.
 *
 * It lives in this package rather than in `scripts/` because that is where
 * `pg`, `drizzle-orm`, the migrations and the seed are resolvable from; the
 * launcher drives it as a child process with `DATABASE_URL` in the environment.
 */

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL("./migrations", import.meta.url),
);

/** Maintenance connection: same server and credentials, `postgres` database. */
function maintenanceUrl(connectionString: string): string {
	const url = new URL(connectionString);
	url.pathname = "/postgres";
	return url.toString();
}

/** Database name carried by a connection string. */
export function databaseName(connectionString: string): string {
	return decodeURIComponent(
		new URL(connectionString).pathname.replace(/^\//, ""),
	);
}

async function withAdmin<T>(
	connectionString: string,
	run: (admin: Pool) => Promise<T>,
): Promise<T> {
	const admin = new Pool({
		connectionString: maintenanceUrl(connectionString),
		max: 1,
	});
	try {
		return await run(admin);
	} finally {
		await admin.end();
	}
}

/**
 * `CREATE DATABASE` when it does not exist yet. Returns `true` when this call
 * is the one that created it. `42P04` means someone else won the race, which is
 * exactly as good.
 */
export async function ensureDatabase(
	connectionString: string,
): Promise<boolean> {
	const database = databaseName(connectionString);
	return withAdmin(connectionString, async (admin) => {
		const found = await admin.query(
			"select 1 from pg_database where datname = $1",
			[database],
		);
		if (found.rowCount !== 0) return false;
		try {
			// An identifier cannot be a bound parameter. The name is derived from a
			// sanitized branch name, never from user input.
			await admin.query(`create database "${database}"`);
			return true;
		} catch (error) {
			if ((error as { code?: string }).code === "42P04") return false;
			throw error;
		}
	});
}

/**
 * `DROP DATABASE`, after kicking the sessions still connected to it — a dev
 * server or a Drizzle Studio left open would otherwise block the drop.
 */
export async function dropDatabase(connectionString: string): Promise<void> {
	const database = databaseName(connectionString);
	await withAdmin(connectionString, async (admin) => {
		await admin.query(
			`select pg_terminate_backend(pid)
			 from pg_stat_activity
			 where datname = $1 and pid <> pg_backend_pid()`,
			[database],
		);
		await admin.query(`drop database if exists "${database}"`);
	});
}

export interface PrepareResult {
	database: string;
	created: boolean;
	seeded: boolean;
}

/**
 * Creates the database if needed, applies the migrations and seeds the starter
 * taxonomy when it is still empty.
 */
export async function prepareDatabase(
	connectionString: string,
	options: { force?: boolean } = {},
): Promise<PrepareResult> {
	const created = await ensureDatabase(connectionString);
	// The connection string wins over `DATABASE_URL`: the launcher targets the
	// database of the current worktree, never the one the environment names.
	const db = createDb(connectionString);
	try {
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
		const result = options.force
			? await seedTaxonomy(db)
			: await seedIfEmpty(db);
		return {
			database: databaseName(connectionString),
			created,
			seeded: result !== null,
		};
	} finally {
		await db.$client.end();
	}
}

if (import.meta.main) {
	const command = process.argv[2] ?? "prepare";
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		console.error("[db] DATABASE_URL is required.");
		process.exit(1);
	}

	if (command === "drop") {
		// `wt:remove`: the worktree is gone, nothing to migrate afterwards.
		await dropDatabase(connectionString);
		console.log(`[db] ${databaseName(connectionString)}: dropped.`);
	} else if (command === "reset" || command === "prepare") {
		if (command === "reset") await dropDatabase(connectionString);
		const result = await prepareDatabase(connectionString);
		const state =
			command === "reset" ? "recreated" : result.created ? "created" : "ready";
		console.log(
			`[db] ${result.database}: ${state}, migrations applied${
				result.seeded ? ", taxonomy seeded" : ""
			}.`,
		);
	} else {
		console.error(
			`[db] unknown command "${command}" (prepare | reset | drop).`,
		);
		process.exit(1);
	}
}
