import { listCategories } from "@docstore/api/services/category.service";
import { listCustomFields } from "@docstore/api/services/custom-field.service";
import {
	listRules,
	runRules,
	testRule,
} from "@docstore/api/services/rule.service";
import { createTag, listTags } from "@docstore/api/services/tag.service";
import type { CategoryNode } from "@docstore/shared/category";
import { hexColorSchema } from "@docstore/shared/common";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "./context";
import { defineTool, requireWrite } from "./context";
import { mcpBoolean } from "./schema";

const categoryJson = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	parentId: z.string().nullable(),
	depth: z.number(),
	path: z.string(),
	documentCount: z.number(),
});
type CategoryJson = z.infer<typeof categoryJson>;

/** The tree is flattened: an agent reasons better on a list carrying paths. */
function flattenCategories(nodes: CategoryNode[], prefix = ""): CategoryJson[] {
	const rows: CategoryJson[] = [];
	for (const node of nodes) {
		const path = prefix ? `${prefix} / ${node.name}` : node.name;
		rows.push({
			id: node.id,
			name: node.name,
			slug: node.slug,
			parentId: node.parentId,
			depth: node.depth,
			path,
			documentCount: node.documentCount,
		});
		rows.push(...flattenCategories(node.children, path));
	}
	return rows;
}

const tagJson = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string().nullable(),
	documentCount: z.number(),
});

const customFieldJson = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	type: z.string(),
	options: z.record(z.string(), z.unknown()),
	categoryIds: z.array(z.string()),
});

const ruleJson = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	enabled: z.boolean(),
	priority: z.number(),
	triggers: z.array(z.string()),
	stopOnMatch: z.boolean(),
	matchCount: z.number(),
	/** Action types, in execution order (`add_tag`, `set_category`…). */
	actions: z.array(z.string()),
});

export function registerTaxonomyTools(
	server: McpServer,
	context: McpContext,
): void {
	defineTool(
		server,
		"list_categories",
		{
			title: "List categories",
			description:
				"Flattened category tree (3 levels maximum), with the full path and the document count (subtree included).",
			inputSchema: {},
			outputSchema: { items: z.array(categoryJson) },
			text: (output) =>
				output.items
					.map((item) => `- ${item.id} — ${item.path} (${item.documentCount})`)
					.join("\n") || "No category.",
		},
		async () => ({
			items: flattenCategories(await listCategories(context.db)),
		}),
	);

	defineTool(
		server,
		"list_tags",
		{
			title: "List tags",
			description: "Flat tags with their document count.",
			inputSchema: { query: z.string().trim().min(1).optional() },
			outputSchema: { items: z.array(tagJson) },
			text: (output) =>
				output.items
					.map((item) => `- ${item.id} — ${item.name} (${item.documentCount})`)
					.join("\n") || "No tag.",
		},
		async (input) => {
			const rows = await listTags(context.db, { query: input.query });
			return {
				items: rows.map((row) => ({
					id: row.id,
					name: row.name,
					color: row.color,
					documentCount: row.documentCount,
				})),
			};
		},
	);

	defineTool(
		server,
		"create_tag",
		{
			title: "Create a tag",
			description:
				"The name is unique, case-insensitively: prefer `list_tags` before creating one.",
			inputSchema: {
				name: z.string().trim().min(1).max(60),
				color: hexColorSchema.optional(),
			},
			outputSchema: {
				id: z.string(),
				name: z.string(),
				color: z.string().nullable(),
			},
			text: (output) => `Tag created: ${output.id} — ${output.name}.`,
		},
		async (input) => {
			requireWrite(context);
			const row = await createTag(context.db, {
				name: input.name,
				color: input.color,
			});
			return { id: row.id, name: row.name, color: row.color };
		},
	);

	defineTool(
		server,
		"list_custom_fields",
		{
			title: "List custom fields",
			description:
				"Definitions usable with `set_field_value`; an empty `categoryIds` means the field is offered everywhere.",
			inputSchema: {},
			outputSchema: { items: z.array(customFieldJson) },
			text: (output) =>
				output.items
					.map((item) => `- ${item.id} — ${item.name} (${item.type})`)
					.join("\n") || "No custom field.",
		},
		async () => {
			const rows = await listCustomFields(context.db);
			return {
				items: rows.map((row) => ({
					id: row.id,
					name: row.name,
					slug: row.slug,
					type: row.type,
					options: row.options as Record<string, unknown>,
					categoryIds: row.categoryIds,
				})),
			};
		},
	);

	defineTool(
		server,
		"list_rules",
		{
			title: "List automations",
			description:
				"Automation rules, in increasing priority order (the first one that matches wins if `stopOnMatch`). Cross-cutting behaviour (tags, dossiers, sensitivity, webhooks…) plus the one-off filing a document type would be overkill for (`set_category`, `add_to_dossier`). A family of documents that keeps coming back is the job of a document type, not an automation.",
			inputSchema: {},
			outputSchema: { items: z.array(ruleJson) },
			text: (output) =>
				output.items
					.map(
						(item) =>
							`- ${item.id} — ${item.name}${item.enabled ? "" : " (disabled)"}${
								item.actions.length > 0
									? ` [${item.actions.join(", ")}]`
									: " [no action]"
							}`,
					)
					.join("\n") || "No automation.",
		},
		async () => {
			const rows = await listRules(context.db);
			return {
				items: rows.map((row) => ({
					id: row.id,
					name: row.name,
					description: row.description,
					enabled: row.enabled,
					priority: row.priority,
					triggers: row.triggers,
					stopOnMatch: row.stopOnMatch,
					matchCount: row.matchCount,
					actions: row.actions.map((action) => action.type),
				})),
			};
		},
	);

	defineTool(
		server,
		"test_rule",
		{
			title: "Test an automation on a document",
			description:
				"Dry-run evaluation: nothing is written. Returns whether the automation rule matches and the operations it would produce.",
			inputSchema: {
				documentId: z.string().min(1),
				ruleId: z.string().min(1),
			},
			outputSchema: {
				matched: z.boolean(),
				plannedActions: z.array(z.unknown()),
				extractions: z.array(z.unknown()),
				/** `false` = the automation carries no action and does nothing. */
				hasActions: z.boolean(),
				enabled: z.boolean(),
			},
			text: (output) => {
				if (!output.matched) {
					return "The automation does not match this document.";
				}
				if (!output.hasActions) {
					return "The automation matches but carries no action: it would do nothing.";
				}
				return `The automation matches: ${output.plannedActions.length} planned operation(s).`;
			},
		},
		async (input) => {
			const result = await testRule(context.db, {
				ruleId: input.ruleId,
				documentId: input.documentId,
			});
			return {
				matched: result.matched,
				plannedActions: result.plannedActions,
				extractions: result.extractions,
				hasActions: result.hasActions,
				enabled: result.enabled,
			};
		},
	);

	defineTool(
		server,
		"run_rule",
		{
			title: "Run an automation",
			description:
				"Actually applies an automation rule (trigger `manual`) to a list of documents.",
			inputSchema: {
				ruleId: z.string().min(1),
				documentIds: z.array(z.string().min(1)).min(1).max(500),
				force: mcpBoolean
					.optional()
					.describe("Runs the automation even when it is disabled."),
			},
			outputSchema: { processed: z.number(), matched: z.number() },
			text: (output) =>
				`${output.processed} document(s) processed, ${output.matched} match(es).`,
		},
		async (input) => {
			requireWrite(context);
			return runRules(context.db, {
				ruleId: input.ruleId,
				documentIds: input.documentIds,
				all: false,
				force: input.force ?? false,
			});
		},
	);
}
