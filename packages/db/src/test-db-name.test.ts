import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	currentTestDbScope,
	packagePart,
	scopeFor,
	testDbName,
	testDbPrefix,
	worktreeName,
} from "./test-db-name";

/** Issue #10: test databases are unique per worktree and per package. */

const sandbox = mkdtempSync(join(tmpdir(), "docstore-test-db-name-"));

afterAll(() => {
	rmSync(sandbox, { recursive: true, force: true });
});

/** A main checkout (`.git` directory) and a linked worktree (`.git` file). */
function checkouts(head: string): { main: string; linked: string } {
	const main = join(sandbox, `main-${Math.random().toString(36).slice(2)}`);
	const gitDir = join(main, ".git", "worktrees", "linked");
	mkdirSync(gitDir, { recursive: true });
	writeFileSync(join(gitDir, "HEAD"), `${head}\n`);
	const linked = join(sandbox, `linked-${Math.random().toString(36).slice(2)}`);
	mkdirSync(linked);
	writeFileSync(join(linked, ".git"), `gitdir: ${gitDir}\n`);
	return { main, linked };
}

describe("test database names", () => {
	test("the main checkout keeps one database per package", () => {
		const { main } = checkouts("ref: refs/heads/main");
		expect(worktreeName(main)).toBeNull();
		const scope = currentTestDbScope({}, main);
		expect(scope).toBeNull();
		expect(testDbName(packagePart("@docstore/api"), scope)).toBe(
			"docstore_test_api",
		);
	});

	test("a worktree gets databases scoped by its branch and package", () => {
		const { linked } = checkouts("ref: refs/heads/fix/10-test-dbs");
		expect(worktreeName(linked)).toBe("fix/10-test-dbs");
		const scope = currentTestDbScope({}, linked);
		expect(scope).toBe("fix_10_test_dbs");
		expect(testDbName("api", scope)).toBe("docstore_test_fix_10_test_dbs__api");
		expect(testDbName("server", scope)).toBe(
			"docstore_test_fix_10_test_dbs__server",
		);
	});

	test("a detached worktree falls back to its folder name", () => {
		const { linked } = checkouts("0123456789abcdef0123456789abcdef01234567");
		expect(worktreeName(linked)).toStartWith("linked-");
	});

	test("TEST_DB_SUFFIX replaces the scope but keeps one database per package", () => {
		const { linked } = checkouts("ref: refs/heads/fix/10-test-dbs");
		const scope = currentTestDbScope({ TEST_DB_SUFFIX: "Run-42" }, linked);
		expect(scope).toBe("run_42");
		expect(testDbName("api", scope)).toBe("docstore_test_run_42__api");
		expect(testDbName("db", scope)).toBe("docstore_test_run_42__db");
	});

	test("the prefix of one worktree never matches another worktree's databases", () => {
		const prefix = testDbPrefix(scopeFor("fix/10-test-dbs"));
		const other = testDbName("api", scopeFor("fix/10-test-dbs-2"));
		expect(other.startsWith(prefix)).toBe(false);
		expect(
			testDbName("api", scopeFor("fix/10-test-dbs")).startsWith(prefix),
		).toBe(true);
	});

	test("long branch names stay distinct and within the identifier limit", () => {
		const a = scopeFor("feat/123-a-very-long-branch-name-about-something-one");
		const b = scopeFor("feat/123-a-very-long-branch-name-about-something-two");
		expect(a).not.toBe(b);
		expect(a?.length).toBeLessThanOrEqual(24);
		expect(a).not.toContain("__");
		const name = testDbName("a_package_with_a_rather_long_name_too", a);
		expect(name.length).toBeLessThanOrEqual(63);
		expect(name.startsWith(testDbPrefix(a))).toBe(true);
	});
});
