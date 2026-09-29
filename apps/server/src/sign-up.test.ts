import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createAuth } from "@docstore/auth";
import { createId } from "@docstore/db/id";
import { user } from "@docstore/db/schema/auth";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { writeSetting } from "@docstore/ingestion";
import { SIGN_UP_CLOSED_CODE } from "@docstore/shared/settings";
import type { Hono } from "hono";
import { createApp } from "./app";

/**
 * Issue #16, D16-01 and D16-02: the Better Auth sign-up endpoint itself
 * refuses a new account once the household exists and "Allow sign-up" is off.
 * Hiding the form is not enough: these requests go straight to the API.
 */

const WEB_ORIGIN = "http://localhost:3001";

let db: TestDb;
let app: Hono;

beforeAll(async () => {
	db = await createTestDb();
	app = createApp({
		db,
		auth: createAuth({ db }),
		corsOrigin: WEB_ORIGIN,
		appSecret: "sign-up-test-secret-sign-up-test-secret",
		logRequests: false,
	});
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
});

function signUp(email: string): Promise<Response> {
	return Promise.resolve(
		app.request("/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json", origin: WEB_ORIGIN },
			body: JSON.stringify({
				name: "New member",
				email,
				password: "Password123!",
			}),
		}),
	);
}

async function countUsers(): Promise<number> {
	return (await db.select({ id: user.id }).from(user)).length;
}

async function insertExistingUser(): Promise<void> {
	const id = createId("usr_");
	await db.insert(user).values({
		id,
		name: "Camille Moreau",
		email: `${id}@example.test`,
		emailVerified: true,
	});
}

describe("POST /api/auth/sign-up/email", () => {
	test("sign-up is allowed while no user exists (first run)", async () => {
		const response = await signUp("first@example.test");

		expect(response.status).toBe(200);
		expect(await countUsers()).toBe(1);
	});

	test("with at least one user and the toggle off, sign-up is refused", async () => {
		await insertExistingUser();

		const response = await signUp("stranger@example.test");

		expect(response.status).toBe(403);
		const body = (await response.json()) as { code?: string };
		expect(body.code).toBe(SIGN_UP_CLOSED_CODE);
		expect(await countUsers()).toBe(1);
	});

	test("the first account closes sign-up behind it", async () => {
		expect((await signUp("first@example.test")).status).toBe(200);

		const second = await signUp("second@example.test");

		expect(second.status).toBe(403);
		expect(await countUsers()).toBe(1);
	});

	test("a refused sign-up does not reveal an existing address", async () => {
		expect((await signUp("first@example.test")).status).toBe(200);

		const again = await signUp("first@example.test");

		expect(again.status).toBe(403);
		expect(((await again.json()) as { code?: string }).code).toBe(
			SIGN_UP_CLOSED_CODE,
		);
	});

	test("with the toggle on, a new household member can sign up", async () => {
		await insertExistingUser();
		await writeSetting(db, "auth.allowSignUp", true);

		const response = await signUp("new-member@example.test");

		expect(response.status).toBe(200);
		expect(await countUsers()).toBe(2);
	});

	test("turning the toggle off again closes sign-up", async () => {
		await insertExistingUser();
		await writeSetting(db, "auth.allowSignUp", true);
		expect((await signUp("joined@example.test")).status).toBe(200);

		await writeSetting(db, "auth.allowSignUp", false);
		const response = await signUp("late@example.test");

		expect(response.status).toBe(403);
		expect(await countUsers()).toBe(2);
	});
});
