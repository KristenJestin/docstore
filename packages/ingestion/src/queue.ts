import PgBoss from "pg-boss";
import {
	DOCUMENT_PROCESS_JOB,
	type DocumentProcessPayload,
	INTAKE_FOLDER_POLL_JOB,
	INTAKE_MAIL_POLL_JOB,
	INTAKE_POLL_CRON,
	INTAKE_POLL_JOB,
	JOB_NAMES,
	JOB_OPTIONS,
	REMINDERS_GENERATE_CRON,
	REMINDERS_GENERATE_JOB,
	WEBHOOK_DELIVER_JOB,
	WEBHOOK_JOB_OPTIONS,
	type WebhookDeliverPayload,
} from "./jobs";

/** PostgreSQL schema used by pg-boss, in the same database as the app. */
export const PGBOSS_SCHEMA = "pgboss";

export interface CreateQueueOptions {
	connectionString: string;
	/** PostgreSQL schema (`pgboss` by default). */
	schema?: string;
	/** Size of the pool dedicated to the queue. */
	max?: number;
}

/** State of the queue exposed by `/health`. */
export interface QueueHealth {
	started: boolean;
	/** Jobs pending on `document.process`, `null` if unavailable. */
	pending: number | null;
}

/**
 * pg-boss wrapper: explicit lifecycle, queue creation and typed job
 * publication.
 */
export class IngestionQueue {
	readonly boss: PgBoss;
	private started = false;

	constructor(options: CreateQueueOptions) {
		this.boss = new PgBoss({
			connectionString: options.connectionString,
			schema: options.schema ?? PGBOSS_SCHEMA,
			max: options.max ?? 4,
		});
		// Without a listener, a background pg-boss error would take the process down.
		this.boss.on("error", (error) => {
			console.error("[ingestion] pg-boss error", error);
		});
	}

	get isStarted(): boolean {
		return this.started;
	}

	/** Starts pg-boss (schema migration included) and creates the queues. */
	async start(): Promise<void> {
		if (this.started) return;
		await this.boss.start();
		for (const name of JOB_NAMES) {
			const options =
				name === WEBHOOK_DELIVER_JOB ? WEBHOOK_JOB_OPTIONS : JOB_OPTIONS;
			await this.boss.createQueue(name, { name, ...options });
		}
		this.started = true;
		await this.scheduleRemindersGenerate();
		await this.scheduleIntakePoll();
	}

	/**
	 * Schedules the daily reminder generation (06:00).
	 *
	 * `schedule` is idempotent on the pg-boss side: calling the method again
	 * replaces the existing schedule. A failure must not prevent the server from
	 * starting — the generation can still be triggered by hand.
	 */
	async scheduleRemindersGenerate(): Promise<void> {
		try {
			await this.boss.schedule(REMINDERS_GENERATE_JOB, REMINDERS_GENERATE_CRON);
		} catch (error) {
			console.error("[ingestion] unable to schedule reminders.generate", error);
		}
	}

	/** Publishes an immediate `reminders.generate` (startup, manual action). */
	async publishRemindersGenerate(): Promise<string | null> {
		return await this.boss.send(
			REMINDERS_GENERATE_JOB,
			{},
			{ ...JOB_OPTIONS, singletonKey: REMINDERS_GENERATE_JOB },
		);
	}

	/**
	 * Schedules the intake dispatcher (every minute).
	 *
	 * See `INTAKE_POLL_CRON`: pg-boss only accepts one schedule per queue, so the
	 * polling interval of each source is arbitrated in the handler and not by the
	 * cron.
	 */
	async scheduleIntakePoll(): Promise<void> {
		try {
			await this.boss.schedule(INTAKE_POLL_JOB, INTAKE_POLL_CRON);
		} catch (error) {
			console.error("[ingestion] unable to schedule intake.poll", error);
		}
	}

	/** Publishes an immediate run for a source ("Run" button). */
	async publishIntakePoll(
		type: "folder" | "mail",
		sourceId: string,
	): Promise<string | null> {
		const name =
			type === "folder" ? INTAKE_FOLDER_POLL_JOB : INTAKE_MAIL_POLL_JOB;
		return await this.boss.send(
			name,
			{ sourceId },
			// A single run in flight per source: two clicks do not scan twice.
			{ ...JOB_OPTIONS, singletonKey: sourceId },
		);
	}

	/** Publishes a webhook delivery (own retries, see `WEBHOOK_JOB_OPTIONS`). */
	async publishWebhookDeliver(
		payload: WebhookDeliverPayload,
	): Promise<string | null> {
		return await this.boss.send(
			WEBHOOK_DELIVER_JOB,
			payload as unknown as object,
			WEBHOOK_JOB_OPTIONS,
		);
	}

	/** Graceful shutdown: lets the running jobs finish. */
	async stop(): Promise<void> {
		if (!this.started) return;
		this.started = false;
		await this.boss.stop({ graceful: true, wait: true, close: true });
	}

	/** Publishes a `document.process` job. Returns the job id. */
	async publishDocumentProcess(
		payload: DocumentProcessPayload,
	): Promise<string | null> {
		return await this.boss.send(DOCUMENT_PROCESS_JOB, payload, {
			...JOB_OPTIONS,
			// A single job in flight per file: republishing during processing does
			// not duplicate the work.
			singletonKey: payload.fileId,
		});
	}

	async health(): Promise<QueueHealth> {
		if (!this.started) return { started: false, pending: null };
		try {
			return {
				started: true,
				pending: await this.boss.getQueueSize(DOCUMENT_PROCESS_JOB),
			};
		} catch {
			return { started: true, pending: null };
		}
	}
}

export function createQueue(options: CreateQueueOptions): IngestionQueue {
	return new IngestionQueue(options);
}
