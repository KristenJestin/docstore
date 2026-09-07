import {
	createParty,
	findPartiesByIdentifier,
	getParty,
	listParties,
	listPartyDuplicates,
	mergeParties,
	updateParty,
} from "@docstore/api/services/party.service";
import {
	partyDuplicateReasonSchema,
	partyIdentifierKindSchema,
	partyIdentifiersPatchSchema,
	partyIdentifiersSchema,
	partyTypeSchema,
} from "@docstore/shared/party";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "./context";
import { defineTool, requireWrite } from "./context";
import { mcpBoolean } from "./schema";
import {
	partyDetailJson,
	partyJson,
	toParty,
	toPartyDetail,
} from "./serialize";

const partyFields = {
	name: z.string().trim().min(1).max(200),
	type: partyTypeSchema.describe("person, company, public_body or association"),
	aliases: z.array(z.string().trim().min(1)).optional(),
	identifiers: partyIdentifiersSchema
		.optional()
		.describe(
			"siren, siret, vat, iban[], email[], domain[], phone[], customerRef",
		),
	isHouseholdMember: mcpBoolean.optional(),
	notes: z.string().optional(),
};

/** One candidate pair of `list_duplicate_parties`. */
const partyDuplicateJson = z.object({
	partyId: z.string(),
	partyName: z.string(),
	partyLogoKey: z.string().nullable(),
	partyDocumentCount: z.number(),
	otherPartyId: z.string(),
	otherPartyName: z.string(),
	otherPartyLogoKey: z.string().nullable(),
	otherPartyDocumentCount: z.number(),
	reason: partyDuplicateReasonSchema,
	value: z.string(),
});

export function registerPartyTools(
	server: McpServer,
	context: McpContext,
): void {
	defineTool(
		server,
		"list_parties",
		{
			title: "List Parties",
			description:
				"People, companies, public bodies and associations. The search covers the name, the aliases and the identifiers.",
			inputSchema: {
				query: z.string().trim().min(1).optional(),
				type: partyTypeSchema.optional(),
				includeArchived: mcpBoolean.optional(),
				page: z.number().int().min(1).optional(),
				pageSize: z.number().int().min(1).max(100).optional(),
			},
			outputSchema: {
				items: z.array(partyJson),
				page: z.number(),
				pageSize: z.number(),
				total: z.number(),
				totalPages: z.number(),
			},
			text: (output) =>
				output.items.length === 0
					? "No Party matches."
					: `${output.total} Party:\n${output.items
							.map((party) => `- ${party.id} — ${party.name} (${party.type})`)
							.join("\n")}`,
		},
		async (input) => {
			const page = await listParties(context.db, {
				query: input.query,
				type: input.type,
				includeArchived: input.includeArchived ?? false,
				page: input.page ?? 1,
				pageSize: input.pageSize ?? 25,
			});
			return { ...page, items: page.items.map(toParty) };
		},
	);

	defineTool(
		server,
		"get_party",
		{
			title: "Party detail",
			description:
				"Identifiers, aliases, relations (employment, family, subsidiary, ...) and number of linked documents.",
			inputSchema: { id: z.string().min(1) },
			outputSchema: partyDetailJson.shape,
			text: (output) =>
				`${output.name} (${output.type}) — ${output.documentCount} linked document(s).`,
		},
		async (input) => toPartyDetail(await getParty(context.db, input.id)),
	);

	defineTool(
		server,
		"create_party",
		{
			title: "Create a Party",
			description:
				"First check with `find_party_by_identifier` or `list_parties` that it does not already exist.",
			inputSchema: partyFields,
			outputSchema: partyJson.shape,
			text: (output) => `Party created: ${output.id} — ${output.name}.`,
		},
		async (input) => {
			requireWrite(context);
			return toParty(
				await createParty(context.db, {
					name: input.name,
					type: input.type,
					aliases: input.aliases ?? [],
					identifiers: input.identifiers ?? {},
					isHouseholdMember: input.isHouseholdMember ?? false,
					notes: input.notes,
				}),
			);
		},
	);

	defineTool(
		server,
		"update_party",
		{
			title: "Update a Party",
			description:
				"Partial patch: only the provided fields are modified. `identifiers` is itself a patch — the keys you send are added or replaced, the others are kept, and a key set to `null` is removed. Send `replaceIdentifiers: true` to make the object you pass the whole identifier set.",
			inputSchema: {
				id: z.string().min(1),
				name: partyFields.name.optional(),
				type: partyTypeSchema.optional(),
				aliases: partyFields.aliases,
				identifiers: partyIdentifiersPatchSchema
					.optional()
					.describe(
						"Merged key by key; `null` removes a key. siren, siret, vat, iban[], email[], domain[], phone[], customerRef",
					),
				replaceIdentifiers: mcpBoolean
					.optional()
					.describe("Replaces the whole identifier object instead of merging."),
				isHouseholdMember: partyFields.isHouseholdMember,
				notes: partyFields.notes,
			},
			outputSchema: partyJson.shape,
			text: (output) => `Party updated: ${output.id} — ${output.name}.`,
		},
		async (input) => {
			requireWrite(context);
			const { id, ...patch } = input;
			return toParty(await updateParty(context.db, id, patch));
		},
	);

	defineTool(
		server,
		"merge_parties",
		{
			title: "Merge two Parties",
			description:
				"Absorbs `sourceId` into `targetId`: documents, relations and identifiers move, the source name is kept as an alias and the source is archived. Use it on the pairs reported by `list_duplicate_parties`; the merge cannot be undone from here.",
			inputSchema: {
				sourceId: z.string().min(1).describe("Party absorbed, then archived"),
				targetId: z.string().min(1).describe("Party that keeps everything"),
			},
			outputSchema: {
				target: partyJson,
				archivedId: z.string(),
				movedDocuments: z.number(),
				movedRelations: z.number(),
			},
			text: (output) =>
				`${output.archivedId} merged into ${output.target.id} — ${output.target.name}: ${output.movedDocuments} document(s), ${output.movedRelations} relation(s) moved.`,
		},
		async (input) => {
			requireWrite(context);
			const result = await mergeParties(context.db, {
				sourceId: input.sourceId,
				targetId: input.targetId,
			});
			return {
				target: toParty(result.target),
				archivedId: result.archivedId,
				movedDocuments: result.movedDocuments,
				movedRelations: result.movedRelations,
			};
		},
	);

	defineTool(
		server,
		"list_duplicate_parties",
		{
			title: "Parties that look like duplicates",
			description:
				"Live Parties sharing a web domain, or whose names only differ by case and spacing. Nothing is merged: check the pair, then call `merge_parties` keeping the one with the most documents.",
			inputSchema: {},
			outputSchema: { items: z.array(partyDuplicateJson) },
			text: (output) =>
				output.items
					.map(
						(item) =>
							`- ${item.reason === "sameDomain" ? `domain ${item.value}` : `name "${item.value}"`}: ${item.partyId} (${item.partyDocumentCount} doc) / ${item.otherPartyId} (${item.otherPartyDocumentCount} doc)`,
					)
					.join("\n") || "No duplicate Party.",
		},
		async () => ({ items: await listPartyDuplicates(context.db) }),
	);

	defineTool(
		server,
		"find_party_by_identifier",
		{
			title: "Find a Party by exact identifier",
			description:
				"Reliable matching of an issuer from a SIREN, SIRET, VAT number, IBAN, email or domain found on the document.",
			inputSchema: {
				kind: partyIdentifierKindSchema,
				value: z.string().trim().min(1),
			},
			outputSchema: { items: z.array(partyJson) },
			text: (output) =>
				output.items.length === 0
					? "No Party carries this identifier."
					: output.items
							.map((party) => `- ${party.id} — ${party.name}`)
							.join("\n"),
		},
		async (input) => {
			const rows = await findPartiesByIdentifier(
				context.db,
				input.kind,
				input.value,
			);
			return { items: rows.map(toParty) };
		},
	);
}

/** Reused by the `docstore://party/{id}` resources. */
export async function readPartyResource(
	context: McpContext,
	id: string,
): Promise<string> {
	return JSON.stringify(toPartyDetail(await getParty(context.db, id)), null, 2);
}
