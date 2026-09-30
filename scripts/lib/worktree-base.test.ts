import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remoteDefaultBranch, worktreeAddArgs } from "./worktree-base";

const temporary: string[] = [];

afterEach(() => {
	for (const path of temporary.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

function git(cwd: string, args: string[]): string {
	const result = spawnSync(
		"git",
		[
			"-c",
			"user.name=test",
			"-c",
			"user.email=test@example.invalid",
			"-c",
			"commit.gpgsign=false",
			...args,
		],
		{ cwd, encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
	return result.stdout.trim();
}

function commit(cwd: string, message: string): string {
	writeFileSync(join(cwd, "file.txt"), `${message}\n`);
	git(cwd, ["add", "file.txt"]);
	git(cwd, ["commit", "--quiet", "--no-verify", "-m", message]);
	return git(cwd, ["rev-parse", "HEAD"]);
}

/**
 * A bare `origin` holding one commit on `main`, and a clone of it: the clone
 * plays the main checkout of `bun run wt`.
 */
function repositories(): { origin: string; clone: string; upstream: string } {
	const base = mkdtempSync(join(tmpdir(), "docstore-wt-"));
	temporary.push(base);
	const origin = join(base, "origin.git");
	const upstream = join(base, "upstream");
	const clone = join(base, "clone");
	git(base, ["init", "--quiet", "--bare", "--initial-branch=main", origin]);
	git(base, ["clone", "--quiet", origin, upstream]);
	git(upstream, ["checkout", "--quiet", "-b", "main"]);
	commit(upstream, "first");
	git(upstream, ["push", "--quiet", "origin", "main"]);
	git(base, ["clone", "--quiet", origin, clone]);
	return { origin, clone, upstream };
}

/** Runs the `git worktree add` the script would run, from the clone. */
function addWorktree(clone: string, branch: string): string {
	const target = join(clone, "..", "worktrees", branch.replace(/\//g, "-"));
	git(clone, worktreeAddArgs(clone, branch, target));
	return target;
}

describe("bun run wt: base branch (issue #37)", () => {
	test("with a local main behind origin/main, bun run wt feat/x creates feat/x at origin/main's commit", () => {
		const { clone, upstream } = repositories();
		const stale = git(clone, ["rev-parse", "main"]);
		// origin moves on; the clone has neither pulled nor fetched.
		const fresh = commit(upstream, "second");
		git(upstream, ["push", "--quiet", "origin", "main"]);

		const target = addWorktree(clone, "feat/x");

		expect(git(clone, ["rev-parse", "feat/x"])).toBe(fresh);
		expect(git(target, ["rev-parse", "HEAD"])).toBe(fresh);
		// The local main is left alone, still stale.
		expect(git(clone, ["rev-parse", "main"])).toBe(stale);
	});

	test("the main checkout being on another branch does not change the base", () => {
		const { clone, upstream } = repositories();
		git(clone, ["checkout", "--quiet", "-b", "chore/elsewhere"]);
		commit(clone, "local work");
		const fresh = commit(upstream, "second");
		git(upstream, ["push", "--quiet", "origin", "main"]);

		addWorktree(clone, "fix/y");

		expect(git(clone, ["rev-parse", "fix/y"])).toBe(fresh);
	});

	test("the new branch has no upstream until its first push", () => {
		const { clone } = repositories();
		addWorktree(clone, "feat/x");
		const upstream = spawnSync(
			"git",
			["rev-parse", "--abbrev-ref", "feat/x@{upstream}"],
			{ cwd: clone, encoding: "utf8" },
		);
		expect(upstream.status).not.toBe(0);
	});

	test("an existing local branch is checked out as is", () => {
		const { clone, upstream } = repositories();
		git(clone, ["branch", "feat/x"]);
		const local = git(clone, ["rev-parse", "feat/x"]);
		commit(upstream, "second");
		git(upstream, ["push", "--quiet", "origin", "main"]);

		const target = addWorktree(clone, "feat/x");

		expect(git(target, ["rev-parse", "HEAD"])).toBe(local);
	});

	test("a branch that only exists on origin is checked out tracking it", () => {
		const { clone, upstream } = repositories();
		git(upstream, ["checkout", "--quiet", "-b", "fix/z"]);
		const remote = commit(upstream, "remote work");
		git(upstream, ["push", "--quiet", "origin", "fix/z"]);

		const target = addWorktree(clone, "fix/z");

		expect(git(target, ["rev-parse", "HEAD"])).toBe(remote);
		expect(git(clone, ["rev-parse", "--abbrev-ref", "fix/z@{upstream}"])).toBe(
			"origin/fix/z",
		);
	});

	test("the base follows origin's default branch when it is not main", () => {
		const { origin, clone, upstream } = repositories();
		git(upstream, ["checkout", "--quiet", "-b", "trunk"]);
		const trunk = commit(upstream, "trunk work");
		git(upstream, ["push", "--quiet", "origin", "trunk"]);
		git(origin, ["symbolic-ref", "HEAD", "refs/heads/trunk"]);
		git(clone, ["fetch", "--quiet", "origin"]);
		git(clone, ["remote", "set-head", "origin", "--auto"]);

		expect(remoteDefaultBranch(clone)).toBe("origin/trunk");
		addWorktree(clone, "feat/x");
		expect(git(clone, ["rev-parse", "feat/x"])).toBe(trunk);
	});

	test("a failing fetch stops instead of branching from a stale ref", () => {
		const { clone } = repositories();
		git(clone, ["remote", "set-url", "origin", join(clone, "missing.git")]);
		expect(() =>
			worktreeAddArgs(clone, "feat/x", join(clone, "..", "wt")),
		).toThrow(/git fetch origin failed/);
	});
});
