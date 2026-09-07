import {
	generateRemindersResultSchema,
	listRemindersInput,
	reminderCountSchema,
	reminderIdInput,
	reminderItemSchema,
	reminderSchema,
	snoozeReminderInput,
} from "@docstore/shared/reminder";
import { z } from "zod";
import { protectedProcedure, writeProcedure } from "../index";
import {
	completeReminder,
	countReminders,
	dismissReminder,
	generateReminders,
	listReminders,
	snoozeReminder,
} from "../services/reminder.service";

const TAGS = ["Reminder"];

export const reminderRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/reminders",
			tags: TAGS,
			summary: "List reminders (expiry, missing periods)",
		})
		.input(listRemindersInput)
		.output(z.array(reminderItemSchema))
		.handler(({ input, context }) => listReminders(context.db, input)),

	count: protectedProcedure
		.route({
			method: "GET",
			path: "/reminders/count",
			tags: TAGS,
			summary: "Number of pending reminders due within 30 days",
		})
		.input(z.object({}))
		.output(reminderCountSchema)
		.handler(({ context }) => countReminders(context.db)),

	generate: writeProcedure
		.route({
			method: "POST",
			path: "/reminders/generate",
			tags: TAGS,
			summary: "Recompute reminders (idempotent)",
		})
		.input(z.object({}))
		.output(generateRemindersResultSchema)
		.handler(({ context }) => generateReminders(context.db)),

	snooze: writeProcedure
		.route({
			method: "POST",
			path: "/reminders/{id}/snooze",
			tags: TAGS,
			summary: "Snooze a reminder until a date",
		})
		.input(snoozeReminderInput)
		.output(reminderSchema)
		.handler(({ input, context }) => snoozeReminder(context.db, input)),

	dismiss: writeProcedure
		.route({
			method: "POST",
			path: "/reminders/{id}/dismiss",
			tags: TAGS,
			summary: "Dismiss a reminder (it will not be recreated)",
		})
		.input(reminderIdInput)
		.output(reminderSchema)
		.handler(({ input, context }) => dismissReminder(context.db, input.id)),

	done: writeProcedure
		.route({
			method: "POST",
			path: "/reminders/{id}/done",
			tags: TAGS,
			summary: "Mark a reminder as done",
		})
		.input(reminderIdInput)
		.output(reminderSchema)
		.handler(({ input, context }) => completeReminder(context.db, input.id)),
};
