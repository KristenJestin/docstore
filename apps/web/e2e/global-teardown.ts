import {
	API_KEY_ENV,
	cleanupRun,
	e2eBaseUrl,
	runPrefix,
} from "./helpers/cleanup";

/**
 * Closes the run: deletes every category, tag, party, document, type, dossier,
 * saved search, automation and public link whose name starts with the prefix of
 * this run. Nothing else is touched, so a development library keeps its own
 * data.
 */
export default async function globalTeardown(): Promise<void> {
	const secret = process.env[API_KEY_ENV];
	const prefix = runPrefix();
	if (!secret) {
		console.warn(`[e2e] no cleanup key: ${prefix}* left in the database.`);
		return;
	}
	try {
		const report = await cleanupRun(e2eBaseUrl(), secret, prefix);
		console.log(
			report.length > 0
				? `[e2e] cleaned up ${prefix}: ${report.join(", ")}.`
				: `[e2e] nothing to clean up for ${prefix}.`,
		);
	} catch (error) {
		console.warn(
			`[e2e] cleanup of ${prefix} failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
