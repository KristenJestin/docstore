import type { Db } from "@docstore/db";
import { customField } from "@docstore/db/schema/custom-field";
import { document } from "@docstore/db/schema/document";
import { documentType } from "@docstore/db/schema/document-type";
import { reminder } from "@docstore/db/schema/reminder";
import { getContentLocale } from "@docstore/ingestion";
import { mayReadSensitive, type ScopedCaller } from "@docstore/shared/api-key";
import { UI_LOCALE } from "@docstore/shared/common";
import { addDays, periodKeyOf, todayIso } from "@docstore/shared/recurrence";
import type {
	GenerateRemindersResult,
	ListRemindersInput,
	ReminderCount,
	ReminderItem,
	SnoozeReminderInput,
} from "@docstore/shared/reminder";
import {
	REMINDER_COUNT_WINDOW_DAYS,
	reminderMessage,
} from "@docstore/shared/reminder";
import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, lte, ne, not, or, sql } from "drizzle-orm";
import {
	type DesiredReminder,
	desiredDocumentReminders,
	reconcileReminders,
} from "./document-reminders";
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
 *
 * A reminder stores facts, never a sentence. The wording is derived by
 * `reminderMessage` (`@docstore/shared/reminder`): English for what the user
 * reads in the application, the content language for what leaves it in a
 * webhook payload.
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

/**
 * Reminder that was created and is already due, as passed to `onDueCreated`.
 *
 * It leaves the application in a webhook payload, so its `message` is written
 * in the **content** language while the facts stay machine-readable.
 */
export interface DueReminder {
	kind: DesiredReminder["kind"];
	documentId: string | null;
	documentTitle: string | null;
	documentTypeId: string | null;
	documentTypeName: string | null;
	/** `field_date`: the date custom field, by id and name (issue #33). */
	fieldId: string | null;
	fieldName: string | null;
	period: string | null;
	dueDate: string;
	daysBefore: number | null;
	message: string;
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
				fieldId: null,
				period: entry.periodStart,
				dueDate: entry.dueDate,
				daysBefore: null,
				documentTitle: null,
				documentTypeName: row.name,
				fieldName: null,
				periodKey: entry.period,
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
 * - one `field_date` reminder per lead day of a `date` custom field marked
 *   "remind me" and per document holding a value for it (issue #33);
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
	const existing = await db.select().from(reminder);

	const desired = [
		...(await desiredDocumentReminders(db, today, existing)),
		...(await periodGapReminders(db, today)),
	];
	const { inserted, updated, removed } = await reconcileReminders(
		db,
		desired,
		existing,
		today,
	);

	// Reminders just created whose due date has already arrived: this is the only
	// moment where we know they are new, hence notifiable without duplicates.
	if (options.onDueCreated) {
		// The payload leaves the application: its wording follows the content
		// language, unlike everything the user reads inside it.
		const locale = await getContentLocale(db);
		const due: DueReminder[] = inserted
			.filter((item) => item.dueDate <= today)
			.map((item) => ({
				kind: item.kind,
				documentId: item.documentId,
				documentTitle: item.documentTitle,
				documentTypeId: item.documentTypeId,
				documentTypeName: item.documentTypeName,
				fieldId: item.fieldId,
				fieldName: item.fieldName,
				period: item.period,
				dueDate: item.dueDate,
				daysBefore: item.daysBefore,
				message: reminderMessage(item, locale),
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
 * Every column of a reminder plus the labels the wording needs: the title of
 * the document and the name of the document type, which live in their own
 * tables so a rename shows up straight away.
 */
const reminderColumns = {
	id: reminder.id,
	kind: reminder.kind,
	documentId: reminder.documentId,
	documentTypeId: reminder.documentTypeId,
	dueDate: reminder.dueDate,
	period: reminder.period,
	daysBefore: reminder.daysBefore,
	fieldId: reminder.fieldId,
	status: reminder.status,
	snoozedUntil: reminder.snoozedUntil,
	createdAt: reminder.createdAt,
	updatedAt: reminder.updatedAt,
	documentTitle: document.title,
	documentTypeName: documentType.name,
	fieldName: customField.name,
	typePeriodicity: documentType.periodicity,
};

/** Base query: the reminder and the labels its wording needs. */
function reminderQuery(db: Db) {
	return db
		.select(reminderColumns)
		.from(reminder)
		.leftJoin(document, eq(document.id, reminder.documentId))
		.leftJoin(documentType, eq(documentType.id, reminder.documentTypeId))
		.leftJoin(customField, eq(customField.id, reminder.fieldId));
}

/**
 * What a caller without the `sensitive` scope may not see (D33-05): a date
 * field reminder on a sensitive document. Its due date plus its lead time is
 * the field value, which `maskSensitiveDocument` withholds (issue #22), so
 * the reminder is withheld as a whole, the way a field-value filter never
 * matches a sensitive document. Expiry reminders stay: `validUntil` is
 * metadata, visible on the document itself.
 */
function visibleTo(caller: ScopedCaller): SQL | undefined {
	if (mayReadSensitive(caller)) return undefined;
	return or(
		ne(reminder.kind, "field_date"),
		not(sql`coalesce(${document.sensitive}, false)`),
	);
}

type ReminderRow = Awaited<ReturnType<typeof reminderQuery>>[number];

/**
 * Turns a joined row into the object the API hands out: the readable period
 * key, then the sentence derived from the facts.
 *
 * The message is English — it is read inside the application, whose language
 * never changes. What leaves the application (the `reminder.due` payload) is
 * phrased with the content language instead.
 */
function toReminderItem({
	typePeriodicity,
	...row
}: ReminderRow): ReminderItem {
	const periodKey =
		row.period && typePeriodicity
			? periodKeyOf(typePeriodicity, row.period)
			: null;
	const fieldDate =
		row.kind === "field_date"
			? addDays(row.dueDate, row.daysBefore ?? 0)
			: null;
	return {
		...row,
		periodKey,
		fieldDate,
		message: reminderMessage({ ...row, periodKey }, UI_LOCALE),
	};
}

export async function listReminders(
	db: Db,
	input: ListRemindersInput,
	caller?: ScopedCaller,
): Promise<ReminderItem[]> {
	const conditions: SQL[] = [];
	const visible = visibleTo(caller);
	if (visible) conditions.push(visible);
	if (input.status) conditions.push(eq(reminder.status, input.status));
	if (input.kind) conditions.push(eq(reminder.kind, input.kind));
	if (input.dueBefore) conditions.push(lte(reminder.dueDate, input.dueBefore));
	// `upcoming: false` restricts the list to what is already due (past or
	// today): the default keeps every pending reminder, future ones included.
	if (!input.upcoming) conditions.push(lte(reminder.dueDate, todayIso()));

	const rows = await reminderQuery(db)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(asc(reminder.dueDate), asc(reminder.id))
		.limit(input.limit);

	return rows.map(toReminderItem);
}

/** `pending` reminders whose due date falls within the next 30 days. */
export async function countReminders(
	db: Db,
	caller?: ScopedCaller,
): Promise<ReminderCount> {
	const horizon = addDays(todayIso(), REMINDER_COUNT_WINDOW_DAYS);
	const rows = await db
		.select({ value: sql<number>`count(*)::int` })
		.from(reminder)
		.leftJoin(document, eq(document.id, reminder.documentId))
		.where(
			and(
				eq(reminder.status, "pending"),
				lte(reminder.dueDate, horizon),
				visibleTo(caller),
			),
		);
	return { count: rows[0]?.value ?? 0 };
}

/**
 * Applies a status change then reads the row back through the joins: the
 * caller gets the same object `listReminders` hands out, message included.
 */
async function setReminderStatus(
	db: Db,
	id: string,
	patch: Partial<typeof reminder.$inferInsert>,
	caller?: ScopedCaller,
): Promise<ReminderItem> {
	// A reminder the caller may not list is not found either (D33-05).
	const visible = visibleTo(caller);
	if (visible) {
		const [row] = await reminderQuery(db)
			.where(and(eq(reminder.id, id), visible))
			.limit(1);
		if (!row) {
			throw new ORPCError("NOT_FOUND", {
				message: `Reminder "${id}" not found.`,
			});
		}
	}
	const updated = await db
		.update(reminder)
		.set(patch)
		.where(eq(reminder.id, id))
		.returning({ id: reminder.id });
	if (!updated[0]) {
		throw new ORPCError("NOT_FOUND", {
			message: `Reminder "${id}" not found.`,
		});
	}

	const rows = await reminderQuery(db).where(eq(reminder.id, id)).limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Reminder "${id}" not found.`,
		});
	}
	return toReminderItem(row);
}

export function snoozeReminder(
	db: Db,
	input: SnoozeReminderInput,
	caller?: ScopedCaller,
): Promise<ReminderItem> {
	return setReminderStatus(
		db,
		input.id,
		{ status: "snoozed", snoozedUntil: input.until },
		caller,
	);
}

export function dismissReminder(
	db: Db,
	id: string,
	caller?: ScopedCaller,
): Promise<ReminderItem> {
	return setReminderStatus(
		db,
		id,
		{ status: "dismissed", snoozedUntil: null },
		caller,
	);
}

export function completeReminder(
	db: Db,
	id: string,
	caller?: ScopedCaller,
): Promise<ReminderItem> {
	return setReminderStatus(
		db,
		id,
		{ status: "done", snoozedUntil: null },
		caller,
	);
}
