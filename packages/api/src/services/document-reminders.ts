import type { Db } from "@docstore/db";
import {
	customField,
	documentFieldValue,
} from "@docstore/db/schema/custom-field";
import { document } from "@docstore/db/schema/document";
import type { Reminder } from "@docstore/db/schema/reminder";
import { reminder } from "@docstore/db/schema/reminder";
import { getExpiryLeadDays } from "@docstore/ingestion";
import { addDays, todayIso } from "@docstore/shared/recurrence";
import type { ReminderKind } from "@docstore/shared/reminder";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

/**
 * Reminders that belong to one document (issue #33): its expiry
 * (`valid_until`) and its date custom fields marked "remind me".
 *
 * Kept apart from `reminder.service` so that the document event batch
 * (`document-events.ts`) can refresh them after every document change without
 * an import cycle: every service that changes a document (field set or
 * cleared, trash, restore, merge, review, type applied) already records it in
 * the batch, so none of them has to remember the reminders.
 */

/** Kinds tied to a document rather than to a document type. */
export const DOCUMENT_REMINDER_KINDS = [
	"expiry",
	"field_date",
] as const satisfies readonly ReminderKind[];

export type DesiredReminder = {
	kind: ReminderKind;
	documentId: string | null;
	documentTypeId: string | null;
	fieldId: string | null;
	period: string | null;
	dueDate: string;
	daysBefore: number | null;
	/** Only for the payload wording: never written to the row. */
	documentTitle: string | null;
	documentTypeName: string | null;
	fieldName: string | null;
	periodKey: string | null;
};

/** Columns of `reminder`, without the labels carried alongside for wording. */
function reminderRow(item: DesiredReminder) {
	const {
		documentTitle: _title,
		documentTypeName: _type,
		fieldName: _field,
		periodKey: _key,
		...row
	} = item;
	return row;
}

/** Identity key, aligned with the unique index `reminder_identity_uidx`. */
export function identityKey(item: {
	kind: string;
	documentId: string | null;
	documentTypeId: string | null;
	fieldId: string | null;
	period: string | null;
	dueDate: string;
}): string {
	return [
		item.kind,
		item.documentId ?? "",
		item.documentTypeId ?? "",
		item.fieldId ?? "",
		item.period ?? "",
		item.dueDate,
	].join("|");
}

/**
 * Lead days kept for one date field value (D33-03).
 *
 * A lead whose due date has already passed when the value is first seen is
 * skipped: a warranty ending in 60 days gets its D-30 and D-7, not a D-90
 * already one month late. A reminder that exists keeps its place once its due
 * date passes (it is the same value, the user may not have handled it yet).
 * A date still ahead whose every lead is already past gets the shortest one,
 * due at once, so a near deadline is never silent.
 */
export function fieldDateLeadDays(
	date: string,
	leadDays: readonly number[],
	today: string,
	exists: (dueDate: string) => boolean,
): number[] {
	const kept = leadDays.filter((lead) => {
		const due = addDays(date, -lead);
		return due >= today || exists(due);
	});
	if (kept.length > 0 || date < today || leadDays.length === 0) return kept;
	return [Math.min(...leadDays)];
}

/** Expiry reminders: one per lead day and per live document with `valid_until`. */
async function expiryReminders(
	db: Db,
	leadDays: number[],
	documentIds?: readonly string[],
): Promise<DesiredReminder[]> {
	const scope = [isNull(document.deletedAt), isNotNull(document.validUntil)];
	if (documentIds) scope.push(inArray(document.id, [...documentIds]));

	const rows = await db
		.select({
			id: document.id,
			title: document.title,
			validUntil: document.validUntil,
		})
		.from(document)
		.where(and(...scope));

	const desired: DesiredReminder[] = [];
	for (const row of rows) {
		if (!row.validUntil) continue;
		for (const lead of leadDays) {
			desired.push({
				kind: "expiry",
				documentId: row.id,
				documentTypeId: null,
				fieldId: null,
				period: null,
				dueDate: addDays(row.validUntil, -lead),
				daysBefore: lead,
				documentTitle: row.title,
				documentTypeName: null,
				fieldName: null,
				periodKey: null,
			});
		}
	}
	return desired;
}

/**
 * Date field reminders: one per kept lead day (`fieldDateLeadDays`) and per
 * value of a `date` field marked "remind me", on a live document.
 */
async function fieldDateReminders(
	db: Db,
	defaultLeadDays: number[],
	today: string,
	existing: readonly Reminder[],
	documentIds?: readonly string[],
): Promise<DesiredReminder[]> {
	const scope = [
		isNull(document.deletedAt),
		eq(customField.type, "date"),
		sql`(${customField.options} ->> 'remind')::boolean is true`,
	];
	if (documentIds) scope.push(inArray(document.id, [...documentIds]));

	const rows = await db
		.select({
			documentId: document.id,
			title: document.title,
			fieldId: customField.id,
			fieldName: customField.name,
			options: customField.options,
			value: documentFieldValue.value,
		})
		.from(documentFieldValue)
		.innerJoin(document, eq(document.id, documentFieldValue.documentId))
		.innerJoin(customField, eq(customField.id, documentFieldValue.fieldId))
		.where(and(...scope));

	const existingKeys = new Set(existing.map(identityKey));
	const desired: DesiredReminder[] = [];
	for (const row of rows) {
		if (row.value.kind !== "date") continue;
		const date = row.value.date;
		const base = {
			kind: "field_date" as const,
			documentId: row.documentId,
			documentTypeId: null,
			fieldId: row.fieldId,
			period: null,
		};
		const leads = fieldDateLeadDays(
			date,
			row.options.reminderLeadDays ?? defaultLeadDays,
			today,
			(dueDate) => existingKeys.has(identityKey({ ...base, dueDate })),
		);
		for (const lead of leads) {
			desired.push({
				...base,
				dueDate: addDays(date, -lead),
				daysBefore: lead,
				documentTitle: row.title,
				documentTypeName: null,
				fieldName: row.fieldName,
				periodKey: null,
			});
		}
	}
	return desired;
}

/**
 * Every reminder that `documentIds` (all documents when omitted) should
 * carry today. `existing` is what is already stored for them: a date field
 * reminder already created survives the passing of its due date.
 */
export async function desiredDocumentReminders(
	db: Db,
	today: string,
	existing: readonly Reminder[],
	documentIds?: readonly string[],
): Promise<DesiredReminder[]> {
	const leadDays = await getExpiryLeadDays(db);
	return [
		...(await expiryReminders(db, leadDays, documentIds)),
		...(await fieldDateReminders(db, leadDays, today, existing, documentIds)),
	];
}

/**
 * Reconciles a set of desired reminders against what currently exists for the
 * same identity keys: obsolete ones are removed, missing ones inserted, and an
 * existing one whose lead time changed (or whose expired snooze wakes it back
 * up) is updated. A reminder already `done` or `dismissed` is left alone unless
 * it becomes obsolete.
 */
export async function reconcileReminders(
	db: Db,
	desired: DesiredReminder[],
	existing: readonly Reminder[],
	today: string,
): Promise<{ inserted: DesiredReminder[]; updated: number; removed: number }> {
	const desiredByKey = new Map<string, DesiredReminder>();
	for (const item of desired) {
		desiredByKey.set(identityKey(item), item);
	}
	const existingByKey = new Map<string, Reminder>();
	for (const row of existing) {
		existingByKey.set(identityKey(row), row);
	}

	const obsolete = existing
		.filter((row) => !desiredByKey.has(identityKey(row)))
		.map((row) => row.id);
	const toInsert: DesiredReminder[] = [];
	const toUpdate: { id: string; daysBefore: number | null; wake: boolean }[] =
		[];

	for (const [key, item] of desiredByKey) {
		const current = existingByKey.get(key);
		if (!current) {
			toInsert.push(item);
			continue;
		}
		const wake =
			current.status === "snoozed" &&
			(current.snoozedUntil === null || current.snoozedUntil <= today);
		if (current.daysBefore !== item.daysBefore || wake) {
			toUpdate.push({ id: current.id, daysBefore: item.daysBefore, wake });
		}
	}

	if (obsolete.length === 0 && toInsert.length === 0 && toUpdate.length === 0) {
		return { inserted: [], updated: 0, removed: 0 };
	}

	await db.transaction(async (tx) => {
		if (obsolete.length > 0) {
			await tx.delete(reminder).where(inArray(reminder.id, obsolete));
		}
		if (toInsert.length > 0) {
			await tx
				.insert(reminder)
				.values(toInsert.map(reminderRow))
				.onConflictDoNothing();
		}
		for (const item of toUpdate) {
			await tx
				.update(reminder)
				.set(
					item.wake
						? {
								daysBefore: item.daysBefore,
								status: "pending",
								snoozedUntil: null,
							}
						: { daysBefore: item.daysBefore },
				)
				.where(eq(reminder.id, item.id));
		}
	});

	return {
		inserted: toInsert,
		updated: toUpdate.length,
		removed: obsolete.length,
	};
}

/**
 * Recomputes the expiry and date field reminders of some documents, right
 * after they changed, instead of waiting for the next `reminder.generate` run.
 * A trashed document ends up with none (D33-04); a restored one gets them
 * back. `period_gap` reminders (tied to a document type) are left alone.
 */
export async function refreshDocumentReminders(
	db: Db,
	documentIds: readonly string[],
	options: { today?: string } = {},
): Promise<void> {
	if (documentIds.length === 0) return;
	const today = options.today ?? todayIso();
	const ids = [...new Set(documentIds)];
	const existing = await db
		.select()
		.from(reminder)
		.where(
			and(
				inArray(reminder.kind, [...DOCUMENT_REMINDER_KINDS]),
				inArray(reminder.documentId, ids),
			),
		);
	const desired = await desiredDocumentReminders(db, today, existing, ids);
	await reconcileReminders(db, desired, existing, today);
}

/**
 * Recomputes the reminders of every document holding a value for `fieldId`:
 * called when the field is switched to "remind me" or back, or its lead days
 * change.
 */
export async function refreshFieldReminders(
	db: Db,
	fieldId: string,
): Promise<void> {
	const holders = await db
		.select({ documentId: documentFieldValue.documentId })
		.from(documentFieldValue)
		.where(eq(documentFieldValue.fieldId, fieldId));
	await refreshDocumentReminders(
		db,
		holders.map((row) => row.documentId),
	);
}
