import { z } from "zod";
import { mayReadSensitive, type ScopedCaller } from "./api-key";

/**
 * Activity log (issue #15): who did what, whatever the surface.
 *
 * One row per change (a document tagged, a party merged, a key revoked) and
 * per read worth tracing (a document opened, its text read, a file
 * downloaded, an export, a search by an API key). Kept forever for now
 * (D15-01 in the issue).
 */

/** Who acted: a browser session, an API key, or docstore itself. */
export const ACTIVITY_ACTOR_TYPES = ["user", "api_key", "system"] as const;
export const activityActorTypeSchema = z.enum(ACTIVITY_ACTOR_TYPES);
export type ActivityActorType = z.infer<typeof activityActorTypeSchema>;

/** A change, or a read of something (D15-02). */
export const ACTIVITY_KINDS = ["change", "read"] as const;
export const activityKindSchema = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.infer<typeof activityKindSchema>;

/** What an entry is about. `search` and `export` have no object id. */
export const ACTIVITY_OBJECT_TYPES = [
	"document",
	"party",
	"tag",
	"category",
	"custom_field",
	"dossier",
	"document_type",
	"api_key",
	"webhook",
	"share_link",
	"search",
	"export",
] as const;
export const activityObjectTypeSchema = z.enum(ACTIVITY_OBJECT_TYPES);
export type ActivityObjectType = z.infer<typeof activityObjectTypeSchema>;

/**
 * Short, JSON description of the change: fields before and after, names of
 * the tags added… Never the content of a file, the OCR text or free-text
 * notes (D15-05).
 */
export const activitySummarySchema = z.record(z.string(), z.unknown());
export type ActivitySummary = z.infer<typeof activitySummarySchema>;

/** Before and after of one field, as stored in a summary. */
export type FieldChange = { before: unknown; after: unknown };

export const activityActorSchema = z.object({
	type: activityActorTypeSchema,
	/** The session user, or the owner of the key; `null` for `system`. */
	userId: z.string().nullable(),
	/** `null` for a browser session and for `system`. */
	apiKeyId: z.string().nullable(),
	/**
	 * Name of the key or of the user when the entry was written: it survives
	 * the deletion of the key.
	 */
	name: z.string().nullable(),
});
export type ActivityActor = z.infer<typeof activityActorSchema>;

export const activityEntrySchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	kind: activityKindSchema,
	/** `document.tagged`, `document.trashed`, `party.merged`, `document.read`… */
	action: z.string(),
	actor: activityActorSchema,
	objectType: activityObjectTypeSchema,
	objectId: z.string().nullable(),
	/** Title or name of the object when the entry was written. */
	objectLabel: z.string().nullable(),
	summary: activitySummarySchema,
	/** The entry touches a document flagged sensitive (D15-03). */
	sensitive: z.boolean(),
});
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

/** Actions whose summary carries a custom field value (`value`). */
const FIELD_VALUE_ACTIONS: ReadonlySet<string> = new Set([
	"document.field_set",
	"document.field_cleared",
]);

/**
 * The summary of a field change without its value: "Net pay changed", never
 * the amount (issue #22). Other summaries are returned as they are.
 */
export function withoutFieldValue(
	action: string,
	summary: ActivitySummary,
): ActivitySummary {
	if (!FIELD_VALUE_ACTIONS.has(action) || !("value" in summary)) {
		return summary;
	}
	return { ...summary, value: { changed: true } };
}

/**
 * An entry as a caller may read it. Entries written since issue #22 never
 * store the value of a field change on a sensitive document; this also hides
 * the values of older entries from an API key without the `sensitive` scope.
 */
export function maskSensitiveActivity(
	entry: ActivityEntry,
	caller: ScopedCaller,
): ActivityEntry {
	if (!entry.sensitive || mayReadSensitive(caller)) return entry;
	const summary = withoutFieldValue(entry.action, entry.summary);
	return summary === entry.summary ? entry : { ...entry, summary };
}

const isoInstant = z.iso.datetime({ offset: true });

export const listActivityInput = z.object({
	/** Entries written at or after this instant (ISO 8601). */
	since: isoInstant.optional(),
	/** Entries written strictly before this instant (ISO 8601). */
	until: isoInstant.optional(),
	actorType: activityActorTypeSchema.optional(),
	/** Entries of this API key. */
	actorKeyId: z.string().min(1).optional(),
	/** Entries of this user, whether by session or by one of their keys. */
	actorUserId: z.string().min(1).optional(),
	/** Entries about this object (a `doc_…`, a `pty_…`…). */
	objectId: z.string().min(1).optional(),
	objectType: activityObjectTypeSchema.optional(),
	/**
	 * Exact action (`document.tagged`), or a prefix ending with a dot
	 * (`document.` for every document action).
	 */
	action: z.string().trim().min(1).max(100).optional(),
	kind: activityKindSchema.optional(),
	sensitive: z.boolean().optional(),
	page: z.int().min(1).default(1),
	pageSize: z.int().min(1).max(100).default(50),
});
export type ListActivityInput = z.infer<typeof listActivityInput>;

/** Human label of an action for the UI (`document.tagged` → "tagged"). */
export function activityVerb(action: string): string {
	const verb = action.slice(action.indexOf(".") + 1);
	return verb.replaceAll("_", " ");
}

/* ------------------------------------------------------------------ */
/* Readable summaries (Activity page, document page)                   */
/* ------------------------------------------------------------------ */

type Named = { id?: string; name?: string; role?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value of a summary as a short string: names over ids, `none` for null. */
function show(value: unknown): string {
	if (value === null || value === undefined || value === "") return "none";
	if (Array.isArray(value)) return value.map(show).join(", ") || "none";
	if (isRecord(value)) {
		if (typeof value.name === "string") return value.name;
		// A custom field value: `{ kind: "money", amount: 12 }` reads `12`.
		const inner = Object.entries(value).filter(([key]) => key !== "kind");
		if (inner.length === 1) return show(inner[0]?.[1]);
		return inner.map(([key, item]) => `${key} ${show(item)}`).join(" ");
	}
	return String(value);
}

function isChange(
	value: unknown,
): value is { before?: unknown; after?: unknown } {
	return isRecord(value) && ("before" in value || "after" in value);
}

function describeChange(label: string, change: unknown): string {
	if (isRecord(change) && change.changed === true) return `${label} changed`;
	if (!isChange(change)) return `${label} ${show(change)}`;
	if (!("before" in change)) return `${label} → ${show(change.after)}`;
	return `${label}: ${show(change.before)} → ${show(change.after)}`;
}

function namedList(value: unknown): Named[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** Keys of a search summary that are paging or plumbing, not filters. */
const SEARCH_NOISE = new Set(["page", "sort", "deleted", "total", "query"]);

/**
 * One line describing an entry's summary: "+energy −home", "title: Scan →
 * Invoice", "\"électricité\" · year 2026 · 3 results"… Empty when there is
 * nothing to add to the action itself.
 */
export function describeActivitySummary(
	entry: Pick<ActivityEntry, "action" | "summary">,
): string {
	const summary = entry.summary;
	const parts: string[] = [];

	if (entry.action === "search.performed") {
		if (typeof summary.query === "string") parts.push(`"${summary.query}"`);
		for (const [key, value] of Object.entries(summary)) {
			if (SEARCH_NOISE.has(key)) continue;
			parts.push(`${key} ${show(value)}`);
		}
		if (typeof summary.total === "number") {
			parts.push(`${summary.total} result${summary.total === 1 ? "" : "s"}`);
		}
		return parts.join(" · ");
	}

	if (isRecord(summary.fields)) {
		for (const [field, change] of Object.entries(summary.fields)) {
			parts.push(describeChange(field, change));
		}
	}
	// `document.external_refs_set` (issue #4): "wiki · +path · −path · ~path".
	const refsSet = entry.action === "document.external_refs_set";
	if (refsSet && typeof summary.system === "string") {
		parts.push(summary.system);
	}
	const added = namedList(summary.added);
	const removed = namedList(summary.removed);
	for (const item of added) {
		parts.push(`+${item.name ?? item.id}${item.role ? ` (${item.role})` : ""}`);
	}
	for (const item of removed) {
		parts.push(`−${item.name ?? item.id}${item.role ? ` (${item.role})` : ""}`);
	}
	if (refsSet) {
		for (const item of namedList(summary.updated)) {
			parts.push(`~${item.name ?? item.id}`);
		}
	}
	if ("category" in summary)
		parts.push(describeChange("category", summary.category));
	if (isRecord(summary.field)) {
		parts.push(describeChange(show(summary.field), summary.value));
	}
	if (isRecord(summary.dossier)) parts.push(`dossier ${show(summary.dossier)}`);
	if (isRecord(summary.source) && typeof summary.source.name === "string") {
		parts.push(`from ${summary.source.name}`);
	}
	if (typeof summary.kind === "string" && "fromDocumentId" in summary) {
		parts.push(summary.kind.replaceAll("_", " "));
	}
	if (Array.isArray(summary.rules)) {
		parts.push(
			`rules ${namedList(summary.rules)
				.map((rule) => rule.name)
				.join(", ")}`,
		);
	}
	if (typeof summary.asn === "number") parts.push(`ASN ${summary.asn}`);
	if (typeof summary.filename === "string") parts.push(summary.filename);
	if (summary.masked === true) parts.push("masked");
	if (Array.isArray(summary.documentIds)) {
		const count = summary.documentIds.length;
		parts.push(`${count} document${count === 1 ? "" : "s"}`);
	}
	if (
		typeof summary.documents === "number" &&
		!Array.isArray(summary.documentIds)
	) {
		parts.push(
			`${summary.documents} document${summary.documents === 1 ? "" : "s"}`,
		);
	}
	if (typeof summary.via === "string") parts.push(`via ${summary.via}`);
	return parts.join(" · ");
}
