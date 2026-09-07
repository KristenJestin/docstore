import { env } from "@docstore/env/server";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

/**
 * Opens a Drizzle connection.
 *
 * `connectionString` wins over `DATABASE_URL`: the development launcher, the
 * worktree scripts and the test helpers all target another database than the
 * one the environment names, and they used to have to rebuild the whole
 * `drizzle(pool, { schema })` call by hand to get it.
 */
export function createDb(connectionString?: string) {
	return drizzle(connectionString ?? env.DATABASE_URL, { schema });
}

/**
 * Type of the Drizzle connection, to be injected into the services.
 *
 * `$client` is deliberately excluded: the `pg` pool must not leak into the
 * public API types (and it makes `.d.ts` emission non-portable).
 */
export type Db = NodePgDatabase<typeof schema>;

/** Connection of the running server, from `DATABASE_URL`. */
export const db = createDb();
