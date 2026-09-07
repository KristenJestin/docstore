import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	databaseNameFor,
	git,
	loadServerEnv,
	REPO_ROOT,
	slugify,
	withDatabase,
} from "./lib/workspace";

/**
 * Worktree helper.
 *
 * `bun run wt <branch>` creates `../docstore-v2.worktrees/<slug>`, copies the
 * server environment into it and installs its dependencies; `bun run dev` there
 * then gets its own URL, database, storage folder and API port.
 *
 * `bun run wt:remove <branch> --yes` removes the worktree and drops its
 * database.
 *
 * The folder is named after the slug rather than the raw branch so a `feat/x`
 * branch does not create a nested folder — and so that the folder name, the
 * database name and the portless hostname all agree.
 */

const WORKTREES_DIRNAME = "docstore-v2.worktrees";

/** Root of the main checkout, whichever worktree this script runs from. */
function mainRoot(): string {
	const listed = git(["worktree", "list", "--porcelain"])
		.split(/\r?\n/)
		.find((line) => line.startsWith("worktree "));
	return listed ? resolve(listed.slice("worktree ".length)) : REPO_ROOT;
}

function worktreePath(root: string, slug: string): string {
	return join(dirname(root), WORKTREES_DIRNAME, slug);
}

function runOrDie(
	command: string,
	args: string[],
	cwd: string,
	label: string,
): void {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	if (result.status !== 0) {
		console.error(`[wt] ${label} failed.`);
		process.exit(result.status ?? 1);
	}
}

function branchExists(root: string, branch: string): boolean {
	return (
		spawnSync(
			"git",
			["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
			{
				cwd: root,
			},
		).status === 0
	);
}

function add(branch: string): void {
	const root = mainRoot();
	const slug = slugify(branch);
	if (!slug) {
		console.error(`[wt] "${branch}" does not yield a usable name.`);
		process.exit(1);
	}
	const target = worktreePath(root, slug);
	if (existsSync(target)) {
		console.error(`[wt] ${target} already exists.`);
		process.exit(1);
	}
	mkdirSync(dirname(target), { recursive: true });

	const args = branchExists(root, branch)
		? ["worktree", "add", target, branch]
		: ["worktree", "add", "-b", branch, target];
	runOrDie("git", args, root, `git ${args.join(" ")}`);

	// `.env` is gitignored, so a fresh worktree has none: the secrets, the
	// Postgres credentials and the external tool paths are copied over. Only the
	// database name changes, and `scripts/dev.ts` derives that at runtime.
	const source = join(root, "apps", "server", ".env");
	if (existsSync(source)) {
		copyFileSync(source, join(target, "apps", "server", ".env"));
		console.log("[wt] copied apps/server/.env");
	} else {
		console.log(
			"[wt] no apps/server/.env to copy — create one in the worktree.",
		);
	}

	runOrDie("bun", ["install"], target, "bun install");

	console.log(
		[
			"",
			`[wt] worktree ready: ${target}`,
			`[wt] branch:        ${branch}`,
			`[wt] database:      ${databaseNameFor({ root: target, isWorktree: true, name: branch, slug })}`,
			"",
			`  cd ${target}`,
			"  bun run dev",
			"",
		].join("\n"),
	);
}

function remove(branch: string, confirmed: boolean): void {
	const root = mainRoot();
	const slug = slugify(branch);
	const target = worktreePath(root, slug);
	const database = databaseNameFor({
		root: target,
		isWorktree: true,
		name: branch,
		slug,
	});

	if (!confirmed) {
		console.error(
			`[wt] this removes ${target} and drops the database "${database}".\n` +
				`[wt] re-run with --yes: bun run wt:remove ${branch} --yes`,
		);
		process.exit(1);
	}

	if (existsSync(target)) {
		const result = spawnSync("git", ["worktree", "remove", "--force", target], {
			cwd: root,
			stdio: "inherit",
		});
		if (result.status !== 0) {
			// A leftover folder (dev server still holding a file) should not stop
			// the database cleanup.
			rmSync(target, { recursive: true, force: true });
		}
		console.log(`[wt] removed ${target}`);
	} else {
		spawnSync("git", ["worktree", "prune"], { cwd: root, stdio: "inherit" });
		console.log(`[wt] ${target} was already gone.`);
	}

	const baseDatabaseUrl = loadServerEnv(root).DATABASE_URL;
	if (!baseDatabaseUrl) {
		console.log("[wt] no DATABASE_URL: database left untouched.");
		return;
	}
	const dropped = spawnSync(
		"bun",
		["run", join("packages", "db", "src", "dev-db.ts"), "drop"],
		{
			cwd: root,
			env: {
				...process.env,
				DATABASE_URL: withDatabase(baseDatabaseUrl, database),
			},
			stdio: "inherit",
		},
	);
	if (dropped.status !== 0) process.exit(dropped.status ?? 1);
	console.log(`[wt] dropped database ${database}`);
}

const [command, ...rest] = process.argv.slice(2);
const flags = rest.filter((arg) => arg.startsWith("-"));
const branch = rest.find((arg) => !arg.startsWith("-"));

if (!branch) {
	console.error(
		"[wt] usage: bun run wt <branch> | bun run wt:remove <branch> --yes",
	);
	process.exit(1);
}

if (command === "add") {
	add(branch);
} else if (command === "remove") {
	remove(branch, flags.includes("--yes") || flags.includes("-y"));
} else {
	console.error(`[wt] unknown command "${command}" (add | remove).`);
	process.exit(1);
}
