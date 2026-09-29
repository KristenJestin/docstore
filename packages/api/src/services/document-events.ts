import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "@docstore/db";
import type { IngestionContext } from "@docstore/ingestion";
import { emitDocumentEvent, webhookDocumentSummary } from "@docstore/ingestion";
import type {
	DocumentChangeEvent,
	WebhookDocument,
} from "@docstore/shared/webhook";

/**
 * Document webhooks emitted by the business services (SPEC §2 "Misc").
 *
 * Every service that changes a document records what it did in the batch of
 * the current operation; the batch is flushed once the operation succeeded,
 * as one event per document. Emitting here, and not in the routers, is what
 * lets MCP, bulk actions, rules and any future surface notify the subscribers
 * without having to remember it.
 *
 * The services only take a `Db`: the queue is found through the ingestion
 * context bound to that connection at startup (`bindDocumentEvents`). No
 * binding (unit tests, degraded server without a queue) means no event, the
 * same contract as `emitEvent`.
 */

const bindings = new WeakMap<Db, IngestionContext>();

/**
 * Routes the document events of the services running on `ctx.db` to the
 * queue of `ctx`. Returns the function that removes the binding.
 */
export function bindDocumentEvents(ctx: IngestionContext): () => void {
	bindings.set(ctx.db, ctx);
	return () => {
		if (bindings.get(ctx.db) === ctx) bindings.delete(ctx.db);
	};
}

/** Strength of an event: the strongest one recorded for a document wins. */
const STRENGTH: Record<DocumentChangeEvent, number> = {
	"document.updated": 0,
	"document.trashed": 1,
	"document.restored": 1,
	"document.merged": 2,
	"document.deleted": 3,
};

type Recorded = {
	event: DocumentChangeEvent;
	/** `document.deleted`: the row is gone by the time the batch is flushed. */
	snapshot?: WebhookDocument;
	/** `document.merged`: the document that absorbed this one. */
	keptDocumentId?: string;
};

/** Changes recorded by one operation, keyed by document. */
export class DocumentEventBatch {
	readonly #entries = new Map<string, Recorded>();

	/** The document changed but stays where it was. */
	updated(...documentIds: readonly string[]): void {
		for (const id of documentIds)
			this.#record(id, { event: "document.updated" });
	}

	trashed(...documentIds: readonly string[]): void {
		for (const id of documentIds)
			this.#record(id, { event: "document.trashed" });
	}

	restored(...documentIds: readonly string[]): void {
		for (const id of documentIds) {
			this.#record(id, { event: "document.restored" });
		}
	}

	/** `documentId` was absorbed by `keptDocumentId` (and went to the trash). */
	merged(documentId: string, keptDocumentId: string): void {
		this.#record(documentId, { event: "document.merged", keptDocumentId });
	}

	/** Permanent deletion: `snapshot` is the summary read before the delete. */
	deleted(snapshot: WebhookDocument): void {
		this.#record(snapshot.id, { event: "document.deleted", snapshot });
	}

	/** What the batch will emit, in recording order. */
	entries(): [string, Recorded][] {
		return [...this.#entries];
	}

	#record(documentId: string, entry: Recorded): void {
		const current = this.#entries.get(documentId);
		// Equal strength: the last word wins (trashed then restored = restored).
		if (!current || STRENGTH[entry.event] >= STRENGTH[current.event]) {
			this.#entries.set(documentId, entry);
		}
	}
}

const scope = new AsyncLocalStorage<DocumentEventBatch>();

/**
 * Runs a service operation with an event batch.
 *
 * A service called from within another one (`approveReview` applying its patch
 * through `updateDocument`, `approveManyReview` looping over `approveReview`)
 * joins the batch already open: the events go out once, when the outermost
 * operation returns. An operation that throws emits nothing.
 */
export async function withDocumentEvents<T>(
	db: Db,
	run: (events: DocumentEventBatch) => Promise<T>,
): Promise<T> {
	const open = scope.getStore();
	if (open) return run(open);

	const batch = new DocumentEventBatch();
	const result = await scope.run(batch, () => run(batch));
	await flushDocumentEvents(db, batch);
	return result;
}

/**
 * Summary of a document about to be deleted for good: `document.deleted`
 * carries the last known state, read while the row still exists.
 */
export function documentSnapshot(
	db: Db,
	documentId: string,
): Promise<WebhookDocument | null> {
	return webhookDocumentSummary(db, documentId);
}

/**
 * Publishes the batch. A failure is logged and swallowed: the change is
 * committed, and an unreachable queue must not turn it into an error.
 */
async function flushDocumentEvents(
	db: Db,
	batch: DocumentEventBatch,
): Promise<void> {
	const ctx = bindings.get(db);
	if (!ctx?.queue) return;
	for (const [documentId, entry] of batch.entries()) {
		try {
			await emitDocumentEvent(ctx, entry.event, documentId, {
				...(entry.snapshot ? { snapshot: entry.snapshot } : {}),
				...(entry.keptDocumentId
					? { extra: { keptDocumentId: entry.keptDocumentId } }
					: {}),
			});
		} catch (error) {
			console.error(`[webhook] unable to emit ${entry.event}`, error);
		}
	}
}

/**
 * Wraps an exported service so that it runs within `withDocumentEvents`, the
 * connection being its first argument. Inside, `documentEvents()` hands out
 * the batch of the operation.
 */
export function emitsDocumentEvents<Args extends [Db, ...unknown[]], Result>(
	operation: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
	return (...args) => withDocumentEvents(args[0], () => operation(...args));
}

/**
 * Batch of the running operation. Outside of any (a helper called directly by
 * a test), a detached batch that nobody flushes.
 */
export function documentEvents(): DocumentEventBatch {
	return scope.getStore() ?? new DocumentEventBatch();
}
