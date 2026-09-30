import { spawnSync } from "node:child_process";

/**
 * Where `bun run wt <branch>` starts a branch from (issue #37).
 *
 * A new branch starts from the remote default branch (`origin/main`), fetched
 * first, never from the local `main`: the main checkout may not have pulled,
 * or may even be on another branch, and the worktree would then start from
 * old code.
 */

export const REMOTE = "origin";
const FALLBACK_DEFAULT_BRANCH = "main";

function gitIn(
	cwd: string,
	args: string[],
): { ok: boolean; stdout: string; stderr: string } {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	return {
		ok: result.status === 0,
		stdout: (result.stdout ?? "").trim(),
		stderr: (result.stderr ?? "").trim(),
	};
}

function refExists(cwd: string, ref: string): boolean {
	return gitIn(cwd, ["show-ref", "--verify", "--quiet", ref]).ok;
}

/** `git fetch origin`; throws with git's message when it fails. */
export function fetchRemote(cwd: string): void {
	const result = gitIn(cwd, ["fetch", "--quiet", REMOTE]);
	if (!result.ok) {
		throw new Error(
			`git fetch ${REMOTE} failed, so ${REMOTE}'s default branch may be stale:\n${result.stderr}`,
		);
	}
}

/**
 * The remote default branch as a remote-tracking ref name (`origin/main`):
 * what `refs/remotes/origin/HEAD` points at, else `origin/main`.
 */
export function remoteDefaultBranch(cwd: string): string {
	const head = gitIn(cwd, [
		"symbolic-ref",
		"--quiet",
		"--short",
		`refs/remotes/${REMOTE}/HEAD`,
	]);
	const branch =
		head.ok && head.stdout
			? head.stdout
			: `${REMOTE}/${FALLBACK_DEFAULT_BRANCH}`;
	if (!refExists(cwd, `refs/remotes/${branch}`)) {
		throw new Error(
			`${branch} does not exist: nothing to start a branch from.`,
		);
	}
	return branch;
}

/**
 * Arguments of the `git worktree add` that checks out `branch` in `target`:
 * - a local branch of that name is checked out as is;
 * - a branch that only exists on the remote is checked out tracking it;
 * - otherwise the branch is created from the remote default branch, without
 *   an upstream (the first `git push -u` sets it).
 *
 * Fetches the remote first, so both the remote branches and the default
 * branch are up to date.
 */
export function worktreeAddArgs(
	cwd: string,
	branch: string,
	target: string,
): string[] {
	fetchRemote(cwd);
	if (refExists(cwd, `refs/heads/${branch}`)) {
		return ["worktree", "add", target, branch];
	}
	if (refExists(cwd, `refs/remotes/${REMOTE}/${branch}`)) {
		return [
			"worktree",
			"add",
			"--track",
			"-b",
			branch,
			target,
			`${REMOTE}/${branch}`,
		];
	}
	return [
		"worktree",
		"add",
		"--no-track",
		"-b",
		branch,
		target,
		remoteDefaultBranch(cwd),
	];
}
