import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Everything the development scripts need to know about "where am I running":
 * the repository root, whether this checkout is a linked git worktree, and the
 * per-worktree names derived from it (database, storage folder, portless host).
 *
 * One worktree = one isolated environment. Two agents can therefore run
 * `bun run dev` at the same time without sharing a port, a database, a pg-boss
 * queue, a storage folder or a session cookie.
 */

/** Root of the checkout this file belongs to (worktree root when in one). */
export const REPO_ROOT = resolve(
	fileURLToPath(new URL("../..", import.meta.url)),
);

/** Base name of the databases: `docstore`, then `docstore_wt_<slug>`. */
export const DB_BASE_NAME = "docstore";

/** Prefix of the per-worktree databases, also used by `wt:remove`. */
export const WORKTREE_DB_PREFIX = `${DB_BASE_NAME}_wt_`;

/** Name registered with portless; the worktree prefix is added by portless. */
export const PORTLESS_APP_NAME = "docstore";

export interface Workspace {
	/** Absolute path of this checkout. */
	root: string;
	/** True when this checkout is a linked worktree rather than the main one. */
	isWorktree: boolean;
	/** Branch (or folder) name of the worktree; empty on the main checkout. */
	name: string;
	/** Hostname-safe form of `name`; empty on the main checkout. */
	slug: string;
}

export function git(args: string[], cwd = REPO_ROOT): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Case-insensitive path comparison — Windows reports drive letters both ways. */
function samePath(a: string, b: string): boolean {
	const normalize = (value: string) =>
		process.platform === "win32"
			? resolve(value).toLowerCase()
			: resolve(value);
	return normalize(a) === normalize(b);
}

/**
 * `feat/fix-ui` → `feat-fix-ui`. Kept to `[a-z0-9-]` so the same value is valid
 * as a hostname label, a folder name and (with `-` turned into `_`) a
 * PostgreSQL identifier.
 */
export function slugify(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Detects the current worktree.
 *
 * The first entry of `git worktree list --porcelain` is always the main
 * worktree, so comparing it with the current top level is what tells the two
 * apart. The name is the checked-out branch, falling back to the folder name
 * when HEAD is detached.
 */
export function resolveWorkspace(): Workspace {
	const root = git(["rev-parse", "--show-toplevel"]);
	const listed = git(["worktree", "list", "--porcelain"])
		.split(/\r?\n/)
		.find((line) => line.startsWith("worktree "));
	const mainRoot = listed ? listed.slice("worktree ".length) : root;

	if (samePath(root, mainRoot)) {
		return { root, isWorktree: false, name: "", slug: "" };
	}

	const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
	const name = branch && branch !== "HEAD" ? branch : basename(root);
	return { root, isWorktree: true, name, slug: slugify(name) };
}

/** `docstore` on the main checkout, `docstore_wt_feat_fix_ui` in a worktree. */
export function databaseNameFor(workspace: Workspace): string {
	if (!workspace.isWorktree) return DB_BASE_NAME;
	return `${WORKTREE_DB_PREFIX}${workspace.slug.replace(/-/g, "_")}`;
}

/** Same server and credentials as the configured URL, another database. */
export function withDatabase(
	connectionString: string,
	database: string,
): string {
	const url = new URL(connectionString);
	url.pathname = `/${database}`;
	return url.toString();
}

/**
 * Main worktree: `STORAGE_PATH` from `.env` when set, else `<root>/.data/storage`.
 * Linked worktree: `<base>-<slug>` so each checkout keeps its own files.
 */
export function storagePathFor(
	workspace: Workspace,
	envStoragePath?: string,
): string {
	const base =
		envStoragePath?.trim() || join(workspace.root, ".data", "storage");
	return workspace.isWorktree ? `${base}-${workspace.slug}` : base;
}

/**
 * Public host portless serves the app on. portless derives it itself from the
 * worktree; this mirrors the rule so the API can be handed a matching
 * `BETTER_AUTH_URL` before the child has printed anything, and so the launcher
 * can warn when the two disagree.
 */
export function portlessUrlFor(workspace: Workspace): string {
	const host = workspace.isWorktree
		? `${workspace.slug}.${PORTLESS_APP_NAME}.localhost`
		: `${PORTLESS_APP_NAME}.localhost`;
	return `https://${host}`;
}

/**
 * Loads `apps/server/.env` into `process.env` and returns it.
 *
 * Everything the launcher does not override (external tool paths, secrets,
 * `DATABASE_URL_TEST`…) is passed through to the child processes untouched.
 */
export function loadServerEnv(root = REPO_ROOT): Record<string, string> {
	const path = join(root, "apps", "server", ".env");
	if (!existsSync(path)) {
		throw new Error(
			`Missing ${path}. Copy apps/server/.env.example and fill in the secrets.`,
		);
	}
	const result = dotenv.config({ path, quiet: true });
	if (result.error) throw result.error;
	return (result.parsed ?? {}) as Record<string, string>;
}
