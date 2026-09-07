import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	databaseNameFor,
	loadServerEnv,
	resolveWorkspace,
	storagePathFor,
	withDatabase,
} from "./lib/workspace";

/**
 * `bun run db:demo` — fills the database of the **current** checkout with a
 * believable French household library: parties, document types, ~45 generated
 * PDFs ingested through the real pipeline, dossiers, reminders and a share
 * link. Everything is generated in code; the repository ships no fixture file.
 *
 * Same rule as `bun run db:reset`: the target is the database of this checkout
 * (`docstore`, or `docstore_wt_<slug>` in a worktree), never the one the
 * environment happens to name.
 *
 * ```sh
 * bun run db:demo            # on an empty store
 * bun run db:demo --reset    # drop, recreate, migrate, seed, then generate
 * bun run db:demo --force    # generate on top of an existing library
 * ```
 *
 * The generator itself lives in `scripts/lib/demo-run.ts`; this file only
 * resolves the workspace and hands it a matching environment.
 */

const KNOWN_FLAGS = new Set(["--reset", "--force", "--yes", "-y"]);

const args = process.argv.slice(2);
const unknown = args.find((arg) => !KNOWN_FLAGS.has(arg));
if (unknown) {
	console.error(`[demo] unknown flag "${unknown}" (--reset | --force).`);
	process.exit(1);
}

const workspace = resolveWorkspace();
const serverEnv = loadServerEnv(workspace.root);

const baseDatabaseUrl = serverEnv.DATABASE_URL;
if (!baseDatabaseUrl) {
	console.error("[demo] DATABASE_URL is missing from apps/server/.env.");
	process.exit(1);
}

const database = databaseNameFor(workspace);
const storagePath = storagePathFor(workspace, serverEnv.STORAGE_PATH);

if (args.includes("--reset")) {
	// The database is about to be dropped: the files it referenced would stay
	// behind as orphans, and the next run would write next to them.
	rmSync(storagePath, { recursive: true, force: true });
}
mkdirSync(storagePath, { recursive: true });

console.log(
	`[demo] worktree ${workspace.isWorktree ? workspace.name : "main"} — database ${database}`,
);

const child = spawn(
	"bun",
	["run", join("scripts", "lib", "demo-run.ts"), ...args],
	{
		cwd: workspace.root,
		env: {
			...process.env,
			...serverEnv,
			DATABASE_URL: withDatabase(baseDatabaseUrl, database),
			STORAGE_PATH: storagePath,
		},
		stdio: "inherit",
	},
);
child.on("exit", (code) => process.exit(code ?? 0));
