import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import type { ActivityDraft, IngestionContext } from "@docstore/ingestion";
import {
	emitDocumentEvent,
	recordActivity,
	webhookDocumentSummary,
} from "@docstore/ingestion";
import {
	type ActivitySummary,
	withoutFieldValue,
} from "@docstore/shared/activity";
import type {
	DocumentChangeEvent,
	WebhookDocument,
} from "@docstore/shared/webhook";
import { inArray } from "drizzle-orm";

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
 *
 * The same batch feeds the activity log (issue #15): each recorded change
 * becomes an entry naming the actor of the request, written when the batch is
 * flushed, with or without a queue. A service that only says `updated(id)`
 * still leaves a generic `document.updated` entry, so no change goes
 * unlogged; one that knows more says it with `changed(id, action, summary)`.
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
	/** Activity entries, in recording order: every change, not just the strongest. */
	readonly #activity: ActivityDraft[] = [];
	/** What caused generic entries (`tag.merged` for the documents it retagged). */
	#cause: string | null = null;

	/** The document changed but stays where it was. */
	updated(...documentIds: readonly string[]): void {
		for (const id of documentIds)
			this.#record(id, { event: "document.updated" });
	}

	/**
	 * The document changed, and the service knows how: `action` and `summary`
	 * go to the activity log (fields before and after, never content).
	 */
	changed(documentId: string, action: string, summary: ActivitySummary): void {
		this.#record(documentId, { event: "document.updated" });
		this.#activity.push({
			action,
			objectType: "document",
			objectId: documentId,
			summary,
		});
	}

	trashed(...documentIds: readonly string[]): void {
		for (const id of documentIds) {
			this.#record(id, { event: "document.trashed" });
			this.#documentActivity(id, "document.trashed");
		}
	}

	restored(...documentIds: readonly string[]): void {
		for (const id of documentIds) {
			this.#record(id, { event: "document.restored" });
			this.#documentActivity(id, "document.restored");
		}
	}

	/** `documentId` was absorbed by `keptDocumentId` (and went to the trash). */
	merged(documentId: string, keptDocumentId: string): void {
		this.#record(documentId, { event: "document.merged", keptDocumentId });
		this.#documentActivity(documentId, "document.merged", { keptDocumentId });
	}

	/** Permanent deletion: `snapshot` is the summary read before the delete. */
	deleted(snapshot: WebhookDocument): void {
		this.#record(snapshot.id, { event: "document.deleted", snapshot });
		this.#activity.push({
			action: "document.deleted",
			objectType: "document",
			objectId: snapshot.id,
			objectLabel: snapshot.title,
			sensitive: snapshot.sensitive,
			summary: {},
		});
	}

	/** An entry about something else than a document (a party, a tag…). */
	activity(draft: ActivityDraft): void {
		this.#activity.push(draft);
	}

	/**
	 * Names what caused the plain `updated(id)` of this operation: the generic
	 * entries of those documents then say `{ via: cause }`.
	 */
	cause(action: string): void {
		this.#cause = action;
	}

	/** What the batch will emit, in recording order. */
	entries(): [string, Recorded][] {
		return [...this.#entries];
	}

	/**
	 * Activity entries of the batch: the explicit ones, plus one generic entry
	 * per changed document that has none, so that no change goes unlogged.
	 */
	activityDrafts(): ActivityDraft[] {
		const described = new Set(
			this.#activity
				.filter((draft) => draft.objectType === "document")
				.map((draft) => draft.objectId),
		);
		const generic: ActivityDraft[] = [];
		for (const [documentId, entry] of this.#entries) {
			if (described.has(documentId)) continue;
			generic.push({
				action: entry.event,
				objectType: "document",
				objectId: documentId,
				summary: this.#cause ? { via: this.#cause } : {},
			});
		}
		return [...this.#activity, ...generic];
	}

	#documentActivity(
		documentId: string,
		action: string,
		summary: ActivitySummary = {},
	): void {
		this.#activity.push({
			action,
			objectType: "document",
			objectId: documentId,
			summary,
		});
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
	await flushActivity(db, batch);
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
 * Writes the activity entries of the batch in one insert, on behalf of the
 * actor of the request. The title and `sensitive` flag of each document are
 * read once, after the change: the entry names the document as it now is.
 *
 * On a sensitive document, a field change is stored without its value, only
 * the fact that the field changed (issue #22): whoever reads the log later,
 * with whatever rights, cannot learn the amount from it.
 */
async function flushActivity(db: Db, batch: DocumentEventBatch): Promise<void> {
	const drafts = batch.activityDrafts();
	if (drafts.length === 0) return;
	const ids = [
		...new Set(
			drafts
				.filter((draft) => draft.objectType === "document" && draft.objectId)
				.map((draft) => draft.objectId as string),
		),
	];
	const documents = new Map<string, { title: string; sensitive: boolean }>();
	if (ids.length > 0) {
		try {
			const rows = await db
				.select({
					id: document.id,
					title: document.title,
					sensitive: document.sensitive,
				})
				.from(document)
				.where(inArray(document.id, ids));
			for (const row of rows) documents.set(row.id, row);
		} catch (error) {
			console.error("[activity] unable to read the documents", error);
		}
	}
	await recordActivity(
		db,
		drafts.map((draft) => {
			const found =
				draft.objectType === "document" && draft.objectId
					? documents.get(draft.objectId)
					: undefined;
			if (!found) return draft;
			const sensitive = draft.sensitive ?? found.sensitive;
			return {
				...draft,
				objectLabel: draft.objectLabel ?? found.title,
				sensitive,
				summary: sensitive
					? withoutFieldValue(draft.action, draft.summary ?? {})
					: draft.summary,
			};
		}),
	);
}

/**
 * Records an entry from a service that changes no document (a tag renamed, a
 * key revoked). Inside an operation it joins the batch and is written with
 * it; outside, it is written right away.
 */
export async function recordServiceActivity(
	db: Db,
	draft: ActivityDraft,
): Promise<void> {
	const open = scope.getStore();
	if (open) {
		open.activity(draft);
		return;
	}
	await recordActivity(db, [draft]);
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
