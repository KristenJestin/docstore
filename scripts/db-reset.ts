import { spawn } from "node:child_process";
import { join } from "node:path";
import {
	databaseNameFor,
	loadServerEnv,
	resolveWorkspace,
	withDatabase,
} from "./lib/workspace";

/**
 * `bun run db:reset --yes` — drops, recreates, migrates and seeds the database
 * of the **current** checkout (`docstore`, or `docstore_wt_<slug>` in a
 * worktree). Destructive, hence the explicit flag.
 */

const confirmed = process.argv.includes("--yes") || process.argv.includes("-y");

const workspace = resolveWorkspace();
const serverEnv = loadServerEnv(workspace.root);

const baseDatabaseUrl = serverEnv.DATABASE_URL;
if (!baseDatabaseUrl) {
	console.error("[db] DATABASE_URL is missing from apps/server/.env.");
	process.exit(1);
}

const database = databaseNameFor(workspace);

if (!confirmed) {
	console.error(
		`[db] this drops the database "${database}" (worktree: ${
			workspace.isWorktree ? workspace.name : "main"
		}) and every document it holds.\n` +
			"[db] re-run with --yes to confirm: bun run db:reset --yes",
	);
	process.exit(1);
}

const child = spawn(
	"bun",
	["run", join("packages", "db", "src", "dev-db.ts"), "reset"],
	{
		cwd: workspace.root,
		env: {
			...process.env,
			DATABASE_URL: withDatabase(baseDatabaseUrl, database),
		},
		stdio: "inherit",
	},
);
child.on("exit", (code) => process.exit(code ?? 0));
