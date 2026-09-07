import {
	createIntakeSourceInput,
	intakeLogSchema,
	intakeSourceSchema,
	listIntakeLogsInput,
	runIntakeSourceResultSchema,
	testIntakeSourceInput,
	testIntakeSourceResultSchema,
	toggleIntakeSourceInput,
	updateIntakeSourceInput,
} from "@docstore/shared/intake";
import { paginatedSchema } from "@docstore/shared/pagination";
import { z } from "zod";
import { adminProcedure, protectedProcedure } from "../index";
import {
	createIntakeSource,
	deleteIntakeSource,
	getIntakeSource,
	listIntakeLogs,
	listIntakeSources,
	runIntakeSourceNow,
	testIntakeSource,
	toggleIntakeSource,
	updateIntakeSource,
} from "../services/intake-source.service";

const TAGS = ["Intake source"];

const idInput = z.object({ id: z.string().min(1) });

/**
 * Intake channels (SPEC §5).
 *
 * Administration: a source carries connection credentials and a server path, it
 * is not ordinary business data — hence `adminProcedure` on every write.
 */
export const intakeSourceRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/intake-sources",
			tags: TAGS,
			summary: "List intake channels (watched folders, mailboxes)",
		})
		.input(z.object({}))
		.output(z.array(intakeSourceSchema))
		.handler(({ context }) => listIntakeSources(context.db)),

	get: protectedProcedure
		.route({
			method: "GET",
			path: "/intake-sources/{id}",
			tags: TAGS,
			summary: "Channel detail (the password is never returned)",
		})
		.input(idInput)
		.output(intakeSourceSchema)
		.handler(({ input, context }) => getIntakeSource(context.db, input.id)),

	create: adminProcedure
		.route({
			method: "POST",
			path: "/intake-sources",
			tags: TAGS,
			summary: "Create an intake channel",
			successStatus: 201,
		})
		.input(createIntakeSourceInput)
		.output(intakeSourceSchema)
		.handler(({ input, context }) => createIntakeSource(context.db, input)),

	update: adminProcedure
		.route({
			method: "PATCH",
			path: "/intake-sources/{id}",
			tags: TAGS,
			summary: "Update a channel (an absent password means unchanged)",
		})
		.input(updateIntakeSourceInput)
		.output(intakeSourceSchema)
		.handler(({ input, context }) => updateIntakeSource(context.db, input)),

	delete: adminProcedure
		.route({
			method: "DELETE",
			path: "/intake-sources/{id}",
			tags: TAGS,
			summary: "Delete a channel and its log",
		})
		.input(idInput)
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) => deleteIntakeSource(context.db, input.id)),

	toggle: adminProcedure
		.route({
			method: "POST",
			path: "/intake-sources/{id}/toggle",
			tags: TAGS,
			summary: "Enable or disable a channel",
		})
		.input(toggleIntakeSourceInput)
		.output(intakeSourceSchema)
		.handler(({ input, context }) => toggleIntakeSource(context.db, input)),

	runNow: adminProcedure
		.route({
			method: "POST",
			path: "/intake-sources/{id}/run",
			tags: TAGS,
			summary: "Trigger an immediate poll",
		})
		.input(idInput)
		.output(runIntakeSourceResultSchema)
		.handler(({ input, context }) =>
			runIntakeSourceNow(context.db, context.ingestion, input.id),
		),

	test: adminProcedure
		.route({
			method: "POST",
			path: "/intake-sources/test",
			tags: TAGS,
			summary: "Test an existing channel or a draft",
		})
		.input(testIntakeSourceInput)
		.output(testIntakeSourceResultSchema)
		.handler(({ input, context }) =>
			testIntakeSource(context.db, context.ingestion, input),
		),

	logs: protectedProcedure
		.route({
			method: "GET",
			path: "/intake-sources/{id}/logs",
			tags: TAGS,
			summary: "Intake log of the channel (30 days of retention)",
		})
		.input(listIntakeLogsInput)
		.output(paginatedSchema(intakeLogSchema))
		.handler(({ input, context }) => listIntakeLogs(context.db, input)),
};
