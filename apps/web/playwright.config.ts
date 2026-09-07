import { defineConfig, devices } from "@playwright/test";

/**
 * The development environment is one origin: `bun run dev` (repository root)
 * serves the web through portless on `https://docstore.localhost` and starts
 * the API with that same origin as `CORS_ORIGIN` — hitting a raw
 * `http://localhost:3001` would be rejected by Better Auth (`INVALID_ORIGIN`).
 *
 * `E2E_BASE_URL` overrides it (a worktree serves
 * `https://<branch>.docstore.localhost`, `--no-portless` falls back to
 * `http://localhost:3001`).
 */
import { resolveWorkspace } from "../../scripts/lib/workspace";

/**
 * Never default to the main checkout: its database is the owner's working
 * library. In a linked worktree the suite targets that worktree's own
 * portless host; on the main checkout `E2E_BASE_URL` must be given explicitly
 * (`E2E_ALLOW_MAIN=1` opts in to https://docstore.localhost).
 */
function resolveBaseUrl(): string {
	if (process.env.E2E_BASE_URL) return process.env.E2E_BASE_URL;
	const workspace = resolveWorkspace();
	if (workspace.isWorktree)
		return `https://${workspace.slug}.docstore.localhost`;
	if (process.env.E2E_ALLOW_MAIN === "1") return "https://docstore.localhost";
	throw new Error(
		"Refusing to run the E2E suite against the main checkout: run it from a worktree (bun run wt <branch>), or set E2E_BASE_URL, or E2E_ALLOW_MAIN=1.",
	);
}
const BASE_URL = resolveBaseUrl();

export default defineConfig({
	testDir: "./e2e",
	// One run identifier shared by every spec (`E2E_RUN_ID`, set by the setup and
	// inherited by the workers), and one admin API key for the sweep: the
	// teardown deletes everything named `e2e-<runId>-…` through the API, so the
	// development library does not fill up with fixtures.
	globalSetup: "./e2e/global-setup.ts",
	globalTeardown: "./e2e/global-teardown.ts",
	// One worker on purpose: every spec talks to the same development database
	// and several of them upload the same OCR fixture, whose sha256 is unique
	// across the whole library. Running them in parallel makes one spec purge
	// the document another one is working on.
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	// One retry locally too: the specs run against the Vite development server,
	// which compiles a route the first time it is asked for and re-bundles its
	// dependencies as it discovers them. A navigation landing in that window
	// hangs on the router's pending spinner; a second attempt always gets the
	// warmed module.
	retries: process.env.CI ? 2 : 1,
	workers: 1,
	reporter: "list",
	// Ten seconds rather than five: the same on-demand compilation makes the
	// first assertion after a navigation slow, without the page being wrong.
	expect: { timeout: 10_000 },
	use: {
		baseURL: BASE_URL,
		// The portless certificate is a local one.
		ignoreHTTPSErrors: true,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		// Reused when the environment is already up, which is the usual case.
		command: "cd ../.. && bun run dev",
		url: BASE_URL,
		ignoreHTTPSErrors: true,
		reuseExistingServer: true,
		timeout: 180_000,
	},
});
