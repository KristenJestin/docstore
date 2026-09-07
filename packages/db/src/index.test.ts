import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { Pool } from "pg";

// Same environment as the other tests of the package: `@docstore/db` validates
// it when it is evaluated, so it has to be loaded before the dynamic import.
dotenv.config({
	path: fileURLToPath(new URL("../../../apps/server/.env", import.meta.url)),
	quiet: true,
});

const { createDb } = await import("./index");

/** Connection string the pool was actually opened with. */
function connectionStringOf(db: ReturnType<typeof createDb>): string {
	return (db.$client as unknown as Pool).options.connectionString ?? "";
}

/** Pools opened by a test; closed afterwards (nothing ever connects). */
const opened: ReturnType<typeof createDb>[] = [];

function open(connectionString?: string) {
	const db = createDb(connectionString);
	opened.push(db);
	return db;
}

afterEach(async () => {
	await Promise.all(opened.splice(0).map((db) => db.$client.end()));
});

describe("createDb", () => {
	test("opens the database named by its argument", () => {
		const target = "postgresql://docstore:docstore@127.0.0.1:5434/other_db";
		expect(connectionStringOf(open(target))).toBe(target);
	});

	test("falls back to DATABASE_URL when it is called without one", () => {
		const fallback = process.env.DATABASE_URL;
		expect(fallback).toBeTruthy();
		expect(connectionStringOf(open())).toBe(fallback as string);
	});

	test("an explicit connection string wins over the environment", () => {
		const target = "postgresql://docstore:docstore@127.0.0.1:5434/wins_db";
		expect(connectionStringOf(open(target))).not.toBe(process.env.DATABASE_URL);
		expect(connectionStringOf(open(target))).toBe(target);
	});
});
