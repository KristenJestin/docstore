import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Hono server the API paths are forwarded to. `scripts/dev.ts` sets it to the
 * port it picked for the API; the historical split-port setup (`bun run
 * dev:web` + `bun run dev:server`) keeps working on the default.
 */
const API_PROXY_TARGET =
	process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000";

/**
 * Single origin in development, exactly like production behind Caddy: the Vite
 * dev server proxies everything that belongs to the Hono server, so the browser
 * only ever talks to one host and `VITE_SERVER_URL=/` is enough.
 *
 * `changeOrigin: false` on purpose — the API must see the public `Host`
 * (`docstore.localhost`), which is what Better Auth matches its cookies and
 * trusted origins against. Keep this list in sync with `docker/Caddyfile`.
 */
const api = {
	target: API_PROXY_TARGET,
	changeOrigin: false,
	// Streamable HTTP (MCP) and any future socket upgrade.
	ws: true,
} as const;

export default defineConfig({
	server: {
		// portless assigns the port through PORT; 3001 is the historical default.
		port: Number(process.env.PORT) || 3001,
		// portless serves the app as `https://[<worktree>.]<name>.localhost`.
		allowedHosts: [".localhost"],
		proxy: {
			"/rpc": api,
			// Covers /api/auth/*, /api/u/*, /api/s/*, /api/export and
			// /api-reference. `/u/*` and `/s/*` are SPA pages and stay here.
			"/api": api,
			"/files": api,
			"/health": api,
			"/mcp": api,
		},
	},
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
