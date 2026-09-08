import { z } from "zod";
import { archiveModeSchema } from "./archive";

/**
 * Intake sources (SPEC §2 "Misc" and §5): watched folder and IMAP mailbox.
 *
 * The IMAP password only exists in plaintext in the `create` / `update` input:
 * the stored configuration keeps an encrypted copy only (`passwordEncrypted`,
 * AES-256-GCM, see `crypto.service`) and the configuration exposed to the
 * frontend only says `hasPassword`.
 */

export const INTAKE_SOURCE_TYPES = ["folder", "mail"] as const;
export const intakeSourceTypeSchema = z.enum(INTAKE_SOURCE_TYPES);
export type IntakeSourceType = z.infer<typeof intakeSourceTypeSchema>;

/** Outcome of a file seen by a source (`intake_log` journal). */
export const INTAKE_OUTCOMES = [
	"imported",
	"duplicate",
	"error",
	"skipped",
] as const;
export const intakeOutcomeSchema = z.enum(INTAKE_OUTCOMES);
export type IntakeOutcome = z.infer<typeof intakeOutcomeSchema>;

/** Retention of the intake log, purged when the server starts. */
export const INTAKE_LOG_RETENTION_DAYS = 30;

/* ------------------------------------------------------------------ */
/* Default values applied to imported documents                         */
/* ------------------------------------------------------------------ */

export const intakeDefaultsSchema = z.object({
	categoryId: z.string().min(1).nullish(),
	tagIds: z.array(z.string().min(1)).max(50).optional(),
	partyId: z.string().min(1).nullish(),
	sensitive: z.boolean().optional(),
	/**
	 * What a ZIP arriving through this door becomes, overriding the
	 * `intake.archives` setting (see `shared/archive.ts`). Absent = the
	 * household setting decides.
	 */
	archives: archiveModeSchema.optional(),
});
export type IntakeDefaults = z.infer<typeof intakeDefaultsSchema>;

export const EMPTY_INTAKE_DEFAULTS: IntakeDefaults = {};

/* ------------------------------------------------------------------ */
/* Watched folder                                                       */
/* ------------------------------------------------------------------ */

export const FOLDER_AFTER_IMPORTS = ["delete", "move", "keep"] as const;
export const folderAfterImportSchema = z.enum(FOLDER_AFTER_IMPORTS);
export type FolderAfterImport = z.infer<typeof folderAfterImportSchema>;

/** Default scan interval of a watched folder (seconds). */
export const DEFAULT_FOLDER_POLL_SECONDS = 30;

const folderShape = {
	type: z.literal("folder"),
	/** Absolute watched path, as seen by the server. */
	path: z.string().trim().min(1).max(1000),
	recursive: z.boolean().default(false),
	pollSeconds: z.int().min(5).max(86_400).default(DEFAULT_FOLDER_POLL_SECONDS),
	afterImport: folderAfterImportSchema.default("keep"),
	/** Destination folder when `afterImport` is `move`. */
	moveTo: z.string().trim().min(1).max(1000).optional(),
	/** Regular expression tested on the file name (without the path). */
	filePattern: z.string().trim().min(1).max(300).optional(),
};

/** Without a destination, `move` would make the source unusable. */
function requireMoveTo(
	config: { afterImport: string; moveTo?: string },
	ctx: z.RefinementCtx,
): void {
	if (config.afterImport === "move" && !config.moveTo) {
		ctx.addIssue({
			code: "custom",
			path: ["moveTo"],
			message: "`moveTo` is required when afterImport is `move`.",
		});
	}
}

export const folderConfigSchema = z
	.object(folderShape)
	.superRefine(requireMoveTo);
export type FolderConfig = z.infer<typeof folderConfigSchema>;

/* ------------------------------------------------------------------ */
/* IMAP mailbox                                                         */
/* ------------------------------------------------------------------ */

export const MAIL_AFTER_IMPORTS = ["mark_seen", "move", "delete"] as const;
export const mailAfterImportSchema = z.enum(MAIL_AFTER_IMPORTS);
export type MailAfterImport = z.infer<typeof mailAfterImportSchema>;

/** Default poll interval of a mailbox (seconds). */
export const DEFAULT_MAIL_POLL_SECONDS = 300;

const mailCommonShape = {
	type: z.literal("mail"),
	host: z.string().trim().min(1).max(255),
	port: z.int().min(1).max(65_535).default(993),
	secure: z.boolean().default(true),
	username: z.string().trim().min(1).max(255),
	mailbox: z.string().trim().min(1).max(255).default("INBOX"),
	pollSeconds: z.int().min(30).max(86_400).default(DEFAULT_MAIL_POLL_SECONDS),
	onlyUnseen: z.boolean().default(true),
	/** Filter on the sender (substring, case-insensitive). */
	from: z.string().trim().min(1).max(255).optional(),
	/** Regular expression tested on the message subject. */
	subjectPattern: z.string().trim().min(1).max(300).optional(),
	afterImport: mailAfterImportSchema.default("mark_seen"),
	/** Destination IMAP folder when `afterImport` is `move`. */
	moveTo: z.string().trim().min(1).max(255).optional(),
	attachmentsOnly: z.boolean().default(true),
	/** Out of scope for v1: validation rejects `true`. */
	importBodyAsPdf: z
		.boolean()
		.default(false)
		.refine((value) => value === false, {
			message:
				"Importing the message body as PDF is not supported in this version.",
		}),
};

/** Mail configuration as it is stored (encrypted password). */
export const mailConfigSchema = z
	.object({
		...mailCommonShape,
		passwordEncrypted: z.string().min(1).nullable().default(null),
	})
	.superRefine(requireMoveTo);
export type MailConfig = z.infer<typeof mailConfigSchema>;

/** Mail configuration as input: plaintext password, optional. */
export const mailConfigInputSchema = z
	.object({
		...mailCommonShape,
		/** Absent on update = password unchanged. */
		password: z.string().min(1).max(500).optional(),
	})
	.superRefine(requireMoveTo);
export type MailConfigInput = z.infer<typeof mailConfigInputSchema>;

/** Mail configuration returned by the API: never any secret. */
export const mailConfigPublicSchema = z.object({
	...mailCommonShape,
	hasPassword: z.boolean(),
});
export type MailConfigPublic = z.infer<typeof mailConfigPublicSchema>;

/* ------------------------------------------------------------------ */
/* Unions                                                               */
/* ------------------------------------------------------------------ */

/** Configuration stored in the database (`config` column). */
export const intakeSourceConfigSchema = z.union([
	folderConfigSchema,
	mailConfigSchema,
]);
export type IntakeSourceConfig = z.infer<typeof intakeSourceConfigSchema>;

export const intakeSourceConfigInputSchema = z.union([
	folderConfigSchema,
	mailConfigInputSchema,
]);
export type IntakeSourceConfigInput = z.infer<
	typeof intakeSourceConfigInputSchema
>;

export const intakeSourceConfigPublicSchema = z.union([
	z.object(folderShape),
	mailConfigPublicSchema,
]);
export type IntakeSourceConfigPublic = z.infer<
	typeof intakeSourceConfigPublicSchema
>;

/** Cumulative counters of a source. */
export const intakeStatsSchema = z.object({
	imported: z.int().min(0),
	duplicates: z.int().min(0),
	errors: z.int().min(0),
});
export type IntakeStats = z.infer<typeof intakeStatsSchema>;

export const EMPTY_INTAKE_STATS: IntakeStats = {
	imported: 0,
	duplicates: 0,
	errors: 0,
};

/* ------------------------------------------------------------------ */
/* Intake metadata carried by the document                              */
/* ------------------------------------------------------------------ */

/**
 * `document.intake_meta`: what the intake source knows about the document,
 * and what the rule engine finds again in `RuleSubject.mail`.
 */
export const intakeMetaSchema = z.object({
	mail: z
		.object({
			from: z.string().optional(),
			subject: z.string().optional(),
			/** ISO 8601. */
			receivedAt: z.string().optional(),
		})
		.optional(),
	/**
	 * Set on every document pulled out of a ZIP: the archive it came from and
	 * its path inside it. `document.source_ref` carries `<archive>!<entry>`,
	 * this keeps the two apart for anything that needs them separately.
	 */
	archive: z
		.object({
			name: z.string(),
			entry: z.string(),
		})
		.optional(),
});
export type IntakeMeta = z.infer<typeof intakeMetaSchema>;

/* ------------------------------------------------------------------ */
/* DTOs and CRUD inputs                                                 */
/* ------------------------------------------------------------------ */

/**
 * Refusal shown when a source declared in the server configuration file is
 * edited through the API (`update`, `delete`, `toggle`).
 */
export const MANAGED_INTAKE_SOURCE_MESSAGE =
	"This source is defined by the server configuration and cannot be edited here.";

export const intakeSourceSchema = z.object({
	id: z.string(),
	type: intakeSourceTypeSchema,
	name: z.string(),
	enabled: z.boolean(),
	/** Declared in the server configuration file: read-only in the interface. */
	managed: z.boolean(),
	/** Key of the source in the configuration file; `null` when unmanaged. */
	managedKey: z.string().nullable(),
	config: intakeSourceConfigPublicSchema,
	defaults: intakeDefaultsSchema,
	lastRunAt: z.date().nullable(),
	lastError: z.string().nullable(),
	stats: intakeStatsSchema,
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type IntakeSource = z.infer<typeof intakeSourceSchema>;

export const createIntakeSourceInput = z.object({
	name: z.string().trim().min(1).max(150),
	enabled: z.boolean().default(true),
	config: intakeSourceConfigInputSchema,
	defaults: intakeDefaultsSchema.default(EMPTY_INTAKE_DEFAULTS),
});
export type CreateIntakeSourceInput = z.infer<typeof createIntakeSourceInput>;

export const updateIntakeSourceInput = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1).max(150).optional(),
	enabled: z.boolean().optional(),
	/** Replaces the configuration; absent password = unchanged. */
	config: intakeSourceConfigInputSchema.optional(),
	defaults: intakeDefaultsSchema.optional(),
});
export type UpdateIntakeSourceInput = z.infer<typeof updateIntakeSourceInput>;

export const toggleIntakeSourceInput = z.object({
	id: z.string().min(1),
	enabled: z.boolean(),
});
export type ToggleIntakeSourceInput = z.infer<typeof toggleIntakeSourceInput>;

/**
 * `test` accepts a stored source, an unsaved draft, or both.
 *
 * Both together is the edit form: the user tweaked a stored source and wants to
 * try the pending values before saving. The draft is then merged over the
 * stored configuration, and an empty password keeps the stored one — the form
 * never gets the secret back, so it cannot resend it.
 */
export const testIntakeSourceInput = z
	.object({
		id: z.string().min(1).optional(),
		draft: intakeSourceConfigInputSchema.optional(),
	})
	.refine((input) => Boolean(input.id) || Boolean(input.draft), {
		message: "Provide `id`, `draft`, or both.",
	});
export type TestIntakeSourceInput = z.infer<typeof testIntakeSourceInput>;

export const testIntakeSourceResultSchema = z.object({
	ok: z.boolean(),
	/** Files (folder) or messages (mail) that would be processed now. */
	candidates: z.int().min(0),
	message: z.string(),
});
export type TestIntakeSourceResult = z.infer<
	typeof testIntakeSourceResultSchema
>;

export const runIntakeSourceResultSchema = z.object({
	id: z.string(),
	jobId: z.string().nullable(),
	queued: z.boolean(),
});
export type RunIntakeSourceResult = z.infer<typeof runIntakeSourceResultSchema>;

export const intakeLogSchema = z.object({
	id: z.string(),
	sourceId: z.string(),
	documentId: z.string().nullable(),
	filename: z.string(),
	outcome: intakeOutcomeSchema,
	message: z.string().nullable(),
	createdAt: z.date(),
});
export type IntakeLog = z.infer<typeof intakeLogSchema>;

export const listIntakeLogsInput = z.object({
	id: z.string().min(1),
	page: z.int().min(1).default(1),
	pageSize: z.int().min(1).max(100).default(25),
});
export type ListIntakeLogsInput = z.infer<typeof listIntakeLogsInput>;

/* ------------------------------------------------------------------ */
/* Pure helpers                                                         */
/* ------------------------------------------------------------------ */

/**
 * Effective poll interval of a source.
 *
 * pg-boss does not go below one minute (`unschedule` is indexed by queue name,
 * one schedule per queue): the `intake.poll` dispatcher runs every minute and
 * only picks a source when its last run is older than `pollSeconds`, rounded
 * up to the next minute.
 */
export function effectivePollSeconds(pollSeconds: number): number {
	return Math.max(60, Math.ceil(pollSeconds / 60) * 60);
}

/** True when the source must be polled now. */
export function isDue(
	lastRunAt: Date | null,
	pollSeconds: number,
	now: Date = new Date(),
): boolean {
	if (!lastRunAt) return true;
	const interval = effectivePollSeconds(pollSeconds) * 1000;
	// A half-minute tolerance keeps a drift of a few milliseconds from
	// pushing the poll back by a whole tick.
	return now.getTime() - lastRunAt.getTime() >= interval - 30_000;
}

/** Public configuration (without secret) of a stored source. */
export function toPublicConfig(
	config: IntakeSourceConfig,
): IntakeSourceConfigPublic {
	if (config.type === "folder") return config;
	const { passwordEncrypted, ...rest } = config;
	return { ...rest, hasPassword: Boolean(passwordEncrypted) };
}
