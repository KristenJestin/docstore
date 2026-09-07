import {
	API_KEY_ENV,
	API_KEY_ID_ENV,
	allowLocalCertificate,
	createAdminKey,
	e2eBaseUrl,
	RUN_ID_ENV,
	runId,
	runPrefix,
} from "./helpers/cleanup";

/**
 * Opens the run: one identifier shared by every spec (through `E2E_RUN_ID`,
 * which the workers inherit) and one admin API key for the teardown.
 *
 * A failure here is not fatal: the specs still run, they just leave their
 * fixtures behind — exactly as they did before.
 */

/** The dev server compiles on demand; give it time to answer the first call. */
const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 2000;

async function waitForServer(baseUrl: string): Promise<void> {
	// The probe is the very first HTTPS call of the run, and the development
	// certificate is a local one: without this it fails until the timeout,
	// which reads as "the server never came up".
	allowLocalCertificate();
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`);
			if (response.ok) {
				return;
			}
		} catch {
			// Not up yet.
		}
		await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
	}
	throw new Error(`E2E setup: ${baseUrl} never answered /health.`);
}

export default async function globalSetup(): Promise<void> {
	// Read before anything else so the whole run shares one identifier.
	const id = runId();
	process.env[RUN_ID_ENV] = id;

	const baseUrl = e2eBaseUrl();
	try {
		await waitForServer(baseUrl);
		const key = await createAdminKey(baseUrl);
		process.env[API_KEY_ENV] = key.secret;
		process.env[API_KEY_ID_ENV] = key.id;
		console.log(`[e2e] run ${runPrefix()} — cleanup key ready.`);
	} catch (error) {
		console.warn(
			`[e2e] no cleanup key (${
				error instanceof Error ? error.message : String(error)
			}); fixtures will be left behind.`,
		);
	}
}
