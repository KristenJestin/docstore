import type { Db } from "@docstore/db";
import { setting } from "@docstore/db/schema/setting";
import { DEFAULT_EXPIRY_LEAD_DAYS } from "@docstore/shared/reminder";
import type {
	ReviewSettings,
	SettingKey,
	Settings,
} from "@docstore/shared/settings";
import {
	DEFAULT_REVIEW_SETTINGS,
	SETTING_DEFINITIONS,
	SETTING_KEYS,
} from "@docstore/shared/settings";
import { eq, inArray } from "drizzle-orm";

/**
 * Access to the application settings (`settings` table).
 *
 * Per-key validation is done on the API side (`settings.service.ts`): here we
 * only read and write, falling back on the default values.
 */

/** Every known key, default values included. */
export async function getAllSettings(db: Db): Promise<Settings> {
	const rows = await db
		.select({ key: setting.key, value: setting.value })
		.from(setting)
		.where(inArray(setting.key, [...SETTING_KEYS]));
	const stored = new Map(rows.map((row) => [row.key, row.value]));

	const resolved = {} as Record<SettingKey, unknown>;
	for (const key of SETTING_KEYS) {
		const definition = SETTING_DEFINITIONS[key];
		const parsed = definition.schema.safeParse(stored.get(key));
		resolved[key] = parsed.success ? parsed.data : definition.defaultValue;
	}
	return resolved as Settings;
}

/** Value of a key, or its default if it is absent or invalid. */
export async function getSetting(db: Db, key: SettingKey): Promise<unknown> {
	const rows = await db
		.select({ value: setting.value })
		.from(setting)
		.where(eq(setting.key, key))
		.limit(1);
	const definition = SETTING_DEFINITIONS[key];
	const parsed = definition.schema.safeParse(rows[0]?.value);
	return parsed.success ? parsed.data : definition.defaultValue;
}

/** Writes a value already validated by the caller. */
export async function writeSetting(
	db: Db,
	key: SettingKey,
	value: unknown,
): Promise<void> {
	await db
		.insert(setting)
		.values({ key, value })
		.onConflictDoUpdate({
			target: setting.key,
			set: { value, updatedAt: new Date() },
		});
}

/** Lead days of the expiry reminders, falling back on `[90, 30, 7]`. */
export async function getExpiryLeadDays(db: Db): Promise<number[]> {
	const all = await getAllSettings(db);
	const value = all["reminders.expiryLeadDays"];
	return value.length > 0 ? value : [...DEFAULT_EXPIRY_LEAD_DAYS];
}

/** Typed view of the Review queue settings. */
export async function getReviewSettings(db: Db): Promise<ReviewSettings> {
	const all = await getAllSettings(db);
	return {
		confidenceThreshold:
			all["review.confidenceThreshold"] ??
			DEFAULT_REVIEW_SETTINGS.confidenceThreshold,
		requireCategory:
			all["review.requireCategory"] ?? DEFAULT_REVIEW_SETTINGS.requireCategory,
		requireIssuer:
			all["review.requireIssuer"] ?? DEFAULT_REVIEW_SETTINGS.requireIssuer,
	};
}
