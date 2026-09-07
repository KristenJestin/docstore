import type { AppRouter } from "@docstore/api/routers/index";
import type { CategoryNode } from "@docstore/shared/category";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

/**
 * Housekeeping of an end-to-end run.
 *
 * The specs work against the development database, which is never reset: every
 * category, tag, party, type, dossier or saved search they create used to stay
 * there for good. Each run therefore stamps everything it creates with a unique
 * prefix (`e2e-<runId>-`), and the global teardown deletes exactly what carries
 * that prefix — nothing else, and never the fixtures of a run happening next to
 * this one.
 *
 * The teardown talks to the API rather than to the browser: an admin API key is
 * minted at setup from a throwaway session, and every call goes to `/rpc` with
 * `Authorization: Bearer`.
 */

/** Environment variables the setup hands over to the workers and the teardown. */
export const RUN_ID_ENV = "E2E_RUN_ID";
export const API_KEY_ENV = "E2E_ADMIN_API_KEY";
export const API_KEY_ID_ENV = "E2E_ADMIN_API_KEY_ID";

export const E2E_PASSWORD = "Password123!";

/** Name suffix of the key signing the teardown: it is deleted last. */
const CLEANUP_KEY_SUFFIX = "cleanup key";

/** Origin the whole run talks to, browser and API alike. */
export function e2eBaseUrl(): string {
	return process.env.E2E_BASE_URL ?? "https://docstore.localhost";
}

/** Short, lowercase, filesystem- and slug-safe. */
function newRunId(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Identifier of the current run. Generated on first use so a spec started on
 * its own (`playwright test documents.spec.ts`) still gets a coherent prefix.
 */
export function runId(): string {
	const existing = process.env[RUN_ID_ENV];
	if (existing) {
		return existing;
	}
	const generated = newRunId();
	process.env[RUN_ID_ENV] = generated;
	return generated;
}

/** `e2e-<runId>-`: what the teardown matches on. */
export function runPrefix(): string {
	return `e2e-${runId()}-`;
}

/**
 * Name stamped with the run prefix. Every fixture a spec creates goes through
 * it: `runName("root category")` → `e2e-mf3k1a9x-root category-7f2c`.
 *
 * The trailing token keeps a retry from colliding with the attempt that failed
 * before it — several names are unique on the API side — while the prefix stays
 * the same, which is all the teardown matches on.
 */
export function runName(label: string): string {
	return `${runPrefix()}${label}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Same, lowercased and hyphenated: tags and slugs. */
export function runSlug(label: string): string {
	return runName(label)
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-");
}

function belongsToRun(
	name: string | null | undefined,
	prefix: string,
): boolean {
	return typeof name === "string" && name.startsWith(prefix);
}

/**
 * The development environment is served with a locally issued certificate; the
 * Playwright browser is told to ignore it (`ignoreHTTPSErrors`), and so is the
 * Node side that talks to the API directly.
 */
export function allowLocalCertificate(): void {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

function clientWith(
	baseUrl: string,
	headers: Record<string, string>,
): RouterClient<AppRouter> {
	allowLocalCertificate();
	const link = new RPCLink({
		url: `${baseUrl.replace(/\/+$/, "")}/rpc`,
		headers,
	});
	return createORPCClient(link) as RouterClient<AppRouter>;
}

/** oRPC client authenticated by the admin key minted at setup. */
export function apiClient(
	baseUrl: string,
	secret: string,
): RouterClient<AppRouter> {
	return clientWith(baseUrl, { authorization: `Bearer ${secret}` });
}

export interface AdminKey {
	id: string;
	secret: string;
}

/**
 * Creates the account of the run, signs in and mints an `admin` API key from
 * that session — `apiKey.create` requires a real session, never another key.
 */
export async function createAdminKey(baseUrl: string): Promise<AdminKey> {
	allowLocalCertificate();
	const origin = baseUrl.replace(/\/+$/, "");
	const response = await fetch(`${origin}/api/auth/sign-up/email`, {
		method: "POST",
		// Better Auth refuses a request without an `Origin` it trusts
		// (`MISSING_OR_NULL_ORIGIN`): a browser always sends one, this call has
		// to say it too.
		headers: { "content-type": "application/json", origin },
		body: JSON.stringify({
			name: "E2E Cleanup",
			email: `e2e-cleanup-${runId()}@test.local`,
			password: E2E_PASSWORD,
		}),
	});
	if (!response.ok) {
		throw new Error(
			`E2E setup: sign-up answered ${response.status} ${await response.text()}`,
		);
	}
	const cookie = response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	const session = clientWith(origin, { cookie });
	const created = await session.apiKey.create({
		name: `${runPrefix()}${CLEANUP_KEY_SUFFIX}`,
		scopes: ["admin"],
	});
	return { id: created.key.id, secret: created.secret };
}

/** Runs `remove` on every id, never letting one failure stop the sweep. */
async function removeAll(
	label: string,
	ids: string[],
	remove: (id: string) => Promise<unknown>,
	report: string[],
): Promise<void> {
	let deleted = 0;
	for (const id of ids) {
		try {
			await remove(id);
			deleted += 1;
		} catch {
			// Already gone, or held by something the sweep deletes later: the
			// teardown is best-effort and idempotent.
		}
	}
	if (deleted > 0) {
		report.push(`${deleted} ${label}`);
	}
}

/** Flattens the category tree, deepest first: a parent is deleted last. */
function flattenCategories(
	nodes: CategoryNode[],
	depth = 0,
): { id: string; name: string; depth: number }[] {
	return nodes.flatMap((node) => [
		{ id: node.id, name: node.name, depth },
		...flattenCategories(node.children, depth + 1),
	]);
}

/** Documents are paged through; the trash counts as much as the rest. */
async function runDocumentIds(
	client: RouterClient<AppRouter>,
	prefix: string,
): Promise<string[]> {
	const ids: string[] = [];
	for (let page = 1; page <= 20; page += 1) {
		const result = await client.document.list({
			page,
			pageSize: 100,
			deleted: "include",
		});
		for (const item of result.items) {
			if (belongsToRun(item.title, prefix)) {
				ids.push(item.id);
			}
		}
		if (page >= result.totalPages) {
			break;
		}
	}
	return ids;
}

async function runPartyIds(
	client: RouterClient<AppRouter>,
	prefix: string,
): Promise<string[]> {
	const ids: string[] = [];
	for (let page = 1; page <= 20; page += 1) {
		// Archived too: a spec that archives a party, or merges one into another,
		// would otherwise leave it behind for good.
		const result = await client.party.list({
			page,
			pageSize: 100,
			includeArchived: true,
		});
		for (const item of result.items) {
			if (belongsToRun(item.name, prefix)) {
				ids.push(item.id);
			}
		}
		if (page >= result.totalPages) {
			break;
		}
	}
	return ids;
}

/**
 * Deletes everything whose name starts with `prefix`, in dependency order:
 * documents first (they point at types, categories and tags), then the
 * collections, then the taxonomy, then the parties and the automations.
 *
 * Idempotent: running it twice, or on a prefix nothing was created under, is a
 * no-op.
 */
export async function cleanupRun(
	baseUrl: string,
	secret: string,
	prefix: string,
): Promise<string[]> {
	const client = apiClient(baseUrl, secret);
	const report: string[] = [];

	// Share links first: they hold a document or a dossier.
	const shareLinks = await client.shareLink.list({ includeInactive: true });
	await removeAll(
		"share links",
		shareLinks
			.filter((link) => belongsToRun(link.targetTitle, prefix))
			.map((link) => link.id),
		(id) => client.shareLink.delete({ id }),
		report,
	);

	await removeAll(
		"documents",
		await runDocumentIds(client, prefix),
		(id) => client.document.deletePermanently({ id }),
		report,
	);

	const dossiers = await client.dossier.list({ includeClosed: true });
	await removeAll(
		"dossiers",
		dossiers
			.filter((dossier) => belongsToRun(dossier.name, prefix))
			.map((dossier) => dossier.id),
		(id) => client.dossier.delete({ id }),
		report,
	);

	const types = await client.documentType.list({});
	await removeAll(
		"document types",
		types.filter((type) => belongsToRun(type.name, prefix)).map((t) => t.id),
		(id) => client.documentType.delete({ id, detachDocuments: true }),
		report,
	);

	const rules = await client.rule.list({});
	await removeAll(
		"automations",
		rules.filter((rule) => belongsToRun(rule.name, prefix)).map((r) => r.id),
		(id) => client.rule.delete({ id }),
		report,
	);

	const savedSearches = await client.savedSearch.list({});
	await removeAll(
		"saved searches",
		savedSearches
			.filter((search) => belongsToRun(search.name, prefix))
			.map((search) => search.id),
		(id) => client.savedSearch.delete({ id }),
		report,
	);

	const tags = await client.tag.list({});
	await removeAll(
		"tags",
		tags.filter((tag) => belongsToRun(tag.name, prefix)).map((tag) => tag.id),
		(id) => client.tag.delete({ id }),
		report,
	);

	const fields = await client.customField.list({});
	await removeAll(
		"custom fields",
		fields
			.filter((field) => belongsToRun(field.name, prefix))
			.map((field) => field.id),
		(id) => client.customField.delete({ id }),
		report,
	);

	// Children before parents: `category.delete` refuses nothing, but a parent
	// deleted first would take its subtree with it and lose the count.
	const categories = flattenCategories(await client.category.list({}));
	await removeAll(
		"categories",
		categories
			.filter((category) => belongsToRun(category.name, prefix))
			.sort((a, b) => b.depth - a.depth)
			.map((category) => category.id),
		(id) => client.category.delete({ id }),
		report,
	);

	await removeAll(
		"parties",
		await runPartyIds(client, prefix),
		(id) => client.party.delete({ id }),
		report,
	);

	const uploadLinks = await client.uploadLink.list({});
	await removeAll(
		"upload links",
		uploadLinks
			.filter((link) => belongsToRun(link.name, prefix))
			.map((link) => link.id),
		(id) => client.uploadLink.delete({ id }),
		report,
	);

	// The key of the run goes last: it is the one signing these calls.
	const keys = await client.apiKey.list({});
	await removeAll(
		"API keys",
		keys
			.filter((key) => belongsToRun(key.name, prefix))
			.sort(
				(a, b) =>
					Number(a.name.endsWith(CLEANUP_KEY_SUFFIX)) -
					Number(b.name.endsWith(CLEANUP_KEY_SUFFIX)),
			)
			.map((key) => key.id),
		(id) => client.apiKey.delete({ id }),
		report,
	);

	return report;
}
