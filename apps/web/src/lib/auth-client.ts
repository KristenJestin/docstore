import { env } from "@docstore/env/web";
import { createAuthClient } from "better-auth/react";

/**
 * Same resolution as `utils/orpc.ts`: an absolute `VITE_SERVER_URL` is used as
 * is, a relative one (including the `"/"` of the single-origin setup, which
 * normalizes to the empty string) is hung on the current origin — `new URL()`
 * below needs an absolute base.
 */
function getServerUrl(url: string) {
	const processEnv = (
		globalThis as {
			process?: { env?: Record<string, string | undefined> };
		}
	).process?.env;
	if (typeof window === "undefined" && processEnv?.SERVER_URL) {
		return processEnv.SERVER_URL.replace(/\/+$/, "");
	}

	const normalized = url.replace(/\/+$/, "");

	if (normalized !== "" && !normalized.startsWith("/")) {
		return normalized;
	}

	if (typeof window !== "undefined") {
		return `${window.location.origin}${normalized}`;
	}

	const vercelUrl =
		processEnv?.VERCEL_ENV === "production"
			? (processEnv?.VERCEL_PROJECT_PRODUCTION_URL ?? processEnv?.VERCEL_URL)
			: (processEnv?.VERCEL_URL ?? processEnv?.VERCEL_PROJECT_PRODUCTION_URL);
	if (vercelUrl) {
		const origin = vercelUrl.startsWith("http")
			? vercelUrl
			: `https://${vercelUrl}`;
		return `${origin}${normalized}`;
	}

	return `http://localhost:3000${normalized}`;
}
export const authClient = createAuthClient({
	// better-auth derives its route-matching base from this URL's path, so the
	// public auth path must equal the server-side mount (/api/auth everywhere)
	baseURL: new URL("/api/auth", getServerUrl(env.VITE_SERVER_URL)).toString(),
});
