import { createDb, type Db } from "@docstore/db";
import * as schema from "@docstore/db/schema/auth";
import { env } from "@docstore/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { assertSignUpOpen } from "./sign-up";

export interface CreateAuthOptions {
	/** Database to use instead of `DATABASE_URL` (tests inject theirs). */
	db?: Db;
}

export function createAuth(options: CreateAuthOptions = {}) {
	const db = options.db ?? createDb();

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",

			schema: schema,
		}),
		// The browser origin (`CORS_ORIGIN`), the origin the third-party pages are
		// handed out on (`PUBLIC_URL`) and the auth base itself. They are the same
		// value behind a reverse proxy — single origin, in production as under
		// `bun run dev` — and differ only in the split-port dev setup. Deduplicated
		// because better-auth compares the list verbatim.
		trustedOrigins: [
			...new Set(
				[env.CORS_ORIGIN, env.PUBLIC_URL, env.BETTER_AUTH_URL].filter(
					(origin): origin is string => Boolean(origin),
				),
			),
		],
		emailAndPassword: {
			enabled: true,
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
		},
		// D16-02: sign-up is refused on the server while it is closed (see
		// `sign-up.ts`). The `before` hook answers `SIGN_UP_CLOSED` before the
		// endpoint looks anything up, so a refused request does not reveal
		// whether an address already has an account; the user-creation hook is
		// the backstop for any other path that would create a user.
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path.startsWith("/sign-up")) {
					await assertSignUpOpen(db);
				}
			}),
		},
		databaseHooks: {
			user: {
				create: {
					before: async () => {
						await assertSignUpOpen(db);
					},
				},
			},
		},
		plugins: [],
	});
}

export const auth = createAuth();
