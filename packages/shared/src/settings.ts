import { z } from "zod";
import {
	CONTENT_LOCALES,
	contentLocaleSchema,
	DEFAULT_CONTENT_LOCALE,
} from "./common";
import { DEFAULT_EXPIRY_LEAD_DAYS } from "./reminder";

/**
 * Application settings (table `settings`, JSONB key/value).
 *
 * Each key carries its own validation schema and default value: the
 * `settings.set` procedure rejects a value that does not match.
 */

export const SETTING_KEYS = [
	"review.confidenceThreshold",
	"review.requireCategory",
	"review.requireIssuer",
	"reminders.expiryLeadDays",
	"asn.autoAssign",
	"content.locale",
] as const;
export const settingKeySchema = z.enum(SETTING_KEYS);
export type SettingKey = z.infer<typeof settingKeySchema>;

/** Threshold below which an automatic value triggers a review. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

/**
 * Lead days for expiry reminders: one reminder per value, counted back from
 * `document.valid_until`. Sorted descending, without duplicates.
 */
/**
 * When an archive serial number (ASN) is handed out without being asked for
 * (SPEC §2).
 *
 * - `never`: numbering stays the manual gesture it has always been.
 * - `always`: every document that leaves the pipeline gets a number.
 * - `scans`: only the documents whose text had to be OCRed, that is those
 *   arriving as a scan or a photograph — a paper original exists somewhere and
 *   wants a place in the binder.
 *
 * A document type flagged `paperOriginal` numbers its documents whatever this
 * setting says: the two combine with an `or`.
 */
export const ASN_AUTO_ASSIGN_MODES = ["never", "always", "scans"] as const;
export const asnAutoAssignSchema = z.enum(ASN_AUTO_ASSIGN_MODES);
export type AsnAutoAssignMode = z.infer<typeof asnAutoAssignSchema>;

export const expiryLeadDaysSchema = z
	.array(z.int().min(0).max(3650))
	.min(1)
	.max(10)
	.transform((days) => [...new Set(days)].sort((a, b) => b - a));

/**
 * `label` and `description` are shown as is on the settings screen: short
 * label, one sentence of explanation. Both are English, like every other
 * visible string (see CLAUDE.md).
 */
type SettingDefinition = {
	schema: z.ZodType;
	defaultValue: unknown;
	label: string;
	description: string;
};

export const SETTING_DEFINITIONS: Record<SettingKey, SettingDefinition> = {
	"review.confidenceThreshold": {
		schema: z.number().min(0).max(1),
		defaultValue: DEFAULT_CONFIDENCE_THRESHOLD,
		label: "Review confidence threshold",
		description:
			"Between 0 and 1. A value extracted below this score sends the document to the review queue instead of making it active.",
	},
	"review.requireCategory": {
		schema: z.boolean(),
		defaultValue: true,
		label: "Require a category",
		description:
			"A document without a category stays in the review queue until one is chosen.",
	},
	"review.requireIssuer": {
		schema: z.boolean(),
		defaultValue: true,
		label: "Require an issuer",
		description:
			"A document whose issuer could not be matched stays in the review queue until one is chosen.",
	},
	"reminders.expiryLeadDays": {
		schema: expiryLeadDaysSchema,
		defaultValue: [...DEFAULT_EXPIRY_LEAD_DAYS],
		label: "Expiry reminder lead times",
		description:
			"One reminder per value, counted back in days from the document expiry date (90, 30, 7…). Ten values at most.",
	},
	"asn.autoAssign": {
		schema: asnAutoAssignSchema,
		defaultValue: "never",
		label: "Automatic ASN",
		description:
			"Hands out the next archive serial number on its own: never, on every document, or only on the scanned ones.",
	},
	"content.locale": {
		schema: contentLocaleSchema,
		defaultValue: DEFAULT_CONTENT_LOCALE,
		label: "Content language",
		description:
			"Used for generated titles, file names and dates inside your documents; the interface stays in English.",
	},
};

export type { ContentLocale } from "./common";
/** Re-exported so the settings screen can list the choices. */
export { CONTENT_LOCALES, contentLocaleSchema, DEFAULT_CONTENT_LOCALE };

/** Review queue settings, all resolved with their defaults. */
export const reviewSettingsSchema = z.object({
	confidenceThreshold: z.number().min(0).max(1),
	requireCategory: z.boolean(),
	requireIssuer: z.boolean(),
});
export type ReviewSettings = z.infer<typeof reviewSettingsSchema>;

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
	confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
	requireCategory: true,
	requireIssuer: true,
};

export const settingsSchema = z.object({
	"review.confidenceThreshold": z.number().min(0).max(1),
	"review.requireCategory": z.boolean(),
	"review.requireIssuer": z.boolean(),
	"reminders.expiryLeadDays": z.array(z.int().min(0)),
	"asn.autoAssign": asnAutoAssignSchema,
	"content.locale": contentLocaleSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const setSettingInput = z.object({
	key: settingKeySchema,
	value: z.unknown(),
});
export type SetSettingInput = z.infer<typeof setSettingInput>;

/* ------------------------------------------------------------------ */
/* Server information                                                   */
/* ------------------------------------------------------------------ */

/** Application version, reported by `settings.serverInfo`. */
export const APP_VERSION = "1.0.0";

/**
 * What the interface needs to know about the machine it talks to: the two
 * origins (they differ in development, and only the API one is usable in an
 * MCP command line), the version, and where the server configuration file is
 * looked for.
 */
export const serverInfoSchema = z.object({
	/** Public origin of the **web** app (`PUBLIC_URL`, else the API origin). */
	publicUrl: z.string(),
	/** Origin of the **API** (`BETTER_AUTH_URL`): base of `/rpc` and `/mcp`. */
	apiUrl: z.string(),
	version: z.string(),
	/** Path of the configuration file, whether or not it exists. */
	configPath: z.string(),
	/** Number of intake sources declared by that file. */
	managedIntakeSources: z.int().min(0),
});
export type ServerInfo = z.infer<typeof serverInfoSchema>;
