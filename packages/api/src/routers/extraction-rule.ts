import {
	applicableExtractionRulesInput,
	createExtractionRuleInput,
	extractionResultSchema,
	extractionRuleSchema,
	listExtractionRulesInput,
	previewLayoutInput,
	previewLayoutResultSchema,
	testExtractionRuleInput,
	updateExtractionRuleInput,
} from "@docstore/shared/extraction";
import { z } from "zod";
import { protectedProcedure, writeProcedure } from "../index";
import {
	applicableExtractionRules,
	createExtractionRule,
	deleteExtractionRule,
	getExtractionRule,
	listExtractionRules,
	previewLayout,
	testExtractionRule,
	updateExtractionRule,
} from "../services/extraction-rule.service";

const TAGS = ["ExtractionRule"];

const idInput = z.object({ id: z.string().min(1) });

export const extractionRuleRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/extraction-rules",
			tags: TAGS,
			summary: "List the extraction rules of a layout or of a document type",
		})
		.input(listExtractionRulesInput)
		.output(z.array(extractionRuleSchema))
		.handler(({ input, context }) => listExtractionRules(context.db, input)),

	applicable: protectedProcedure
		.route({
			method: "GET",
			path: "/extraction-rules/applicable",
			tags: TAGS,
			summary: "Extraction rules of the layout selected for a document",
		})
		.input(applicableExtractionRulesInput)
		.output(z.array(extractionRuleSchema))
		.handler(({ input, context }) =>
			applicableExtractionRules(context.db, input),
		),

	get: protectedProcedure
		.route({
			method: "GET",
			path: "/extraction-rules/{id}",
			tags: TAGS,
			summary: "Extraction rule detail",
		})
		.input(idInput)
		.output(extractionRuleSchema)
		.handler(({ input, context }) => getExtractionRule(context.db, input.id)),

	create: writeProcedure
		.route({
			method: "POST",
			path: "/extraction-rules",
			tags: TAGS,
			summary: "Create an extraction rule",
			successStatus: 201,
		})
		.input(createExtractionRuleInput)
		.output(extractionRuleSchema)
		.handler(({ input, context }) => createExtractionRule(context.db, input)),

	update: writeProcedure
		.route({
			method: "PATCH",
			path: "/extraction-rules/{id}",
			tags: TAGS,
			summary: "Update an extraction rule",
		})
		.input(updateExtractionRuleInput)
		.output(extractionRuleSchema)
		.handler(({ input, context }) => updateExtractionRule(context.db, input)),

	delete: writeProcedure
		.route({
			method: "DELETE",
			path: "/extraction-rules/{id}",
			tags: TAGS,
			summary: "Delete an extraction rule",
		})
		.input(idInput)
		.output(z.object({ id: z.string(), deleted: z.literal(true) }))
		.handler(({ input, context }) =>
			deleteExtractionRule(context.db, input.id),
		),

	test: protectedProcedure
		.route({
			method: "POST",
			path: "/extraction-rules/test",
			tags: TAGS,
			summary: "Try an extraction on a document without writing anything",
		})
		.input(testExtractionRuleInput)
		.output(extractionResultSchema)
		.handler(({ input, context }) => testExtractionRule(context.db, input)),

	preview: protectedProcedure
		.route({
			method: "GET",
			path: "/extraction-rules/preview",
			tags: TAGS,
			summary: "Rebuilt lines of the OCR layer (helps writing anchors)",
		})
		.input(previewLayoutInput)
		.output(previewLayoutResultSchema)
		.handler(({ input, context }) => previewLayout(context.db, input)),
};
