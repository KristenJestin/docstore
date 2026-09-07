import { expect } from "bun:test";
import type { Db } from "@docstore/db";
import { createId } from "@docstore/db/id";
import { user as userTable } from "@docstore/db/schema/auth";
import type { TestDb } from "@docstore/db/test-utils";
import type { ApiKeyScope } from "@docstore/shared/api-key";
import { createRouterClient, ORPCError, type RouterClient } from "@orpc/server";
import type { Context } from "./context";
import { appRouter } from "./routers/index";

export type TestUser = {
	id: string;
	name: string;
	email: string;
};

/** Inserts a real user: `document.created_by_id` references it. */
export async function createTestUser(
	db: TestDb,
	overrides: Partial<TestUser> = {},
): Promise<TestUser> {
	const id = overrides.id ?? createId("usr_");
	const rows = await db
		.insert(userTable)
		.values({
			id,
			name: overrides.name ?? "Camille Moreau",
			email: overrides.email ?? `${id}@example.test`,
			emailVerified: true,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new Error("Test user was not inserted.");
	}
	return { id: row.id, name: row.name, email: row.email };
}

/**
 * oRPC context outside HTTP: fake Better Auth session + test database.
 * Passing `null` as the user simulates an anonymous request.
 *
 * `apiKey` simulates a call authenticated with an API key: mutations then go
 * through `requireScope` (SPEC §6).
 */
export function createTestContext(
	db: Db,
	user: TestUser | null,
	apiKey?: { id: string; scopes: ApiKeyScope[] },
): Context {
	const now = new Date();
	return {
		auth: null,
		db,
		// The ingestion pipeline is not needed by business procedures.
		ingestion: undefined,
		apiKey,
		session: user
			? {
					session: {
						id: createId("ses_"),
						token: createId("tok_"),
						userId: user.id,
						expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
						createdAt: now,
						updatedAt: now,
						ipAddress: null,
						userAgent: null,
					},
					user: {
						id: user.id,
						name: user.name,
						email: user.email,
						emailVerified: true,
						image: null,
						createdAt: now,
						updatedAt: now,
					},
				}
			: null,
	};
}

/** In-memory oRPC client: calls procedures without going through HTTP. */
export function createTestClient(
	db: Db,
	user: TestUser | null,
	apiKey?: { id: string; scopes: ApiKeyScope[] },
): RouterClient<typeof appRouter> {
	return createRouterClient(appRouter, {
		context: createTestContext(db, user, apiKey),
	});
}

/**
 * Checks that a promise fails with an `ORPCError` carrying the expected code.
 *
 * The `.rejects` matchers of `bun:test` hang on promises coming from the `pg`
 * pool (bun 1.3.13 / Windows): we unwrap the error ourselves.
 */
export async function expectOrpcError(
	promise: Promise<unknown>,
	code: string,
): Promise<ORPCError<string, unknown>> {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(ORPCError);
	const orpcError = error as ORPCError<string, unknown>;
	expect(orpcError.code).toBe(code);
	return orpcError;
}
