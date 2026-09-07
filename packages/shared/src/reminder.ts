import { z } from "zod";
import type { ContentLocale } from "./common";
import { dateOnlySchema, formatContentDate } from "./common";
import { addDays } from "./recurrence";

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

/**
 * A reminder is a set of **facts**, never a sentence: the wording is derived
 * from them by `reminderMessage`, in whichever language the reader needs.
 */
export const reminderSchema = z.object({
	id: z.string(),
	kind: reminderKindSchema,
	documentId: z.string().nullable(),
	documentTitle: z.string().nullable(),
	documentTypeId: z.string().nullable(),
	documentTypeName: z.string().nullable(),
	dueDate: z.string(),
	/** First day of the period concerned (`period_gap` only). */
	period: z.string().nullable(),
	/**
	 * Days of notice this `expiry` reminder stands for (90, 30, 7…): the
	 * document expires on `dueDate` + `daysBefore`. `null` on the other kinds.
	 */
	daysBefore: z.int().nullable(),
	status: reminderStatusSchema,
	snoozedUntil: z.string().nullable(),
	/**
	 * Derived, never stored: `reminderMessage` phrased in English, the language
	 * of the API and of the interface.
	 */
	message: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type ReminderDto = z.infer<typeof reminderSchema>;

export const reminderItemSchema = reminderSchema.extend({
	/** Readable key of the period (`2026-W09`, `2026-03`, `2026-Q1`, `2026`). */
	periodKey: z.string().nullable(),
});
export type ReminderItem = z.infer<typeof reminderItemSchema>;

/* ------------------------------------------------------------------ */
/* Wording                                                              */
/* ------------------------------------------------------------------ */

/** The facts `reminderMessage` needs; every reminder shape satisfies it. */
export interface ReminderMessageContext {
	kind: ReminderKind;
	dueDate: string;
	documentTitle?: string | null;
	documentTypeName?: string | null;
	/** Readable period key (`2026-03`); falls back to `period`. */
	periodKey?: string | null;
	period?: string | null;
	daysBefore?: number | null;
}

interface ReminderPhrases {
	expiry: (title: string, expiresOn: string) => string;
	expiryAhead: (title: string, expiresOn: string, daysBefore: number) => string;
	periodGap: (typeName: string, period: string) => string;
	reviewPending: () => string;
	untitledDocument: string;
	unnamedType: string;
	unknownPeriod: string;
}

/**
 * One dictionary per content language. Adding a language means adding an entry
 * here and a choice to `CONTENT_LOCALES`; nothing else composes reminder text.
 */
const REMINDER_PHRASES: Record<ContentLocale, ReminderPhrases> = {
	"en-GB": {
		expiry: (title, expiresOn) => `"${title}" expires on ${expiresOn}.`,
		expiryAhead: (title, expiresOn, daysBefore) =>
			`"${title}" expires on ${expiresOn} (reminder at D-${daysBefore}).`,
		periodGap: (typeName, period) =>
			`Document type "${typeName}": no document for the period ${period}.`,
		reviewPending: () => "A document is waiting for review.",
		untitledDocument: "Untitled document",
		unnamedType: "Unnamed type",
		unknownPeriod: "unknown period",
	},
	"fr-FR": {
		expiry: (title, expiresOn) => `« ${title} » expire le ${expiresOn}.`,
		expiryAhead: (title, expiresOn, daysBefore) =>
			`« ${title} » expire le ${expiresOn} (rappel à J-${daysBefore}).`,
		periodGap: (typeName, period) =>
			`Type de document « ${typeName} » : aucun document pour la période ${period}.`,
		reviewPending: () => "Un document attend d'être vérifié.",
		untitledDocument: "Document sans titre",
		unnamedType: "Type sans nom",
		unknownPeriod: "période inconnue",
	},
};

/**
 * Sentence describing a reminder, in the requested language.
 *
 * Pure: the same facts always give the same string. This is the **only** place
 * reminder wording exists — the API, the MCP tools and the front all call it,
 * which is why `message` is never stored.
 *
 * @example reminderMessage({ kind: "expiry", dueDate: "2027-06-23", documentTitle: "Passport", daysBefore: 7 }, "en-GB")
 * // '"Passport" expires on 30 Jun 2027 (reminder at D-7).'
 */
export function reminderMessage(
	reminder: ReminderMessageContext,
	locale: ContentLocale,
): string {
	const phrases = REMINDER_PHRASES[locale];
	switch (reminder.kind) {
		case "expiry": {
			const title = reminder.documentTitle ?? phrases.untitledDocument;
			const daysBefore = reminder.daysBefore ?? 0;
			// The expiry date is not stored twice: it is the due date pushed back
			// by the lead time this reminder stands for.
			const expiresOn = formatContentDate(
				addDays(reminder.dueDate, daysBefore),
				locale,
			);
			return daysBefore > 0
				? phrases.expiryAhead(title, expiresOn, daysBefore)
				: phrases.expiry(title, expiresOn);
		}
		case "period_gap": {
			const typeName = reminder.documentTypeName ?? phrases.unnamedType;
			const period =
				reminder.periodKey ?? reminder.period ?? phrases.unknownPeriod;
			return phrases.periodGap(typeName, period);
		}
		default:
			return phrases.reviewPending();
	}
}

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
