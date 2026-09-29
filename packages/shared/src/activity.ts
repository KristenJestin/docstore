import { z } from "zod";

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
