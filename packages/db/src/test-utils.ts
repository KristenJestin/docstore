import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type * as schema from "./schema";

// Dev env variables live in apps/server/.env (same as drizzle.config.ts).
dotenv.config({
	path: fileURLToPath(new URL("../../../apps/server/.env", import.meta.url)),
	quiet: true,
});

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL("./migrations", import.meta.url),
);

export type TestDb = NodePgDatabase<typeof schema> & {
	$client: Pool;
	/** Connection string of the test database the tests run against. */
	connectionString: string;
};

/**
 * One test database per package.
 *
 * `truncateAll` empties the whole schema, so two packages sharing a single
 * database wipe each other's fixtures mid-test — and `truncate … cascade`
 * against concurrent transactions deadlocks, which is what made
 * `turbo run test` hang without `--concurrency=1`. Each package therefore gets
 * `docstore_test_<pkg>`, created on the fly.
 */
export const TEST_DB_PREFIX = "docstore_test_";

/** `@docstore/api` → `api`, `server` → `server`. */
function sanitize(name: string): string {
	return (name.split("/").pop() ?? name)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

/**
 * Name of the package being tested, read from the nearest `package.json`.
 *
 * `bun test` runs with the package directory as cwd (that is how Turbo invokes
 * it), so walking up from there lands on the right manifest.
 */
function packageSuffix(): string | null {
	let dir = process.cwd();
	for (let depth = 0; depth < 8; depth += 1) {
		try {
			const manifest = JSON.parse(
				readFileSync(join(dir, "package.json"), "utf8"),
			) as { name?: string };
			if (manifest.name) return sanitize(manifest.name) || null;
		} catch {
			// No manifest here: keep walking up.
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/** Same server and credentials as `DATABASE_URL_TEST`, another database. */
function withDatabase(connectionString: string, database: string): string {
	const url = new URL(connectionString);
	url.pathname = `/${database}`;
	return url.toString();
}

/**
 * `CREATE DATABASE` through a maintenance connection to `postgres`, when the
 * database does not exist yet. `42P04` means another package won the race,
 * which is exactly as good as creating it ourselves.
 */
async function ensureDatabase(
	connectionString: string,
	database: string,
): Promise<void> {
	const admin = new Pool({
		connectionString: withDatabase(connectionString, "postgres"),
		max: 1,
	});
	try {
		const found = await admin.query(
			"select 1 from pg_database where datname = $1",
			[database],
		);
		if (found.rowCount === 0) {
			// An identifier cannot be a bound parameter. The name is built from a
			// sanitized package name, never from user input.
			await admin.query(`create database "${database}"`);
		}
	} catch (error) {
		if ((error as { code?: string }).code !== "42P04") throw error;
	} finally {
		await admin.end();
	}
}

export interface CreateTestDbOptions {
	/**
	 * Database discriminator. Defaults to `TEST_DB_SUFFIX`, then to the name of
	 * the package being tested.
	 */
	suffix?: string;
}

/**
 * Opens a connection to the package's test database, creating it if needed, and
 * applies the migrations. Close it with `db.$client.end()`.
 *
 * The server and credentials come from `DATABASE_URL_TEST`; only the database
 * name changes. When no suffix can be determined, that URL is used as is.
 */
export async function createTestDb(
	options: CreateTestDbOptions = {},
): Promise<TestDb> {
	const connectionString = process.env.DATABASE_URL_TEST;
	if (!connectionString) {
		throw new Error("DATABASE_URL_TEST is required for DB integration tests.");
	}

	const suffix =
		options.suffix ?? process.env.TEST_DB_SUFFIX ?? packageSuffix();

	let target = connectionString;
	if (suffix) {
		const database = `${TEST_DB_PREFIX}${suffix}`;
		await ensureDatabase(connectionString, database);
		target = withDatabase(connectionString, database);
	}

	// Imported here rather than at the top of the file: `@docstore/db` validates
	// the whole server environment when it is evaluated, and the `dotenv.config`
	// call above is what makes those variables available.
	const { createDb } = await import("./index");
	const db = createDb(target) as TestDb;
	db.connectionString = target;
	await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db;
}

/** Empties every application table (the migrations table is preserved). */
export async function truncateAll(db: TestDb): Promise<void> {
	const result = await db.execute<{ tablename: string }>(sql`
		select tablename
		from pg_tables
		where schemaname = 'public'
			and tablename not like '\\_\\_drizzle%'
	`);

	const tables = result.rows.map((row) => `"public"."${row.tablename}"`);
	if (tables.length === 0) {
		return;
	}

	await db.execute(
		sql.raw(`truncate table ${tables.join(", ")} restart identity cascade`),
	);
}
