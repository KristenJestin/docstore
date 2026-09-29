import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Names of the test databases (issue #10).
 *
 * A test database is unique per checkout and per package:
 *
 * - main checkout: `docstore_test_<pkg>` (`docstore_test_api`…);
 * - linked worktree: `docstore_test_<scope>__<pkg>`, the scope being the
 *   branch (`fix/10-test-dbs` → `fix_10_test_dbs`);
 * - `TEST_DB_SUFFIX` replaces the scope, whatever the checkout.
 *
 * `truncateAll` empties the whole schema, so two runners sharing a database
 * wipe each other's fixtures, and concurrent `truncate … cascade` statements
 * deadlock. Keeping the package in every name is what lets Turbo run the
 * packages in parallel; keeping the scope is what lets several worktrees run
 * the suite at the same time on the shared dev Postgres.
 *
 * This module has no side effect (no dotenv, no database): `scripts/worktree.ts`
 * uses it to find the test databases of a worktree it removes.
 */

export const TEST_DB_PREFIX = "docstore_test_";

/**
 * Between the scope and the package. `identifier` collapses every run of
 * separators into one `_`, so a scope never contains `__`: the prefix of one
 * worktree (`docstore_test_fix_x__`) can never match the databases of another
 * one whose branch merely starts the same way (`fix_x_2__api`).
 */
const SCOPE_SEPARATOR = "__";

/** PostgreSQL truncates identifiers beyond 63 bytes. */
const MAX_IDENTIFIER_LENGTH = 63;

/** Longest scope kept verbatim; longer ones are shortened with a hash. */
const MAX_SCOPE_LENGTH = 24;

/** Root of the checkout this file belongs to (worktree root when in one). */
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * `@docstore/api` → `api`, `feat/Été-x` → `feat_ete_x`: lowercase ASCII,
 * digits and single underscores, as in the worktree databases of
 * `scripts/lib/workspace.ts`.
 */
export function identifier(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function shortHash(value: string): string {
	return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

/** Last segment of a package name, as an identifier: `@docstore/api` → `api`. */
export function packagePart(packageName: string): string {
	return identifier(packageName.split("/").pop() ?? packageName);
}

/**
 * Scope of a worktree from its branch (or folder) name. Long names keep a
 * readable head and a hash of the full name, so two long branches sharing
 * their first characters still get distinct databases.
 */
export function scopeFor(name: string): string | null {
	const scope = identifier(name);
	if (!scope) return null;
	if (scope.length <= MAX_SCOPE_LENGTH) return scope;
	const head = scope.slice(0, MAX_SCOPE_LENGTH - 9).replace(/_+$/g, "");
	return `${head}_${shortHash(scope)}`;
}

/**
 * Branch of the linked worktree rooted at `root`, or its folder name when HEAD
 * is detached; `null` on the main checkout (where `.git` is a directory) or
 * outside a git checkout.
 *
 * Read from the files git leaves behind rather than by spawning `git`, so it
 * works the same under Turbo's filtered environment.
 */
export function worktreeName(root: string = REPO_ROOT): string | null {
	const dotGit = join(root, ".git");
	try {
		if (!statSync(dotGit).isFile()) return null;
		const pointer = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m);
		if (!pointer?.[1]) return basename(resolve(root));
		const gitDir = isAbsolute(pointer[1].trim())
			? pointer[1].trim()
			: resolve(root, pointer[1].trim());
		const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
		const branch = head.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1];
		return branch ?? basename(resolve(root));
	} catch {
		return null;
	}
}

/**
 * Scope of the current run: `TEST_DB_SUFFIX` when set, else the worktree
 * branch, else none (main checkout).
 */
export function currentTestDbScope(
	env: Record<string, string | undefined> = process.env,
	root: string = REPO_ROOT,
): string | null {
	const override = env.TEST_DB_SUFFIX?.trim();
	if (override) return scopeFor(override);
	const name = worktreeName(root);
	return name ? scopeFor(name) : null;
}

/** Every test database of a scope starts with this (`wt:remove` drops them). */
export function testDbPrefix(scope: string | null): string {
	return scope ? `${TEST_DB_PREFIX}${scope}${SCOPE_SEPARATOR}` : TEST_DB_PREFIX;
}

/** `docstore_test_api`, `docstore_test_fix_10_test_dbs__api`… */
export function testDbName(part: string, scope: string | null): string {
	const name = `${testDbPrefix(scope)}${identifier(part)}`;
	if (name.length <= MAX_IDENTIFIER_LENGTH) return name;
	return `${name.slice(0, MAX_IDENTIFIER_LENGTH - 9)}_${shortHash(name)}`;
}
