import { createDb } from "@docstore/db";
import * as schema from "@docstore/db/schema/auth";
import { env } from "@docstore/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export function createAuth() {
	const db = createDb();

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
		plugins: [],
	});
}

export const auth = createAuth();
