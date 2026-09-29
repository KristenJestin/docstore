import { listActivity } from "@docstore/api/services/activity.service";
import {
	type ActivityEntry,
	activityActorTypeSchema,
	activityKindSchema,
	listActivityInput,
	maskSensitiveActivity,
} from "@docstore/shared/activity";
import { maskPartyActivityEntry } from "@docstore/shared/party-masking";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	defineTool,
	type McpContext,
	McpToolError,
	requireRead,
} from "./context";
import { mcpBoolean } from "./schema";

/**
 * Activity log over MCP (issue #15): an agent can check what it did itself
 * (`mine: true`), or what another key did.
 */

const activityEntryJson = z.object({
	id: z.string(),
	createdAt: z.string(),
	kind: z.string(),
	action: z.string(),
	actor: z.object({
		type: z.string(),
		userId: z.string().nullable(),
		apiKeyId: z.string().nullable(),
		name: z.string().nullable(),
	}),
	objectType: z.string(),
	objectId: z.string().nullable(),
	objectLabel: z.string().nullable(),
	summary: z.record(z.string(), z.unknown()),
	sensitive: z.boolean(),
});

function toJson(entry: ActivityEntry): z.infer<typeof activityEntryJson> {
	return { ...entry, createdAt: entry.createdAt.toISOString() };
}

function describe(entry: z.infer<typeof activityEntryJson>): string {
	const who = entry.actor.name ?? entry.actor.apiKeyId ?? entry.actor.type;
	const what = entry.objectLabel ?? entry.objectId ?? entry.objectType;
	return `${entry.createdAt} ${who} ${entry.action} ${what}${entry.sensitive ? " [sensitive]" : ""}`;
}

export function registerActivityTools(
	server: McpServer,
	context: McpContext,
): void {
	defineTool(
		server,
		"list_activity",
		{
			title: "List the activity log",
			description:
				"Who changed or read what, newest first: one entry per change (web, API, MCP, rules, pipeline) and per traced read (document detail, OCR text, file download, export, search by an API key). Each entry names its actor (a user, an API key with its name, or `system`), the action (`document.tagged`, `document.trashed`, `party.merged`…), the object and a short summary of the change (fields before and after, never file content). Pass `mine: true` to see what this API key did itself.",
			inputSchema: {
				since: z.iso
					.datetime({ offset: true })
					.optional()
					.describe("Only the entries written at or after this instant."),
				mine: mcpBoolean
					.optional()
					.describe("Only the entries of the API key making this call."),
				actorKeyId: z
					.string()
					.min(1)
					.optional()
					.describe("Only the entries of this API key (`key_…`)."),
				actorType: activityActorTypeSchema.optional(),
				objectId: z
					.string()
					.min(1)
					.optional()
					.describe("Only the entries about this object (`doc_…`, `pty_…`…)."),
				action: z
					.string()
					.min(1)
					.max(100)
					.optional()
					.describe(
						"Exact action (`document.tagged`), or a prefix ending with a dot (`document.`).",
					),
				kind: activityKindSchema.optional(),
				sensitive: mcpBoolean.optional(),
				page: z.number().int().min(1).optional(),
				pageSize: z.number().int().min(1).max(100).optional(),
			},
			outputSchema: {
				items: z.array(activityEntryJson),
				page: z.number(),
				pageSize: z.number(),
				total: z.number(),
				totalPages: z.number(),
			},
			text: (output) =>
				output.items.length === 0
					? "No activity matches."
					: `${output.total} entr${output.total === 1 ? "y" : "ies"}, page ${output.page}/${output.totalPages}:\n${output.items
							.map((entry) => `- ${describe(entry)}`)
							.join("\n")}`,
		},
		async (input) => {
			requireRead(context);
			if (input.mine && !context.principal.keyId) {
				throw new McpToolError("`mine` needs a call made with an API key.");
			}
			const parsed = listActivityInput.safeParse({
				since: input.since,
				actorKeyId: input.mine ? context.principal.keyId : input.actorKeyId,
				actorType: input.actorType,
				objectId: input.objectId,
				action: input.action,
				kind: input.kind,
				sensitive: input.sensitive,
				page: input.page ?? 1,
				pageSize: input.pageSize ?? 25,
			});
			if (!parsed.success) throw new McpToolError(parsed.error.message);
			const page = await listActivity(context.db, parsed.data);
			return {
				...page,
				// Field values of sensitive documents (#22) and Party identifiers
				// (#23) are withheld from a key without `sensitive`.
				items: page.items.map((entry) =>
					toJson(
						maskPartyActivityEntry(
							maskSensitiveActivity(entry, context.principal),
							context.principal,
						),
					),
				),
			};
		},
	);
}
