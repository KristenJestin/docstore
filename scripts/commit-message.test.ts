import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	commitsOf,
	validateBranch,
	validateCommitMessage,
} from "./commit-message";

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const COMMIT_MESSAGE = join(SCRIPTS, "commit-message.ts");
const BRANCH_GUARD = join(SCRIPTS, "branch-guard.ts");
const LEFTHOOK = join(SCRIPTS, "..", "lefthook.yml");

interface CommandResult {
	code: number;
	output: string;
}

function run(cwd: string, command: string, args: string[]): CommandResult {
	const result = spawnSync(command, args, { cwd, encoding: "utf8" });
	return {
		code: result.status ?? 1,
		output: `${result.stdout}${result.stderr}`,
	};
}

const temporary: string[] = [];

/** A throwaway repository on `main`, without hooks, holding one commit. */
function throwawayRepository(): string {
	const path = mkdtempSync(join(tmpdir(), "docstore-git-flow-"));
	temporary.push(path);
	run(path, "git", ["init", "--quiet", "--initial-branch=main"]);
	run(path, "git", ["config", "user.name", "test"]);
	run(path, "git", ["config", "user.email", "test@example.invalid"]);
	run(path, "git", ["config", "commit.gpgsign", "false"]);
	run(path, "git", ["config", "core.hooksPath", "/dev/null"]);
	commit(path, "chore(repo): seed the throwaway repository");
	return path;
}

function commit(path: string, message: string): void {
	writeFileSync(join(path, "file.txt"), `${message}\n`);
	run(path, "git", ["add", "file.txt"]);
	run(path, "git", ["commit", "--quiet", "-m", message]);
}

afterEach(() => {
	for (const path of temporary.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe("validateCommitMessage", () => {
	test.each([
		["wip", "does not match the convention"],
		["feat: add the dossier share link", "does not match the convention"],
		["style(web): reorder the imports", 'unknown type "style"'],
		["feature(api): add the dossier share link", 'unknown type "feature"'],
		["feat(api): Add the dossier share link", "uppercase subject"],
		["feat(api): add the dossier share link.", "ends with a period"],
		[`feat(api): ${"a".repeat(80)}`, "characters long"],
		["", "empty commit message"],
	])("%p is rejected", (message, reason) => {
		const result = validateCommitMessage(message);
		expect(result.ok).toBe(false);
		expect(result.error).toContain(reason);
	});

	test.each([
		"feat(api): add the dossier share link",
		"fix(shared): keep untouched fields when updating a document type",
		"build(hooks): check commit messages with lefthook",
		"ci(github): run the checks on every pull request",
		"perf(ingestion): skip the ocr pass when the pdf has a text layer",
		"Merge branch 'main' into feat/12-share-links",
	])("%p is accepted", (message) => {
		expect(validateCommitMessage(message).ok).toBe(true);
	});

	test("the number a squash merge appends is not counted", () => {
		const subject = `feat(api): ${"a".repeat(61)}`;
		expect(subject.length).toBe(72);
		expect(validateCommitMessage(subject).ok).toBe(true);
		expect(validateCommitMessage(`${subject} (#123)`).ok).toBe(true);
		expect(validateCommitMessage(`${subject}a (#123)`).ok).toBe(false);
	});

	test("comment lines added by git are ignored", () => {
		const message =
			"# Please enter the commit message\nfeat(api): add the dossier share link\n\n# On branch feat/12";
		expect(validateCommitMessage(message).ok).toBe(true);
	});

	test("the body is free", () => {
		const message =
			"feat(api): add the dossier share link\n\nWhy it matters, in any case. Closes #12.";
		expect(validateCommitMessage(message).ok).toBe(true);
	});
});

describe("validateBranch", () => {
	test("main is protected", () => {
		const result = validateBranch("main");
		expect(result.ok).toBe(false);
		expect(result.error).toContain('"main" is protected');
	});

	test.each([
		"feat/12-share-links",
		"fix/13-ocr-timeout",
		"explore/14-review-layout",
		"chore/ticket-workflow",
		"HEAD",
	])("%p is allowed", (branch) => {
		expect(validateBranch(branch).ok).toBe(true);
	});
});

describe("commit-message.ts", () => {
	test("file mode rejects a message outside the convention", () => {
		const path = throwawayRepository();
		const file = join(path, "COMMIT_EDITMSG");
		writeFileSync(file, "wip\n");
		const result = run(path, "bun", [COMMIT_MESSAGE, file]);
		expect(result.code).toBe(1);
		expect(result.output).toContain("commit rejected");
	});

	test("file mode accepts a conforming message", () => {
		const path = throwawayRepository();
		const file = join(path, "COMMIT_EDITMSG");
		writeFileSync(file, "docs(method): describe the ticket workflow\n");
		expect(run(path, "bun", [COMMIT_MESSAGE, file]).code).toBe(0);
	});

	test("range mode names every offending commit and only those", () => {
		const path = throwawayRepository();
		const base = run(path, "git", ["rev-parse", "HEAD"]).output.trim();
		commit(path, "feat(api): add the dossier share link");
		commit(path, "Fixed stuff.");
		commit(path, "fix(web): restore focus after closing the palette\n\nBody.");

		const commits = commitsOf(`${base}..HEAD`, path);
		expect(commits).toHaveLength(3);
		expect(commits[0]?.message).toContain("restore focus");
		expect(commits[0]?.message).toContain("Body.");

		const result = run(path, "bun", [
			COMMIT_MESSAGE,
			"--range",
			`${base}..HEAD`,
		]);
		expect(result.code).toBe(1);
		expect(result.output).toContain('"Fixed stuff."');
		expect(result.output.trim().split("\n")).toHaveLength(1);
	});

	test("range mode passes a clean range", () => {
		const path = throwawayRepository();
		const base = run(path, "git", ["rev-parse", "HEAD"]).output.trim();
		commit(path, "feat(api): add the dossier share link");
		const result = run(path, "bun", [
			COMMIT_MESSAGE,
			"--range",
			`${base}..HEAD`,
		]);
		expect(result.code).toBe(0);
	});
});

describe("branch-guard.ts", () => {
	test("a commit on main is refused", () => {
		const path = throwawayRepository();
		const result = run(path, "bun", [BRANCH_GUARD]);
		expect(result.code).toBe(1);
		expect(result.output).toContain('"main" is protected');
	});

	test("a commit on an issue branch is allowed", () => {
		const path = throwawayRepository();
		run(path, "git", ["checkout", "--quiet", "-b", "feat/12-share-links"]);
		expect(run(path, "bun", [BRANCH_GUARD]).code).toBe(0);
	});
});

describe("lefthook.yml", () => {
	test("wires both tools into the hooks", () => {
		const config = readFileSync(LEFTHOOK, "utf8");
		expect(config).toContain("bun scripts/branch-guard.ts");
		expect(config).toContain("bun scripts/commit-message.ts {1}");
	});
});
