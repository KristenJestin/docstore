import { z } from "zod";
import {
	DEFAULT_FOLDER_POLL_SECONDS,
	EMPTY_INTAKE_DEFAULTS,
	folderConfigSchema,
	type IntakeSourceConfigInput,
	intakeDefaultsSchema,
	intakeSourceTypeSchema,
	mailConfigInputSchema,
} from "./intake";

/**
 * Server configuration file (`DOCSTORE_CONFIG`).
 *
 * Everything an operator would rather keep next to the deployment than inside
 * the database: today the intake sources, declared once in a JSON file and
 * pushed into `intake_source` at startup (`syncManagedIntakeSources`). Those
 * rows carry a `managed_key` and are read-only in the interface.
 *
 * The file is validated here — the schema is shared so the front end can show
 * the same shape — and only `.json` is supported in v1.
 */

/** Default path when `DOCSTORE_CONFIG` is not set (Docker sets its own). */
export const DEFAULT_SERVER_CONFIG_PATH = "./docstore.config.json";

/** Key of the source synthesized from `INBOX_PATH` (see `inboxIntakeSource`). */
export const INBOX_MANAGED_KEY = "inbox";

/** Subfolder `afterImport: "move"` targets under `INBOX_PATH`. */
export const INBOX_IMPORTED_FOLDER = "imported";

/**
 * `key` identifies a source across restarts: it is the primary key of the
 * configuration file, and it is what `intake_source.managed_key` stores.
 */
export const managedKeySchema = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(
		/^[a-z0-9][a-z0-9._-]*$/i,
		"A key contains only letters, digits, `.`, `_` and `-`, and starts with a letter or a digit.",
	);

/**
 * One declared source.
 *
 * `type` sits at the top level (that is what the file reads like) while
 * `config` repeats the fields of the API — with the plaintext `password` for a
 * mailbox, encrypted on the way into the database. Both are stitched back
 * together before validation, so `config.type` may be present or absent.
 */
export const serverIntakeSourceSchema = z
	.object({
		key: managedKeySchema,
		/** Falls back to the key: a name is only there to be read. */
		name: z.string().trim().min(1).max(150).optional(),
		type: intakeSourceTypeSchema,
		enabled: z.boolean().default(true),
		config: z.record(z.string(), z.unknown()),
		defaults: intakeDefaultsSchema.default(EMPTY_INTAKE_DEFAULTS),
	})
	.transform((raw, ctx) => {
		// The branch is picked from the declared type rather than left to the
		// union: a union failure reports nothing usable, while the branch names
		// the offending field.
		const schema =
			raw.type === "folder" ? folderConfigSchema : mailConfigInputSchema;
		const parsed = schema.safeParse({ ...raw.config, type: raw.type });
		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				ctx.addIssue({
					code: "custom",
					path: ["config", ...issue.path],
					message: issue.message,
				});
			}
			return z.NEVER;
		}
		return {
			key: raw.key,
			name: raw.name ?? raw.key,
			type: raw.type,
			enabled: raw.enabled,
			config: parsed.data,
			defaults: raw.defaults,
		};
	});
export type ServerIntakeSource = z.infer<typeof serverIntakeSourceSchema>;

export const serverConfigSchema = z
	.object({
		intakeSources: z.array(serverIntakeSourceSchema).max(100).default([]),
	})
	.superRefine((config, ctx) => {
		const seen = new Set<string>();
		config.intakeSources.forEach((source, index) => {
			if (seen.has(source.key)) {
				ctx.addIssue({
					code: "custom",
					path: ["intakeSources", index, "key"],
					message: `Duplicate intake source key "${source.key}".`,
				});
			}
			seen.add(source.key);
		});
	});
export type ServerConfig = z.infer<typeof serverConfigSchema>;

/** Configuration of a server without a configuration file. */
export const EMPTY_SERVER_CONFIG: ServerConfig = { intakeSources: [] };

/* ------------------------------------------------------------------ */
/* `${VAR}` placeholders                                                */
/* ------------------------------------------------------------------ */

/** A value read from the environment is missing: the server must not start. */
export class MissingConfigVariableError extends Error {
	constructor(
		readonly variable: string,
		readonly path: string,
	) {
		super(
			`Environment variable "${variable}" is not set, but the server configuration references it at "${path}".`,
		);
		this.name = "MissingConfigVariableError";
	}
}

/** `${VAR}` or `${VAR}` inside a longer string, never nested. */
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function resolveString(
	value: string,
	env: Record<string, string | undefined>,
	path: string,
): string {
	return value.replace(PLACEHOLDER, (_match, variable: string) => {
		const resolved = env[variable];
		if (resolved === undefined || resolved === "") {
			throw new MissingConfigVariableError(variable, path);
		}
		return resolved;
	});
}

/**
 * Replaces every `${VAR}` of a parsed JSON tree with its value in `env`.
 *
 * Applied **before** validation: a secret never has to appear in the file, and
 * a missing variable stops the startup with the name of the offending key
 * rather than with a cryptic schema error.
 */
export function resolveConfigPlaceholders<T>(
	value: T,
	env: Record<string, string | undefined> = process.env,
	path = "$",
): T {
	if (typeof value === "string") {
		return resolveString(value, env, path) as T;
	}
	if (Array.isArray(value)) {
		return value.map((item, index) =>
			resolveConfigPlaceholders(item, env, `${path}[${index}]`),
		) as T;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).map(
			([key, item]) => [
				key,
				resolveConfigPlaceholders(item, env, `${path}.${key}`),
			],
		);
		return Object.fromEntries(entries) as T;
	}
	return value;
}

/* ------------------------------------------------------------------ */
/* `INBOX_PATH` shortcut                                                */
/* ------------------------------------------------------------------ */

/** Joins two path segments without depending on the platform separator. */
function joinPath(base: string, segment: string): string {
	const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
	return `${base.replace(/[\\/]+$/, "")}${separator}${segment}`;
}

/**
 * Source synthesized from `INBOX_PATH`: the drop folder mounted by Docker
 * works out of the box, without anyone having to create a source by hand.
 *
 * Recursive, and imported files are moved into `<INBOX_PATH>/imported` so the
 * folder does not grow forever and nothing is ever deleted.
 */
export function inboxIntakeSource(inboxPath: string): ServerIntakeSource {
	const config: IntakeSourceConfigInput = {
		type: "folder",
		path: inboxPath,
		recursive: true,
		pollSeconds: DEFAULT_FOLDER_POLL_SECONDS,
		afterImport: "move",
		moveTo: joinPath(inboxPath, INBOX_IMPORTED_FOLDER),
	};
	return {
		key: INBOX_MANAGED_KEY,
		name: "Inbox folder",
		type: "folder",
		enabled: true,
		config,
		defaults: EMPTY_INTAKE_DEFAULTS,
	};
}

/** True when the configuration already watches this folder. */
function watchesFolder(config: ServerConfig, inboxPath: string): boolean {
	const target = inboxPath.replace(/[\\/]+$/, "").toLowerCase();
	return config.intakeSources.some(
		(source) =>
			source.config.type === "folder" &&
			source.config.path.replace(/[\\/]+$/, "").toLowerCase() === target,
	);
}

/**
 * Adds the `INBOX_PATH` source unless the file already declares a folder
 * source on that path — or already uses the `inbox` key for something else.
 */
export function withInboxShortcut(
	config: ServerConfig,
	inboxPath: string | undefined,
): ServerConfig {
	if (!inboxPath) return config;
	if (watchesFolder(config, inboxPath)) return config;
	if (config.intakeSources.some((source) => source.key === INBOX_MANAGED_KEY)) {
		return config;
	}
	return {
		...config,
		intakeSources: [...config.intakeSources, inboxIntakeSource(inboxPath)],
	};
}
