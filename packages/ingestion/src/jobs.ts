/**
 * Names and options of the pg-boss jobs (SPEC §5).
 *
 * - `document.process` chains extractText → render → analyze → finalize for a
 *   given file;
 * - `reminders.generate` recomputes the reminders (expiry, missing periods),
 *   scheduled every day at 06:00 and replayed at startup;
 * - `intake.poll` is the dispatcher of the intake sources: scheduled every
 *   minute, it publishes `intake.folder.poll` / `intake.mail.poll` for the
 *   sources whose polling interval has elapsed;
 * - `webhook.deliver` delivers an event to a webhook, with retries.
 */

export const DOCUMENT_PROCESS_JOB = "document.process";
export const REMINDERS_GENERATE_JOB = "reminders.generate";
export const INTAKE_POLL_JOB = "intake.poll";
export const INTAKE_FOLDER_POLL_JOB = "intake.folder.poll";
export const INTAKE_MAIL_POLL_JOB = "intake.mail.poll";
export const WEBHOOK_DELIVER_JOB = "webhook.deliver";

/** All the queue names to create at startup. */
export const JOB_NAMES = [
	DOCUMENT_PROCESS_JOB,
	REMINDERS_GENERATE_JOB,
	INTAKE_POLL_JOB,
	INTAKE_FOLDER_POLL_JOB,
	INTAKE_MAIL_POLL_JOB,
	WEBHOOK_DELIVER_JOB,
] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** Cron expression of the daily reminder generation (06:00). */
export const REMINDERS_GENERATE_CRON = "0 6 * * *";

/**
 * Polling interval of the intake dispatcher.
 *
 * pg-boss only schedules one cron expression per queue (`unschedule` is indexed
 * by queue name) and cron does not go below the minute: a per-source schedule is
 * therefore impossible. The dispatcher runs every minute and only elects the
 * sources that are really due (`isDue`), which makes `pollSeconds` effective to
 * the minute, with a one-minute floor.
 */
export const INTAKE_POLL_CRON = "* * * * *";

/** Payload of `document.process`. */
export interface DocumentProcessPayload {
	documentId: string;
	fileId: string;
}

/** Payload of `intake.folder.poll` and `intake.mail.poll`. */
export interface IntakePollPayload {
	sourceId: string;
}

/** Payload of `webhook.deliver`. */
export interface WebhookDeliverPayload {
	/** Registered webhook; absent for a `webhook { url }` rule action. */
	webhookId?: string | null;
	/** Explicit URL (rule action); otherwise the registered webhook's one. */
	url?: string;
	event: string;
	payload: unknown;
}

/** Total number of extra attempts after the first failure. */
export const JOB_RETRY_LIMIT = 3;
/** Maximum run time of a job before it is retried (5 min). */
export const JOB_EXPIRE_IN_SECONDS = 300;

/** Common options applied to the queue and to each send. */
export const JOB_OPTIONS = {
	retryLimit: JOB_RETRY_LIMIT,
	retryBackoff: true,
	expireInSeconds: JOB_EXPIRE_IN_SECONDS,
} as const;

/** Retries specific to webhook deliveries (SPEC §2 "Misc"). */
export const WEBHOOK_JOB_OPTIONS = {
	retryLimit: 5,
	retryBackoff: true,
	expireInSeconds: 60,
} as const;

/** Checks that a payload received from the queue has the right shape. */
export function isDocumentProcessPayload(
	value: unknown,
): value is DocumentProcessPayload {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.documentId === "string" &&
		typeof candidate.fileId === "string"
	);
}

export function isIntakePollPayload(
	value: unknown,
): value is IntakePollPayload {
	if (typeof value !== "object" || value === null) return false;
	return typeof (value as Record<string, unknown>).sourceId === "string";
}

export function isWebhookDeliverPayload(
	value: unknown,
): value is WebhookDeliverPayload {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.event !== "string") return false;
	return (
		typeof candidate.webhookId === "string" || typeof candidate.url === "string"
	);
}
