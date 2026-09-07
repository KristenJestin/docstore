import { paginatedSchema } from "@docstore/shared/pagination";
import {
	createRuleInput,
	listRuleRunsInput,
	reorderRulesInput,
	ruleRunSchema,
	ruleSchema,
	runRulesInput,
	runRulesResultSchema,
	testRuleInput,
	testRuleResultSchema,
	toggleRuleInput,
	updateRuleInput,
} from "@docstore/shared/rule";
import { z } from "zod";
import { protectedProcedure, writeProcedure } from "../index";
import {
	createRule,
	deleteRule,
	getRule,
	listRuleRuns,
	listRules,
	reorderRules,
	runRules,
	testRule,
	toggleRule,
	updateRule,
} from "../services/rule.service";

const TAGS = ["Rule"];

const idInput = z.object({ id: z.string().min(1) });

export const ruleRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/rules",
			tags: TAGS,
			summary: "List automations in priority order",
		})
		.input(z.object({}))
		.output(z.array(ruleSchema))
		.handler(({ context }) => listRules(context.db)),

	get: protectedProcedure
		.route({
			method: "GET",
			path: "/rules/{id}",
			tags: TAGS,
			summary: "Automation detail",
		})
		.input(idInput)
		.output(ruleSchema)
		.handler(({ input, context }) => getRule(context.db, input.id)),

	create: writeProcedure
		.route({
			method: "POST",
			path: "/rules",
			tags: TAGS,
			summary: "Create an automation",
			successStatus: 201,
		})
		.input(createRuleInput)
		.output(ruleSchema)
		.handler(({ input, context }) => createRule(context.db, input)),

	update: writeProcedure
		.route({
			method: "PATCH",
			path: "/rules/{id}",
			tags: TAGS,
			summary: "Update an automation",
		})
		.input(updateRuleInput)
		.output(ruleSchema)
		.handler(({ input, context }) => updateRule(context.db, input)),

	delete: writeProcedure
		.route({
			method: "DELETE",
			path: "/rules/{id}",
			tags: TAGS,
			summary: "Delete an automation and its log",
		})
		.input(idInput)
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) => deleteRule(context.db, input.id)),

	reorder: writeProcedure
		.route({
			method: "PUT",
			path: "/rules/order",
			tags: TAGS,
			summary: "Reorder automations (the array order becomes the priority)",
		})
		.input(reorderRulesInput)
		.output(z.array(ruleSchema))
		.handler(({ input, context }) => reorderRules(context.db, input.ids)),

	toggle: writeProcedure
		.route({
			method: "POST",
			path: "/rules/{id}/toggle",
			tags: TAGS,
			summary: "Enable or disable an automation",
		})
		.input(toggleRuleInput)
		.output(ruleSchema)
		.handler(({ input, context }) =>
			toggleRule(context.db, input.id, input.enabled),
		),

	test: protectedProcedure
		.route({
			method: "POST",
			path: "/rules/test",
			tags: TAGS,
			summary: "Evaluate an automation on a document without writing anything",
		})
		.input(testRuleInput)
		.output(testRuleResultSchema)
		.handler(({ input, context }) => testRule(context.db, input)),

	run: writeProcedure
		.route({
			method: "POST",
			path: "/rules/run",
			tags: TAGS,
			summary: 'Run the automations (trigger "manual") and apply them',
		})
		.input(runRulesInput)
		.output(runRulesResultSchema)
		.handler(({ input, context }) => runRules(context.db, input)),

	runs: protectedProcedure
		.route({
			method: "GET",
			path: "/rules/runs",
			tags: TAGS,
			summary: "Automation run log",
		})
		.input(listRuleRunsInput)
		.output(paginatedSchema(ruleRunSchema))
		.handler(({ input, context }) => listRuleRuns(context.db, input)),
};
