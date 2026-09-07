import { listDocuments } from "@docstore/api/services/document.service";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./context";
import { readDocumentResource } from "./tools-documents";
import { readPartyResource } from "./tools-parties";

/** Number of documents exposed by `resources/list` (the most recent ones). */
export const RESOURCE_LIST_LIMIT = 50;

export function registerResources(
	server: McpServer,
	context: McpContext,
): void {
	server.registerResource(
		"document",
		new ResourceTemplate("docstore://document/{id}", {
			list: async () => {
				const page = await listDocuments(context.db, {
					deleted: "exclude",
					page: 1,
					pageSize: RESOURCE_LIST_LIMIT,
					sort: "createdAt:desc",
				});
				return {
					resources: page.items.map((item) => ({
						uri: `docstore://document/${item.id}`,
						name: item.title,
						mimeType: "application/json",
					})),
				};
			},
		}),
		{
			title: "Document",
			description:
				"JSON metadata of a document (without the OCR text). The list exposes the 50 most recent documents.",
			mimeType: "application/json",
		},
		async (uri, variables) => {
			const id = Array.isArray(variables.id) ? variables.id[0] : variables.id;
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: await readDocumentResource(context, String(id)),
					},
				],
			};
		},
	);

	server.registerResource(
		"party",
		// No enumeration: Parties are discovered through `list_parties`.
		new ResourceTemplate("docstore://party/{id}", { list: undefined }),
		{
			title: "Party",
			description:
				"JSON record of a Party: identifiers, aliases, relations, document count.",
			mimeType: "application/json",
		},
		async (uri, variables) => {
			const id = Array.isArray(variables.id) ? variables.id[0] : variables.id;
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "application/json",
						text: await readPartyResource(context, String(id)),
					},
				],
			};
		},
	);
}
