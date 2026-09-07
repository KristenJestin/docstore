/**
 * Public URLs of the share (`/s/:token`) and upload (`/u/:token`) links.
 *
 * The API builds them from `PUBLIC_URL` and returns them on every read
 * (`shareLink.url`, `uploadLink.url`), so **the server value wins**: it is the
 * only one that knows the origin a third party can reach behind the reverse
 * proxy.
 *
 * The single exception is the legacy split-port development setup (`bun run
 * dev:web` + `bun run dev:server`): the web application is served on `:3001`
 * while `PUBLIC_URL` points at the API on `:3000`, so the URL the server hands
 * out would open the wrong host. When — and only when — the build is a
 * development build **and** the host of the API URL differs from the one the
 * browser sits on, the path is re-hung on `window.location.origin`.
 *
 * `bun run dev` (`scripts/dev.ts`) and production both run a single origin —
 * `PUBLIC_URL` is then the very host the browser sits on — so the hosts match
 * and the server URL is used verbatim. An empty `apiUrl` (server started
 * without `PUBLIC_URL`) still falls back to the current origin.
 */
export function resolvePublicPageUrl(apiUrl: string, path: string): string {
	// Server-rendered pass: no origin to compare against, so nothing to rewrite.
	if (typeof window === "undefined") {
		return apiUrl;
	}
	const fallback = `${window.location.origin}${path}`;
	if (!apiUrl) {
		return fallback;
	}
	let host: string;
	try {
		host = new URL(apiUrl).host;
	} catch {
		return fallback;
	}
	return import.meta.env.DEV && host !== window.location.host
		? fallback
		: apiUrl;
}
