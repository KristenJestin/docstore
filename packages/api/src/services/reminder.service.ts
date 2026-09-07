import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import { documentType } from "@docstore/db/schema/document-type";
import type { Reminder } from "@docstore/db/schema/reminder";
import { reminder } from "@docstore/db/schema/reminder";
import { getExpiryLeadDays } from "@docstore/ingestion";
import { formatDateEnGb } from "@docstore/shared/common";
import { addDays, periodKeyOf, todayIso } from "@docstore/shared/recurrence";
import type {
	GenerateRemindersResult,
	ListRemindersInput,
	ReminderCount,
	ReminderDto,
	ReminderItem,
	SnoozeReminderInput,
} from "@docstore/shared/reminder";
import { REMINDER_COUNT_WINDOW_DAYS } from "@docstore/shared/reminder";
import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import {
	and,
	asc,
	eq,
	inArray,
	isNotNull,
	isNull,
	lte,
	sql,
} from "drizzle-orm";
import {
	documentTypeTimeline,
	enabledRecurringTypes,
} from "./document-type.service";

/**
 * Reminders (SPEC §2 "Misc").
 *
 * `generateReminders` is the single source of truth: it recomputes the expected
 * state then reconciles it with the database. User decisions (`done`,
 * `dismissed`) survive the recomputation; reminders that no longer apply are
 * removed.
 */

export interface GenerateRemindersOptions {
	/** Reference date (`YYYY-MM-DD`), injected by tests. */
	today?: string;
	/**
	 * Called with the created reminders whose due date has already been reached:
	 * the server uses it to emit the `reminder.due` event (SPEC §2).
	 * An error here does not cancel the generation.
	 */
	onDueCreated?: (reminders: DueReminder[]) => Promise<void>;
}

/** Reminder that was created and is already due, as passed to `onDueCreated`. */
export interface DueReminder {
	kind: "expiry" | "period_gap";
	documentId: string | null;
	documentTypeId: string | null;
	dueDate: string;
	message: string;
}

type DesiredReminder = {
	kind: "expiry" | "period_gap";
	documentId: string | null;
	documentTypeId: string | null;
	period: string | null;
	dueDate: string;
	message: string;
};

/** Identity key, aligned with the unique index `reminder_identity_uidx`. */
function identityKey(item: {
	kind: string;
	documentId: string | null;
	documentTypeId: string | null;
	period: string | null;
	dueDate: string;
}): string {
	return [
		item.kind,
		item.documentId ?? "",
		item.documentTypeId ?? "",
		item.period ?? "",
		item.dueDate,
	].join("|");
}

async function expiryReminders(
	db: Db,
	leadDays: number[],
	documentId?: string,
): Promise<DesiredReminder[]> {
	const scope = [isNull(document.deletedAt), isNotNull(document.validUntil)];
	if (documentId) scope.push(eq(document.id, documentId));

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
				period: null,
				dueDate: addDays(row.validUntil, -lead),
				message:
					lead === 0
						? `"${row.title}" expires on ${formatDateEnGb(row.validUntil)}.`
						: `"${row.title}" expires on ${formatDateEnGb(row.validUntil)} (reminder at D-${lead}).`,
			});
		}
	}
	return desired;
}

async function periodGapReminders(
	db: Db,
	today: string,
): Promise<DesiredReminder[]> {
	const rows = await enabledRecurringTypes(db);
	const desired: DesiredReminder[] = [];
	for (const row of rows) {
		const timeline = await documentTypeTimeline(db, row, today);
		for (const entry of timeline) {
			if (entry.status !== "missing") continue;
			desired.push({
				kind: "period_gap",
				documentId: null,
				documentTypeId: row.id,
				period: entry.periodStart,
				dueDate: entry.dueDate,
				message: `Document type "${row.name}": no document for the period ${entry.period}.`,
			});
		}
	}
	return desired;
}

/**
 * Recomputes the whole set of reminders.
 *
 * - one `expiry` reminder per value of `reminders.expiryLeadDays` and per
 *   document whose `valid_until` is set (outside the trash);
 * - one `period_gap` reminder per missing period of an enabled recurring type,
 *   as the expected date + `graceDays` has passed;
 * - `snoozed` reminders whose snooze has expired go back to `pending`;
 * - reminders that no longer apply are deleted, `done` and `dismissed`
 *   included;
 * - a reminder that was already handled is never resurrected.
 */
export async function generateReminders(
	db: Db,
	options: GenerateRemindersOptions = {},
): Promise<GenerateRemindersResult> {
	const today = options.today ?? todayIso();
	const leadDays = await getExpiryLeadDays(db);

	const desired = [
		...(await expiryReminders(db, leadDays)),
		...(await periodGapReminders(db, today)),
	];
	const existing = await db.select().from(reminder);
	const { inserted, updated, removed } = await reconcileReminders(
		db,
		desired,
		existing,
		today,
	);

	// Reminders just created whose due date has already arrived: this is the only
	// moment where we know they are new, hence notifiable without duplicates.
	if (options.onDueCreated) {
		const due = inserted
			.filter((item) => item.dueDate <= today)
			.map(({ kind, documentId, documentTypeId, dueDate, message }) => ({
				kind,
				documentId,
				documentTypeId,
				dueDate,
				message,
			}));
		if (due.length > 0) {
			try {
				await options.onDueCreated(due);
			} catch (error) {
				console.error('[reminders] "reminder.due" notification failed', error);
			}
		}
	}

	const totalRows = await db
		.select({ value: sql<number>`count(*)::int` })
		.from(reminder);

	return {
		created: inserted.length,
		updated,
		removed,
		total: totalRows[0]?.value ?? 0,
	};
}

/**
 * Reconciles a set of desired reminders against what currently exists for the
 * same identity keys: obsolete ones are removed, missing ones inserted, and an
 * existing one whose message changed (or whose expired snooze wakes it back up)
 * is updated. A reminder already `done` or `dismissed` is left alone unless it
 * becomes obsolete.
 */
async function reconcileReminders(
	db: Db,
	desired: DesiredReminder[],
	existing: Reminder[],
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
	const toUpdate: { id: string; message: string; wake: boolean }[] = [];

	for (const [key, item] of desiredByKey) {
		const current = existingByKey.get(key);
		if (!current) {
			toInsert.push(item);
			continue;
		}
		const wake =
			current.status === "snoozed" &&
			(current.snoozedUntil === null || current.snoozedUntil <= today);
		if (current.message !== item.message || wake) {
			toUpdate.push({ id: current.id, message: item.message, wake });
		}
	}

	await db.transaction(async (tx) => {
		if (obsolete.length > 0) {
			await tx.delete(reminder).where(inArray(reminder.id, obsolete));
		}
		if (toInsert.length > 0) {
			await tx.insert(reminder).values(toInsert).onConflictDoNothing();
		}
		for (const item of toUpdate) {
			await tx
				.update(reminder)
				.set(
					item.wake
						? { message: item.message, status: "pending", snoozedUntil: null }
						: { message: item.message },
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
 * Regenerates the `expiry` reminders of a single document.
 *
 * Called right after `validUntil` is set, changed or cleared (`document.update`,
 * bulk `setDocumentType`, `documentType.apply`) so the reminders reflect it
 * synchronously instead of waiting for the next `reminder.generate` run. Scoped
 * to this document's own `expiry` reminders: `period_gap` reminders (tied to a
 * document type, not a document) are untouched.
 */
export async function generateRemindersForDocument(
	db: Db,
	documentId: string,
	options: { today?: string } = {},
): Promise<void> {
	const today = options.today ?? todayIso();
	const leadDays = await getExpiryLeadDays(db);
	const desired = await expiryReminders(db, leadDays, documentId);
	const existing = await db
		.select()
		.from(reminder)
		.where(
			and(eq(reminder.kind, "expiry"), eq(reminder.documentId, documentId)),
		);
	await reconcileReminders(db, desired, existing, today);
}

export async function listReminders(
	db: Db,
	input: ListRemindersInput,
): Promise<ReminderItem[]> {
	const conditions: SQL[] = [];
	if (input.status) conditions.push(eq(reminder.status, input.status));
	if (input.kind) conditions.push(eq(reminder.kind, input.kind));
	if (input.dueBefore) conditions.push(lte(reminder.dueDate, input.dueBefore));
	// `upcoming: false` restricts the list to what is already due (past or
	// today): the default keeps every pending reminder, future ones included.
	if (!input.upcoming) conditions.push(lte(reminder.dueDate, todayIso()));

	const rows = await db
		.select({
			id: reminder.id,
			kind: reminder.kind,
			documentId: reminder.documentId,
			documentTypeId: reminder.documentTypeId,
			dueDate: reminder.dueDate,
			period: reminder.period,
			status: reminder.status,
			snoozedUntil: reminder.snoozedUntil,
			message: reminder.message,
			createdAt: reminder.createdAt,
			updatedAt: reminder.updatedAt,
			documentTitle: document.title,
			documentTypeName: documentType.name,
			typePeriodicity: documentType.periodicity,
		})
		.from(reminder)
		.leftJoin(document, eq(document.id, reminder.documentId))
		.leftJoin(documentType, eq(documentType.id, reminder.documentTypeId))
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(asc(reminder.dueDate), asc(reminder.id))
		.limit(input.limit);

	return rows.map(({ typePeriodicity, ...row }) => ({
		...row,
		periodKey:
			row.period && typePeriodicity
				? periodKeyOf(typePeriodicity, row.period)
				: null,
	}));
}

/** `pending` reminders whose due date falls within the next 30 days. */
export async function countReminders(db: Db): Promise<ReminderCount> {
	const horizon = addDays(todayIso(), REMINDER_COUNT_WINDOW_DAYS);
	const rows = await db
		.select({ value: sql<number>`count(*)::int` })
		.from(reminder)
		.where(and(eq(reminder.status, "pending"), lte(reminder.dueDate, horizon)));
	return { count: rows[0]?.value ?? 0 };
}

async function setReminderStatus(
	db: Db,
	id: string,
	patch: Partial<typeof reminder.$inferInsert>,
): Promise<ReminderDto> {
	const rows = await db
		.update(reminder)
		.set(patch)
		.where(eq(reminder.id, id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Reminder "${id}" not found.`,
		});
	}
	return row;
}

export function snoozeReminder(
	db: Db,
	input: SnoozeReminderInput,
): Promise<ReminderDto> {
	return setReminderStatus(db, input.id, {
		status: "snoozed",
		snoozedUntil: input.until,
	});
}

export function dismissReminder(db: Db, id: string): Promise<ReminderDto> {
	return setReminderStatus(db, id, { status: "dismissed", snoozedUntil: null });
}

export function completeReminder(db: Db, id: string): Promise<ReminderDto> {
	return setReminderStatus(db, id, { status: "done", snoozedUntil: null });
}
