import type { Db } from "@docstore/db";
import { type ActivityLogRow, activityLog } from "@docstore/db/schema/activity";
import { category } from "@docstore/db/schema/category";
import { customField } from "@docstore/db/schema/custom-field";
import { party } from "@docstore/db/schema/party";
import { tag } from "@docstore/db/schema/tag";
import { type Actor, currentActor, logActivityRead } from "@docstore/ingestion";
import type {
	ActivityEntry,
	ActivitySummary,
	FieldChange,
	ListActivityInput,
} from "@docstore/shared/activity";
import { type Paginated, paginationMeta } from "@docstore/shared/pagination";
import {
	and,
	count,
	desc,
	eq,
	gte,
	inArray,
	like,
	lt,
	type SQL,
} from "drizzle-orm";

/**
 * Activity log, API side (issue #15): the listing behind the Activity page,
 * `activity.list` and MCP `list_activity`, and the read traces of the
 * surfaces that serve documents.
 *
 * The changes are written by the document event batch
 * (`document-events.ts`), next to the webhooks; the reads by the helpers
 * below, in the background.
 */

function toEntry(row: ActivityLogRow): ActivityEntry {
	return {
		id: row.id,
		createdAt: row.createdAt,
		kind: row.kind,
		action: row.action,
		actor: {
			type: row.actorType,
			userId: row.actorUserId,
			apiKeyId: row.actorApiKeyId,
			name: row.actorName,
		},
		objectType: row.objectType,
		objectId: row.objectId,
		objectLabel: row.objectLabel,
		summary: row.summary,
		sensitive: row.sensitive,
	};
}

/** `%` and `_` of a user-typed prefix are literals, not wildcards. */
function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function listConditions(input: ListActivityInput): SQL[] {
	const conditions: SQL[] = [];
	if (input.since)
		conditions.push(gte(activityLog.createdAt, new Date(input.since)));
	if (input.until)
		conditions.push(lt(activityLog.createdAt, new Date(input.until)));
	if (input.actorType)
		conditions.push(eq(activityLog.actorType, input.actorType));
	if (input.actorKeyId) {
		conditions.push(eq(activityLog.actorApiKeyId, input.actorKeyId));
	}
	if (input.actorUserId) {
		conditions.push(eq(activityLog.actorUserId, input.actorUserId));
	}
	if (input.objectId) conditions.push(eq(activityLog.objectId, input.objectId));
	if (input.objectType) {
		conditions.push(eq(activityLog.objectType, input.objectType));
	}
	if (input.action) {
		conditions.push(
			input.action.endsWith(".")
				? like(activityLog.action, `${escapeLike(input.action)}%`)
				: eq(activityLog.action, input.action),
		);
	}
	if (input.kind) conditions.push(eq(activityLog.kind, input.kind));
	if (input.sensitive !== undefined) {
		conditions.push(eq(activityLog.sensitive, input.sensitive));
	}
	return conditions;
}

/** Newest first; the filters combine with AND. */
export async function listActivity(
	db: Db,
	input: ListActivityInput,
): Promise<Paginated<ActivityEntry>> {
	const conditions = listConditions(input);
	const where = conditions.length > 0 ? and(...conditions) : undefined;
	const [totalRow] = await db
		.select({ value: count() })
		.from(activityLog)
		.where(where);
	const total = totalRow?.value ?? 0;
	const rows = await db
		.select()
		.from(activityLog)
		.where(where)
		.orderBy(desc(activityLog.createdAt), desc(activityLog.id))
		.limit(input.pageSize)
		.offset((input.page - 1) * input.pageSize);
	return {
		items: rows.map(toEntry),
		...paginationMeta(total, input.page, input.pageSize),
	};
}

/* ------------------------------------------------------------------ */
/* Reads (D15-02, D15-04)                                              */
/* ------------------------------------------------------------------ */

/** A browser session re-reading the same thing within this delay is one read. */
export const SESSION_READ_DEDUP_MS = 60_000;

const recentSessionReads = new Map<string, number>();

/**
 * A browser refetches on focus and on every re-render of a query: the same
 * read by the same session within a minute is logged once. Reads by an API key
 * are always logged (decision D-02 of the issue).
 */
function isRepeatedSessionRead(
	actor: Actor,
	action: string,
	objectId: string,
	now = Date.now(),
): boolean {
	if (actor.type !== "user") return false;
	const key = `${actor.userId}|${action}|${objectId}`;
	const last = recentSessionReads.get(key);
	if (last !== undefined && now - last < SESSION_READ_DEDUP_MS) return true;
	recentSessionReads.set(key, now);
	if (recentSessionReads.size > 5_000) {
		for (const [entry, at] of recentSessionReads) {
			if (now - at >= SESSION_READ_DEDUP_MS) recentSessionReads.delete(entry);
		}
	}
	return false;
}

/** Forgets the session reads seen so far (tests). */
export function resetSessionReadDedup(): void {
	recentSessionReads.clear();
}

export type DocumentReadAction =
	| "document.read"
	| "document.text_read"
	| "document.downloaded";

/**
 * Traces a read of a document: its detail, its OCR text or a file. Written in
 * the background; `sensitive` comes from the document so the Activity page
 * can list the sensitive reads by keys.
 */
export function logDocumentRead(
	db: Db,
	action: DocumentReadAction,
	document: { id: string; title: string; sensitive: boolean },
	summary: ActivitySummary = {},
	actor: Actor = currentActor(),
): void {
	if (actor.type === "system") return;
	if (isRepeatedSessionRead(actor, action, document.id)) return;
	logActivityRead(
		db,
		{
			action,
			objectType: "document",
			objectId: document.id,
			objectLabel: document.title,
			sensitive: document.sensitive,
			summary,
		},
		actor,
	);
}

/**
 * Traces a search by an API key: the query and the filters, never the
 * results. The searches of the web app are list rendering, not logged.
 */
export function logSearch(
	db: Db,
	filters: Record<string, unknown>,
	actor: Actor = currentActor(),
): void {
	if (actor.type !== "api_key") return;
	const summary: ActivitySummary = {};
	for (const [key, value] of Object.entries(filters)) {
		if (value !== undefined && value !== null) summary[key] = value;
	}
	logActivityRead(
		db,
		{
			action: "search.performed",
			objectType: "search",
			objectLabel: typeof filters.query === "string" ? filters.query : null,
			sensitive: filters.sensitive === true,
			summary,
		},
		actor,
	);
}

/** Traces a ZIP export: the selection, the count and the ids exported. */
export function logExport(
	db: Db,
	summary: ActivitySummary & { documentIds: string[] },
	sensitive: boolean,
	actor: Actor = currentActor(),
): void {
	if (actor.type === "system") return;
	logActivityRead(
		db,
		{
			action: "export.downloaded",
			objectType: "export",
			objectLabel: `${summary.documentIds.length} document(s)`,
			sensitive,
			summary,
		},
		actor,
	);
}

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

/**
 * Before/after of the fields that actually changed. Values are copied as
 * they are: callers only pass metadata fields, never content (D15-05).
 */
export function fieldChanges(
	before: Record<string, unknown>,
	after: Record<string, unknown>,
): Record<string, FieldChange> {
	const changes: Record<string, FieldChange> = {};
	for (const [field, value] of Object.entries(after)) {
		const previous = before[field] ?? null;
		const next = value ?? null;
		if (JSON.stringify(previous) !== JSON.stringify(next)) {
			changes[field] = { before: previous, after: next };
		}
	}
	return changes;
}

/** Longest string kept in a summary: a value, not a document. */
export const SUMMARY_STRING_LIMIT = 200;

/** Shortens long strings so a summary never carries a text body. */
export function summaryValue(value: unknown): unknown {
	if (typeof value === "string" && value.length > SUMMARY_STRING_LIMIT) {
		return `${value.slice(0, SUMMARY_STRING_LIMIT)}…`;
	}
	return value;
}

type Named = { id: string; name: string };

async function namesOf(
	ids: readonly string[],
	load: (ids: string[]) => Promise<Named[]>,
): Promise<Named[]> {
	const unique = [...new Set(ids)];
	if (unique.length === 0) return [];
	const rows = await load(unique);
	const byId = new Map(rows.map((row) => [row.id, row.name]));
	return unique.map((id) => ({ id, name: byId.get(id) ?? id }));
}

/** `{ id, name }` of tags, in the order given, for a summary. */
export function tagNames(db: Db, ids: readonly string[]): Promise<Named[]> {
	return namesOf(ids, (unique) =>
		db
			.select({ id: tag.id, name: tag.name })
			.from(tag)
			.where(inArray(tag.id, unique)),
	);
}

/** `{ id, name }` of parties, in the order given, for a summary. */
export function partyNames(db: Db, ids: readonly string[]): Promise<Named[]> {
	return namesOf(ids, (unique) =>
		db
			.select({ id: party.id, name: party.name })
			.from(party)
			.where(inArray(party.id, unique)),
	);
}

/** `{ id, name }` of a category, or `null`. */
export async function categoryName(
	db: Db,
	id: string | null,
): Promise<Named | null> {
	if (!id) return null;
	const [row] = await namesOf([id], (unique) =>
		db
			.select({ id: category.id, name: category.name })
			.from(category)
			.where(inArray(category.id, unique)),
	);
	return row ?? null;
}

/** `{ id, name }` of a custom field. */
export async function customFieldName(db: Db, id: string): Promise<Named> {
	const [row] = await namesOf([id], (unique) =>
		db
			.select({ id: customField.id, name: customField.name })
			.from(customField)
			.where(inArray(customField.id, unique)),
	);
	return row ?? { id, name: id };
}
