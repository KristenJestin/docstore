import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Angular commit convention of the repository (see AGENTS.md, "Tickets and
 * Git workflow").
 *
 *   bun scripts/commit-message.ts <file>                  validate the message held by <file>
 *   bun scripts/commit-message.ts --range <base>..<head>  validate every commit of a range
 *
 * Lefthook runs the first form as the `commit-msg` hook; the `commit-messages`
 * CI job runs the second on the commits of a pull request.
 */

/** Commit types allowed by the convention. */
export const COMMIT_TYPES = [
	"feat",
	"fix",
	"refactor",
	"test",
	"docs",
	"chore",
	"build",
	"ci",
	"perf",
] as const;

/**
 * Branches no commit may land on directly. Every merge into `main` deploys
 * production, so `main` only ever moves through a squash-merged pull request.
 */
export const PROTECTED_BRANCHES = ["main"] as const;

export const MAX_SUBJECT_LENGTH = 72;

const HEADER = /^([a-z]+)\(([a-z0-9-]+)\): (.+)$/;

const EXPECTED = `expected "<type>(<scope>): <subject>" with type among ${COMMIT_TYPES.join(", ")}`;

export interface ValidationResult {
	ok: boolean;
	error?: string;
}

/** Strips the comment lines git appends to the message being edited. */
export function stripComments(message: string): string {
	return message
		.split("\n")
		.filter((line) => !line.startsWith("#"))
		.join("\n")
		.trim();
}

export function validateCommitMessage(message: string): ValidationResult {
	const header = stripComments(message).split("\n")[0] ?? "";
	// Merge commits are written by git itself (updating a branch from main).
	if (header.startsWith("Merge ")) return { ok: true };
	if (header.length === 0) {
		return { ok: false, error: `empty commit message; ${EXPECTED}` };
	}

	const match = HEADER.exec(header);
	if (!match) {
		return {
			ok: false,
			error: `"${header}" does not match the convention; ${EXPECTED}`,
		};
	}
	const type = match[1] ?? "";
	const subject = match[3] ?? "";
	if (!COMMIT_TYPES.some((known) => known === type)) {
		return {
			ok: false,
			error: `"${header}" uses the unknown type "${type}"; ${EXPECTED}`,
		};
	}
	// A squash merge appends the pull request number to the title it was given.
	// That suffix is GitHub's, not the author's: it does not count.
	const written = header.replace(/ \(#\d+\)$/, "");
	if (written.length > MAX_SUBJECT_LENGTH) {
		return {
			ok: false,
			error: `"${header}" is ${written.length} characters long; keep the subject line to ${MAX_SUBJECT_LENGTH} at most`,
		};
	}
	if (subject.endsWith(".")) {
		return { ok: false, error: `"${header}" ends with a period; drop it` };
	}
	if (/^[A-Z]/.test(subject)) {
		return {
			ok: false,
			error: `"${header}" starts with an uppercase subject; use lowercase`,
		};
	}
	return { ok: true };
}

export function validateBranch(branch: string): ValidationResult {
	if (PROTECTED_BRANCHES.some((name) => name === branch)) {
		return {
			ok: false,
			error: `"${branch}" is protected; create a feat/<n>-<topic>, fix/<n>-<topic> or explore/<n>-<topic> branch from main (bun run wt <branch>) before committing`,
		};
	}
	return { ok: true };
}

export interface RangeCommit {
	hash: string;
	message: string;
}

/** Every commit of `<base>..<head>`, with its full message. */
export function commitsOf(range: string, cwd?: string): RangeCommit[] {
	// %x00 separates the commits, %x1f the hash from the message: neither can
	// appear in a commit message typed by a human.
	const result = spawnSync("git", ["log", "--format=%H%x1f%B%x00", range], {
		cwd,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git log ${range} failed`);
	}
	return result.stdout
		.split("\0")
		.map((entry) => entry.replace(/^\n/, ""))
		.filter((entry) => entry.length > 0)
		.map((entry) => {
			const [hash = "", message = ""] = entry.split("\x1f");
			return { hash, message };
		});
}

function main(argv: string[]): number {
	const rangeIndex = argv.indexOf("--range");
	if (rangeIndex !== -1) {
		const range = argv[rangeIndex + 1];
		if (!range) {
			console.error("--range requires a <base>..<head> argument");
			return 2;
		}
		let failed = false;
		for (const commit of commitsOf(range)) {
			const result = validateCommitMessage(commit.message);
			if (!result.ok) {
				console.error(`${commit.hash}: ${result.error}`);
				failed = true;
			}
		}
		return failed ? 1 : 0;
	}

	const file = argv[0];
	if (!file) {
		console.error(
			"usage: bun scripts/commit-message.ts <file> | --range <base>..<head>",
		);
		return 2;
	}
	const result = validateCommitMessage(readFileSync(file, "utf8"));
	if (!result.ok) {
		console.error(`commit rejected: ${result.error}`);
		return 1;
	}
	return 0;
}

if (import.meta.main) {
	process.exit(main(process.argv.slice(2)));
}
