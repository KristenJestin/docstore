import type { IngestionContext } from "./context";
import { dispatchIntakePolls, runIntakeSource } from "./intake-source";
import {
	DOCUMENT_PROCESS_JOB,
	type DocumentProcessPayload,
	INTAKE_FOLDER_POLL_JOB,
	INTAKE_MAIL_POLL_JOB,
	INTAKE_POLL_JOB,
	type IntakePollPayload,
	isDocumentProcessPayload,
	isIntakePollPayload,
	isWebhookDeliverPayload,
	JOB_RETRY_LIMIT,
	REMINDERS_GENERATE_JOB,
	WEBHOOK_DELIVER_JOB,
	type WebhookDeliverPayload,
} from "./jobs";
import { processDocument } from "./pipeline";
import type { IngestionQueue } from "./queue";
import { deliverWebhook } from "./webhook";

/**
 * Number of jobs processed in parallel.
 *
 * pg-boss v10 removed `teamSize`: we register `concurrency` workers with
 * `batchSize: 1` rather than one worker with `batchSize: 2`, so that the failure
 * of one job does not replay its neighbour (the handler result applies to the
 * whole batch). OCR being CPU-bound, we stay at 2.
 */
export const WORKER_CONCURRENCY = 2;

export interface StartWorkerOptions {
	concurrency?: number;
	pollingIntervalSeconds?: number;
}

export interface IngestionWorker {
	readonly workerIds: string[];
	stop(): Promise<void>;
}

/** Number of the current attempt (pg-boss counts retries from 0). */
function attemptOf(job: unknown): number {
	const count = (job as { retryCount?: number }).retryCount;
	return typeof count === "number" ? count + 1 : 1;
}

/** Registers the `document.process` workers on the given queue. */
export async function startWorker(
	ctx: IngestionContext,
	queue: IngestionQueue,
	options: StartWorkerOptions = {},
): Promise<IngestionWorker> {
	const concurrency = options.concurrency ?? WORKER_CONCURRENCY;
	const pollingIntervalSeconds = options.pollingIntervalSeconds ?? 2;
	const workerIds: string[] = [];

	for (let index = 0; index < concurrency; index++) {
		const id = await queue.boss.work<DocumentProcessPayload>(
			DOCUMENT_PROCESS_JOB,
			// `includeMetadata`: the attempt number decides whether a failure is
			// the last one, which is what turns the document to `failed`.
			{ batchSize: 1, includeMetadata: true, pollingIntervalSeconds },
			async (jobs) => {
				for (const job of jobs) {
					if (!isDocumentProcessPayload(job.data)) {
						throw new Error(
							`Invalid ${DOCUMENT_PROCESS_JOB} payload: ${JSON.stringify(job.data)}`,
						);
					}
					await processDocument(ctx, job.data, {
						attempt: attemptOf(job),
						maxAttempts: JOB_RETRY_LIMIT + 1,
					});
				}
			},
		);
		workerIds.push(id);
	}

	// A single worker is enough for the reminder recomputation: it is short,
	// global and not worth parallelizing. Without an injected hook the queue has
	// no consumer at all, which is silent unless we say so — the reminders would
	// simply never appear.
	if (!ctx.generateReminders) {
		console.warn(
			`[ingestion] no \`generateReminders\` hook: "${REMINDERS_GENERATE_JOB}" jobs will never run.`,
		);
	}
	if (ctx.generateReminders) {
		const generate = ctx.generateReminders;
		const id = await queue.boss.work(
			REMINDERS_GENERATE_JOB,
			{ batchSize: 1, pollingIntervalSeconds },
			async () => {
				await generate(ctx.db);
			},
		);
		workerIds.push(id);
	}

	// Intake dispatcher: it only publishes runs.
	workerIds.push(
		await queue.boss.work(
			INTAKE_POLL_JOB,
			{ batchSize: 1, pollingIntervalSeconds },
			async () => {
				await dispatchIntakePolls(ctx);
			},
		),
	);

	for (const name of [INTAKE_FOLDER_POLL_JOB, INTAKE_MAIL_POLL_JOB]) {
		workerIds.push(
			await queue.boss.work<IntakePollPayload>(
				name,
				{ batchSize: 1, pollingIntervalSeconds },
				async (jobs) => {
					for (const job of jobs) {
						if (!isIntakePollPayload(job.data)) {
							throw new Error(
								`Invalid ${name} payload: ${JSON.stringify(job.data)}`,
							);
						}
						// `runIntakeSource` captures its errors in `last_error`: a broken
						// source does not block the queue.
						await runIntakeSource(ctx, job.data.sourceId);
					}
				},
			),
		);
	}

	workerIds.push(
		await queue.boss.work<WebhookDeliverPayload>(
			WEBHOOK_DELIVER_JOB,
			{ batchSize: 1, includeMetadata: true, pollingIntervalSeconds },
			async (jobs) => {
				for (const job of jobs) {
					if (!isWebhookDeliverPayload(job.data)) {
						throw new Error(
							`Invalid ${WEBHOOK_DELIVER_JOB} payload: ${JSON.stringify(job.data)}`,
						);
					}
					await deliverWebhook(ctx, job.data, attemptOf(job));
				}
			},
		),
	);

	return {
		workerIds,
		async stop() {
			for (const id of workerIds) {
				await queue.boss.offWork({ id });
			}
		},
	};
}
