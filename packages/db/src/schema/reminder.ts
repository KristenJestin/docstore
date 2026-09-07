import { REMINDER_KINDS, REMINDER_STATUSES } from "@docstore/shared/reminder";
import { relations, sql } from "drizzle-orm";
import {
	date,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId } from "../id";
import { document } from "./document";
import { documentType } from "./document-type";

export const reminderKindEnum = pgEnum("reminder_kind", REMINDER_KINDS);
export const reminderStatusEnum = pgEnum("reminder_status", REMINDER_STATUSES);

/**
 * Reminder (SPEC §2 "Misc"), always recomputed by `reminder.generate`:
 * expiry of a document (`valid_until`) or a gap in a recurring document type.
 *
 * The unique index is built on `coalesce` — since `null` is never equal to
 * itself, a plain index would let duplicates through. `due_date` is part of the
 * key: a single expiring document produces several reminders (D-90, D-30, D-7)
 * that only differ by their due date.
 *
 * The row holds **facts** only. The sentence a human reads is derived from them
 * by `reminderMessage` (`@docstore/shared/reminder`) in whichever language the
 * reader needs, so it is never stored.
 */
export const reminder = pgTable(
	"reminder",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("rem_")),
		kind: reminderKindEnum("kind").notNull(),
		documentId: text("document_id").references(() => document.id, {
			onDelete: "cascade",
		}),
		documentTypeId: text("document_type_id").references(() => documentType.id, {
			onDelete: "cascade",
		}),
		dueDate: date("due_date").notNull(),
		/** First day of the period concerned (`period_gap`). */
		period: date("period"),
		/**
		 * Days of notice an `expiry` reminder stands for (90, 30, 7…): the
		 * document expires on `due_date` + `days_before`. Null on other kinds.
		 */
		daysBefore: integer("days_before"),
		status: reminderStatusEnum("status").notNull().default("pending"),
		snoozedUntil: date("snoozed_until"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("reminder_identity_uidx").on(
			table.kind,
			sql`coalesce(${table.documentId}, '')`,
			sql`coalesce(${table.documentTypeId}, '')`,
			sql`coalesce(${table.period}, '1970-01-01'::date)`,
			table.dueDate,
		),
		index("reminder_status_due_date_idx").on(table.status, table.dueDate),
		index("reminder_document_id_idx").on(table.documentId),
		index("reminder_document_type_id_idx").on(table.documentTypeId),
	],
);

export const reminderRelations = relations(reminder, ({ one }) => ({
	document: one(document, {
		fields: [reminder.documentId],
		references: [document.id],
	}),
	documentType: one(documentType, {
		fields: [reminder.documentTypeId],
		references: [documentType.id],
	}),
}));

export type Reminder = typeof reminder.$inferSelect;
export type NewReminder = typeof reminder.$inferInsert;
