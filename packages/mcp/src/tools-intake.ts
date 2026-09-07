import {
	listIntakeSources,
	runIntakeSourceNow,
} from "@docstore/api/services/intake-source.service";
import { createUploadLink } from "@docstore/api/services/upload-link.service";
import { futureDatetimeSchema } from "@docstore/shared/common";
import { intakeDefaultsSchema } from "@docstore/shared/intake";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "./context";
import { defineTool, requireIngestion, requireWrite } from "./context";

/**
 * "Ingestion" tools (iteration 6): view the channels, trigger one, and build an
 * upload link to send to a third party.
 */

const intakeSourceJson = z.object({
	id: z.string(),
	type: z.string(),
	name: z.string(),
	enabled: z.boolean(),
	/** Declared in the server configuration file: not editable through the API. */
	managed: z.boolean(),
	lastRunAt: z.string().nullable(),
	lastError: z.string().nullable(),
	imported: z.number(),
	duplicates: z.number(),
	errors: z.number(),
});

export function registerIntakeTools(
	server: McpServer,
	context: McpContext,
): void {
	defineTool(
		server,
		"list_intake_sources",
		{
			title: "List intake sources",
			description:
				"Configured watched folders and mailboxes, with their last poll, their last error and their cumulative counters. Passwords are never returned. A `managed` source comes from the server configuration file and cannot be edited.",
			inputSchema: {},
			outputSchema: { sources: z.array(intakeSourceJson) },
			text: (output) =>
				output.sources.length === 0
					? "No intake source configured."
					: output.sources
							.map(
								(source) =>
									`${source.name} (${source.type}${source.managed ? ", server-defined" : ""}) — ${source.enabled ? "enabled" : "disabled"}, ${source.imported} import(s)${source.lastError ? `, last error: ${source.lastError}` : ""}`,
							)
							.join("\n"),
		},
		async () => {
			const sources = await listIntakeSources(context.db);
			return {
				sources: sources.map((source) => ({
					id: source.id,
					type: source.type,
					name: source.name,
					enabled: source.enabled,
					managed: source.managed,
					lastRunAt: source.lastRunAt?.toISOString() ?? null,
					lastError: source.lastError,
					imported: source.stats.imported,
					duplicates: source.stats.duplicates,
					errors: source.stats.errors,
				})),
			};
		},
	);

	defineTool(
		server,
		"run_intake_source",
		{
			title: "Trigger a poll",
			description:
				"Queues an immediate poll of the given source (folder scan or mailbox connection). Processing is asynchronous: read `list_intake_sources` again to see the result.",
			inputSchema: { id: z.string().trim().min(1) },
			outputSchema: {
				id: z.string(),
				queued: z.boolean(),
				jobId: z.string().nullable(),
			},
			text: (output) =>
				output.queued
					? `Poll of source ${output.id} queued.`
					: `Poll of source ${output.id} was not queued.`,
		},
		async (input) => {
			requireWrite(context);
			const ingestion = requireIngestion(context);
			return runIntakeSourceNow(context.db, ingestion, input.id);
		},
	);

	defineTool(
		server,
		"create_upload_link",
		{
			title: "Create an upload link",
			description:
				"Creates a public URL on which a third party uploads files without an account. Set an expiry and a maximum number of uses when the link is meant for a single send.",
			inputSchema: {
				name: z.string().trim().min(1).max(150),
				message: z
					.string()
					.trim()
					.max(2000)
					.optional()
					.describe("Text shown to the uploader"),
				expiresAt: futureDatetimeSchema
					.optional()
					.describe(
						"ISO 8601 expiry, in the future, e.g. 2026-12-31T23:59:59Z",
					),
				maxUses: z.number().int().min(1).max(10_000).optional(),
				defaults: intakeDefaultsSchema
					.optional()
					.describe("Enforced category, tags, issuer and sensitive flag"),
			},
			outputSchema: {
				id: z.string(),
				url: z.string(),
				expiresAt: z.string().nullable(),
				maxUses: z.number().nullable(),
			},
			text: (output) => `Upload link created: ${output.url}`,
		},
		async (input) => {
			requireWrite(context);
			const created = await createUploadLink(
				context.db,
				context.principal.userId,
				{
					name: input.name,
					message: input.message ?? null,
					expiresAt: input.expiresAt ?? null,
					maxUses: input.maxUses ?? null,
					defaults: input.defaults ?? {},
					enabled: true,
				},
			);
			return {
				id: created.link.id,
				url: created.url,
				expiresAt: created.link.expiresAt?.toISOString() ?? null,
				maxUses: created.link.maxUses,
			};
		},
	);
}
