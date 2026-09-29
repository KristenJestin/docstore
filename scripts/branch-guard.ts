import { spawnSync } from "node:child_process";
import { validateBranch } from "./commit-message";

/**
 * Refuses a commit made directly on a protected branch. Lefthook runs it as a
 * `pre-commit` job.
 *
 *   bun scripts/branch-guard.ts [branch]
 *
 * Without an argument, the branch is the one checked out in the current
 * directory. A detached HEAD (rebase, bisect) reads as `HEAD` and is allowed.
 */

function currentBranch(): string {
	const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		console.error(result.stderr.trim() || "git rev-parse failed");
		process.exit(2);
	}
	return result.stdout.trim();
}

if (import.meta.main) {
	const branch = process.argv[2] ?? currentBranch();
	const result = validateBranch(branch);
	if (!result.ok) {
		console.error(`commit rejected: ${result.error}`);
		process.exit(1);
	}
}
