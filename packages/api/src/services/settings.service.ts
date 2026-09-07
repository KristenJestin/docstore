import type { Db } from "@docstore/db";
import { getAllSettings, writeSetting } from "@docstore/ingestion";
import type {
	ServerInfo,
	SetSettingInput,
	Settings,
} from "@docstore/shared/settings";
import { APP_VERSION, SETTING_DEFINITIONS } from "@docstore/shared/settings";
import { ORPCError } from "@orpc/server";
import {
	countManagedIntakeSources,
	serverConfigPath,
} from "./server-config.service";

/**
 * Application settings: global read and per-key validated write.
 */

export function getSettings(db: Db): Promise<Settings> {
	return getAllSettings(db);
}

export async function setSetting(
	db: Db,
	input: SetSettingInput,
): Promise<Settings> {
	const definition = SETTING_DEFINITIONS[input.key];
	const parsed = definition.schema.safeParse(input.value);
	if (!parsed.success) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Invalid value for "${input.key}": ${definition.label}.`,
		});
	}

	await writeSetting(db, input.key, parsed.data);
	return getAllSettings(db);
}

/** Trailing slashes only ever get in the way when a path is appended. */
function trimOrigin(value: string | undefined): string {
	return (value ?? "").trim().replace(/\/+$/, "");
}

/**
 * Server information (`settings.serverInfo`).
 *
 * `apiUrl` is the origin of this API (`BETTER_AUTH_URL`): the interface builds
 * the MCP command line from it instead of hardcoding a host. `publicUrl` is
 * the web origin, which only differs in development.
 *
 * The environment is read lazily, like everywhere else in the services.
 */
export async function getServerInfo(db: Db): Promise<ServerInfo> {
	const apiUrl = trimOrigin(process.env.BETTER_AUTH_URL);
	return {
		apiUrl,
		publicUrl: trimOrigin(process.env.PUBLIC_URL) || apiUrl,
		version: APP_VERSION,
		configPath: serverConfigPath(),
		managedIntakeSources: await countManagedIntakeSources(db),
	};
}
