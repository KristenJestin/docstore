/**
 * Production server for the front-end.
 *
 * `vite build` (TanStack Start) produces two folders:
 *   - `apps/web/dist/client`: the static assets;
 *   - `apps/web/dist/server/server.js`: an SSR `{ fetch }` handler, without a
 *     standalone HTTP server.
 *
 * This script serves the static files then delegates everything else to SSR.
 */
import { existsSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import ssrHandler from "../apps/web/dist/server/server.js";

const CLIENT_DIR = resolve(import.meta.dirname, "../apps/web/dist/client");
// biome-ignore lint/suspicious/noUndeclaredEnvVars: provided by docker compose (web service)
const PORT = Number(process.env.PORT ?? 3001);

/** Resolves a request path to a static file, or `null`. */
function resolveStaticFile(pathname) {
	if (pathname === "/" || pathname.endsWith("/")) return null;

	let decoded;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	if (decoded.includes("\0")) return null;

	const candidate = normalize(join(CLIENT_DIR, decoded));
	// Guard against directory traversal (`..`).
	if (candidate !== CLIENT_DIR && !candidate.startsWith(`${CLIENT_DIR}/`)) {
		return null;
	}
	if (!existsSync(candidate) || !statSync(candidate).isFile()) return null;
	return candidate;
}

function cacheControl(pathname) {
	// Assets are hashed by Vite: immutable cache.
	return pathname.startsWith("/assets/")
		? "public, max-age=31536000, immutable"
		: "public, max-age=3600";
}

Bun.serve({
	port: PORT,
	hostname: "0.0.0.0",
	idleTimeout: 60,
	fetch(request) {
		const url = new URL(request.url);

		if (request.method === "GET" || request.method === "HEAD") {
			const file = resolveStaticFile(url.pathname);
			if (file) {
				return new Response(Bun.file(file), {
					headers: { "cache-control": cacheControl(url.pathname) },
				});
			}
		}

		return ssrHandler.fetch(request);
	},
});

console.log(`[docstore-web] SSR listening on http://0.0.0.0:${PORT}`);
