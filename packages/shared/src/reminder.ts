import { z } from "zod";
import { dateOnlySchema } from "./common";

/**
 * Reminders (SPEC §2 "Misc"): generated from `valid_until` and from the
 * recurring document types.
 *
 * They are never entered by hand: `reminder.generate` recomputes all of them,
 * while preserving the decisions of the user (`done`, `dismissed`,
 * `snoozed`).
 */

export const REMINDER_KINDS = [
	"expiry",
	"period_gap",
	"review_pending",
] as const;
export const reminderKindSchema = z.enum(REMINDER_KINDS);
export type ReminderKind = z.infer<typeof reminderKindSchema>;

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
	expiry: "expiry",
	period_gap: "missing document",
	review_pending: "review pending",
};

export const REMINDER_STATUSES = [
	"pending",
	"done",
	"snoozed",
	"dismissed",
] as const;
export const reminderStatusSchema = z.enum(REMINDER_STATUSES);
export type ReminderStatus = z.infer<typeof reminderStatusSchema>;

/** Default lead days for expiry reminders. */
export const DEFAULT_EXPIRY_LEAD_DAYS = [90, 30, 7] as const;

/** Window of `reminder.count`: reminders due within 30 days. */
export const REMINDER_COUNT_WINDOW_DAYS = 30;

const dateOnly = dateOnlySchema;

export const reminderSchema = z.object({
	id: z.string(),
	kind: reminderKindSchema,
	documentId: z.string().nullable(),
	documentTypeId: z.string().nullable(),
	dueDate: z.string(),
	/** First day of the period concerned (`period_gap` only). */
	period: z.string().nullable(),
	status: reminderStatusSchema,
	snoozedUntil: z.string().nullable(),
	message: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type ReminderDto = z.infer<typeof reminderSchema>;

export const reminderItemSchema = reminderSchema.extend({
	documentTitle: z.string().nullable(),
	documentTypeName: z.string().nullable(),
	/** Readable key of the period (`2026-W09`, `2026-03`, `2026-Q1`, `2026`). */
	periodKey: z.string().nullable(),
});
export type ReminderItem = z.infer<typeof reminderItemSchema>;

export const listRemindersInput = z.object({
	status: reminderStatusSchema.optional(),
	kind: reminderKindSchema.optional(),
	/**
	 * `false` restricts the list to reminders already due (past or today).
	 * Defaults to `true`: every matching reminder is returned, future ones
	 * included.
	 */
	upcoming: z.boolean().default(true),
	/** Inclusive upper bound on `dueDate`. */
	dueBefore: dateOnly.optional(),
	limit: z.int().min(1).max(500).default(100),
});
export type ListRemindersInput = z.infer<typeof listRemindersInput>;

export const reminderCountSchema = z.object({
	/** `pending` reminders whose due date falls within 30 days. */
	count: z.int().min(0),
});
export type ReminderCount = z.infer<typeof reminderCountSchema>;

export const snoozeReminderInput = z.object({
	id: z.string().min(1),
	until: dateOnly,
});
export type SnoozeReminderInput = z.infer<typeof snoozeReminderInput>;

export const reminderIdInput = z.object({ id: z.string().min(1) });
export type ReminderIdInput = z.infer<typeof reminderIdInput>;

export const generateRemindersResultSchema = z.object({
	created: z.int().min(0),
	updated: z.int().min(0),
	removed: z.int().min(0),
	/** Total number of reminders after the recomputation. */
	total: z.int().min(0),
});
export type GenerateRemindersResult = z.infer<
	typeof generateRemindersResultSchema
>;
