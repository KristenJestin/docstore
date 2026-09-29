import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "@docstore/db";
import { activityLog, type NewActivityLog } from "@docstore/db/schema/activity";
import { apiKey } from "@docstore/db/schema/api-key";
import { user } from "@docstore/db/schema/auth";
import type {
	ActivityActor,
	ActivityKind,
	ActivityObjectType,
	ActivitySummary,
} from "@docstore/shared/activity";
import { eq } from "drizzle-orm";

/**
 * Activity log, lowest layer (issue #15).
 *
 * Who acts is carried by an async context, set once per request by each
 * surface (oRPC middleware, MCP route, `/files` routes) with `runAsActor`.
 * Everything that runs without one (the worker, the intake polls, the
 * scheduled rules) acts as `system`. The services never take the actor as a
 * parameter: that is what lets a change deep inside `approveReview` or a bulk
 * action still name the key that asked for it (D15-02 of the PR).
 *
 * Lives in `@docstore/ingestion` rather than `@docstore/api` because the
 * pipeline writes entries too (`document.uploaded`, `document.processed`,
 * rules) and must not depend on the API package.
 */

/** Who performs the operation running in the current async context. */
export type Actor =
	| { type: "user"; userId: string; name?: string | null }
	| {
			type: "api_key";
			apiKeyId: string;
			userId: string;
			name?: string | null;
	  }
	| { type: "system" };

export const SYSTEM_ACTOR: Actor = { type: "system" };

const actorScope = new AsyncLocalStorage<Actor>();

/** Runs `fn` on behalf of `actor`: every entry written inside names it. */
export function runAsActor<T>(actor: Actor, fn: () => T): T {
	return actorScope.run(actor, fn);
}

/** The actor of the running operation; `system` outside of any request. */
export function currentActor(): Actor {
	return actorScope.getStore() ?? SYSTEM_ACTOR;
}

/** What a service knows about an entry; the actor and time are added here. */
export interface ActivityDraft {
	kind?: ActivityKind;
	action: string;
	objectType: ActivityObjectType;
	objectId?: string | null;
	objectLabel?: string | null;
	summary?: ActivitySummary;
	sensitive?: boolean;
}

/** Public form of an actor, as the log and the webhooks show it. */
export async function describeActor(
	db: Db,
	actor: Actor,
): Promise<ActivityActor> {
	if (actor.type === "system") {
		return { type: "system", userId: null, apiKeyId: null, name: "system" };
	}
	if (actor.type === "api_key") {
		let name = actor.name ?? null;
		if (name === null) {
			const [row] = await db
				.select({ name: apiKey.name })
				.from(apiKey)
				.where(eq(apiKey.id, actor.apiKeyId))
				.limit(1);
			name = row?.name ?? null;
		}
		return {
			type: "api_key",
			userId: actor.userId,
			apiKeyId: actor.apiKeyId,
			name,
		};
	}
	let name = actor.name ?? null;
	if (name === null) {
		const [row] = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, actor.userId))
			.limit(1);
		name = row?.name ?? null;
	}
	return { type: "user", userId: actor.userId, apiKeyId: null, name };
}

/**
 * Writes entries in one insert, on behalf of `actor` (default: the current
 * one). The caller decides whether to await it: changes are written once the
 * operation succeeded, reads go through `logActivityRead`.
 */
export async function writeActivity(
	db: Db,
	drafts: readonly ActivityDraft[],
	actor: Actor = currentActor(),
): Promise<void> {
	if (drafts.length === 0) return;
	const who = await describeActor(db, actor);
	const now = Date.now();
	// One millisecond apart: the log reads newest first, and the entries of
	// one operation keep the order they were recorded in.
	const rows: NewActivityLog[] = drafts.map((draft, index) => ({
		createdAt: new Date(now + index),
		kind: draft.kind ?? "change",
		action: draft.action,
		actorType: who.type,
		actorUserId: who.userId,
		actorApiKeyId: who.apiKeyId,
		actorName: who.name,
		objectType: draft.objectType,
		objectId: draft.objectId ?? null,
		objectLabel: draft.objectLabel ?? null,
		summary: draft.summary ?? {},
		sensitive: draft.sensitive ?? false,
	}));
	await db.insert(activityLog).values(rows);
}

/**
 * Same as `writeActivity`, but a failure is logged and swallowed: the change
 * it describes is already committed, and an entry that cannot be written must
 * not turn it into an error.
 */
export async function recordActivity(
	db: Db,
	drafts: readonly ActivityDraft[],
	actor: Actor = currentActor(),
): Promise<void> {
	try {
		await writeActivity(db, drafts, actor);
	} catch (error) {
		console.error("[activity] unable to write the activity log", error);
	}
}

/** Reads being written in the background, awaited by `settleActivityReads`. */
const pendingReads = new Set<Promise<void>>();

/**
 * Traces a read without making the request wait for it (D15-04): the insert
 * starts now and finishes in the background, a failure only logs.
 */
export function logActivityRead(
	db: Db,
	draft: Omit<ActivityDraft, "kind">,
	actor: Actor = currentActor(),
): void {
	const pending = recordActivity(db, [{ ...draft, kind: "read" }], actor);
	pendingReads.add(pending);
	void pending.finally(() => pendingReads.delete(pending));
}

/** Waits for the reads still being written (tests, graceful shutdown). */
export async function settleActivityReads(): Promise<void> {
	while (pendingReads.size > 0) {
		await Promise.all(pendingReads);
	}
}
