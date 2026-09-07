import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Db } from "@docstore/db";
import type { IntakeSourceRow } from "@docstore/db/schema/intake";
import { intakeSource } from "@docstore/db/schema/intake";
import type { IntakeSourceConfig } from "@docstore/shared/intake";
import { EMPTY_INTAKE_STATS } from "@docstore/shared/intake";
import type {
	ServerConfig,
	ServerIntakeSource,
} from "@docstore/shared/server-config";
import {
	DEFAULT_SERVER_CONFIG_PATH,
	EMPTY_SERVER_CONFIG,
	MissingConfigVariableError,
	resolveConfigPlaceholders,
	serverConfigSchema,
	withInboxShortcut,
} from "@docstore/shared/server-config";
import { eq, isNotNull, sql } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "./crypto.service";

/**
 * Server configuration file: loading, then synchronisation into
 * `intake_source` (SPEC §5, server-defined sources).
 *
 * Everything the file declares is **owned by the file**: the matching rows
 * carry a `managed_key`, are rewritten at every startup and refuse any edit
 * coming from the API. Rows without a key belong to the user and are never
 * touched here.
 */

/** The file exists but cannot be used: the server must not start silently. */
export class ServerConfigError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "ServerConfigError";
	}
}

/**
 * Path of the configuration file.
 *
 * Read lazily rather than through `@docstore/env` so the service stays
 * callable in tests, where only part of the environment exists (same reasoning
 * as `publicBaseUrl` in `upload-link.service`).
 */
export function serverConfigPath(
	env: Record<string, string | undefined> = process.env,
): string {
	const path = env.DOCSTORE_CONFIG?.trim() || DEFAULT_SERVER_CONFIG_PATH;
	return isAbsolute(path) ? path : resolve(path);
}

export interface LoadServerConfigOptions {
	/** Defaults to `DOCSTORE_CONFIG`, then `./docstore.config.json`. */
	path?: string;
	/** Source of the `${VAR}` placeholders; defaults to `process.env`. */
	env?: Record<string, string | undefined>;
	/**
	 * `INBOX_PATH`: when the file declares no folder source on that path, one is
	 * synthesized (`key: "inbox"`). Pass `null` to disable the shortcut.
	 */
	inboxPath?: string | null;
}

export interface LoadedServerConfig {
	config: ServerConfig;
	/** Absolute path looked at, whether or not a file was found there. */
	path: string;
	/** False when no file exists: an empty configuration, not an error. */
	exists: boolean;
}

/**
 * Reads, resolves and validates the configuration file.
 *
 * An absent file is normal (no configuration = no managed source). Anything
 * else — unreadable file, invalid JSON, unknown `${VAR}`, schema violation —
 * throws `ServerConfigError` with a message naming what has to be fixed.
 */
export async function loadServerConfig(
	options: LoadServerConfigOptions = {},
): Promise<LoadedServerConfig> {
	const env = options.env ?? process.env;
	const path = options.path ? resolve(options.path) : serverConfigPath(env);
	const inboxPath =
		options.inboxPath === undefined
			? env.INBOX_PATH?.trim() || undefined
			: (options.inboxPath ?? undefined);

	if (!path.toLowerCase().endsWith(".json")) {
		throw new ServerConfigError(
			`Server configuration "${path}": only .json files are supported.`,
		);
	}

	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {
				config: withInboxShortcut(EMPTY_SERVER_CONFIG, inboxPath),
				path,
				exists: false,
			};
		}
		throw new ServerConfigError(
			`Server configuration "${path}" cannot be read: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new ServerConfigError(
			`Server configuration "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}

	let resolved: unknown;
	try {
		resolved = resolveConfigPlaceholders(parsed, env);
	} catch (error) {
		if (error instanceof MissingConfigVariableError) {
			throw new ServerConfigError(
				`Server configuration "${path}": ${error.message}`,
				{ cause: error },
			);
		}
		throw error;
	}

	const validated = serverConfigSchema.safeParse(resolved);
	if (!validated.success) {
		const details = validated.error.issues
			.map((issue) => `${issue.path.join(".") || "$"}: ${issue.message}`)
			.join("; ");
		throw new ServerConfigError(
			`Server configuration "${path}" is invalid — ${details}`,
			{ cause: validated.error },
		);
	}

	return {
		config: withInboxShortcut(validated.data, inboxPath),
		path,
		exists: true,
	};
}

/* ------------------------------------------------------------------ */
/* Synchronisation into `intake_source`                                 */
/* ------------------------------------------------------------------ */

export interface ManagedSyncResult {
	created: number;
	updated: number;
	unchanged: number;
	deleted: number;
}

/**
 * Storable configuration of a declared source.
 *
 * The mailbox password is encrypted here. When the file repeats the password
 * the row already holds, the stored ciphertext is kept: AES-GCM draws a fresh
 * IV every time, and re-encrypting on every startup would make the row look
 * modified forever.
 */
function toManagedConfig(
	declared: ServerIntakeSource,
	existing: IntakeSourceRow | undefined,
): IntakeSourceConfig {
	if (declared.config.type === "folder") return declared.config;

	const { password, ...rest } = declared.config;
	const stored =
		existing?.config.type === "mail" ? existing.config.passwordEncrypted : null;

	if (!password) return { ...rest, passwordEncrypted: stored };
	if (stored && safeDecrypt(stored) === password) {
		return { ...rest, passwordEncrypted: stored };
	}
	return { ...rest, passwordEncrypted: encryptSecret(password) };
}

/** Decryption that never throws: a stale ciphertext simply does not match. */
function safeDecrypt(payload: string): string | null {
	try {
		return decryptSecret(payload);
	} catch {
		return null;
	}
}

/**
 * JSON with sorted keys: Postgres gives `jsonb` back in its own key order, so
 * a plain `JSON.stringify` comparison would report a change on every startup.
 */
function stableJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableJson).join(",")}]`;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** True when the stored row already says exactly what the file says. */
function isUpToDate(
	row: IntakeSourceRow,
	declared: ServerIntakeSource,
	config: IntakeSourceConfig,
): boolean {
	return (
		row.name === declared.name &&
		row.type === declared.type &&
		row.enabled === declared.enabled &&
		stableJson(row.config) === stableJson(config) &&
		stableJson(row.defaults) === stableJson(declared.defaults)
	);
}

/**
 * Aligns the managed rows of `intake_source` with the configuration file.
 *
 * Upsert by `managed_key`, deletion of the keys that disappeared from the file
 * (their logs go with them, `on delete cascade`), and nothing at all for the
 * rows created through the interface. Idempotent: a second run reports only
 * `unchanged`.
 */
export async function syncManagedIntakeSources(
	db: Db,
	config: ServerConfig,
): Promise<ManagedSyncResult> {
	const rows = await db
		.select()
		.from(intakeSource)
		.where(isNotNull(intakeSource.managedKey));
	const existing = new Map(
		rows.map((row) => [row.managedKey as string, row] as const),
	);

	const result: ManagedSyncResult = {
		created: 0,
		updated: 0,
		unchanged: 0,
		deleted: 0,
	};

	for (const declared of config.intakeSources) {
		const row = existing.get(declared.key);
		const stored = toManagedConfig(declared, row);

		if (!row) {
			await db.insert(intakeSource).values({
				managedKey: declared.key,
				type: declared.type,
				name: declared.name,
				enabled: declared.enabled,
				config: stored,
				defaults: declared.defaults,
				stats: EMPTY_INTAKE_STATS,
			});
			result.created += 1;
			continue;
		}

		if (isUpToDate(row, declared, stored)) {
			result.unchanged += 1;
			continue;
		}

		await db
			.update(intakeSource)
			.set({
				type: declared.type,
				name: declared.name,
				enabled: declared.enabled,
				config: stored,
				defaults: declared.defaults,
			})
			.where(eq(intakeSource.managedKey, declared.key));
		result.updated += 1;
	}

	const declaredKeys = new Set(
		config.intakeSources.map((source) => source.key),
	);
	for (const key of existing.keys()) {
		if (declaredKeys.has(key)) continue;
		await db.delete(intakeSource).where(eq(intakeSource.managedKey, key));
		result.deleted += 1;
	}

	return result;
}

/** Number of managed sources, for `settings.serverInfo`. */
export async function countManagedIntakeSources(db: Db): Promise<number> {
	const rows = await db
		.select({ value: sql<number>`count(*)::int` })
		.from(intakeSource)
		.where(isNotNull(intakeSource.managedKey));
	return rows[0]?.value ?? 0;
}
