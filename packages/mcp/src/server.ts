import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./context";
import { registerPrompts } from "./prompts";
import { registerResources } from "./resources";
import { registerCollectionTools } from "./tools-collections";
import { registerDocumentTools } from "./tools-documents";
import { registerIntakeTools } from "./tools-intake";
import { registerPartyTools } from "./tools-parties";
import { registerSharingTools } from "./tools-sharing";
import { registerTaxonomyTools } from "./tools-taxonomy";
import { registerUploadTool } from "./tools-upload";

export const MCP_SERVER_NAME = "docstore";
export const MCP_SERVER_VERSION = "1.0.0";

/** Data model, read by the agent during the handshake. */
export const MCP_INSTRUCTIONS = `Personal and family document store (docstore).
A Document has a title, a date and its precision (day, month, year), a covered
period, a single category, tags, typed custom fields and files (the original
plus its derivatives).
A Party is a person, company, public body or association, linked to the document
by a role: issuer, recipient, subject (the person concerned) or mentioned.
Categories form a tree of at most three levels; tags are flat.
A sensitive document (health, banking, identity) is encrypted at rest, only
releases its text to keys holding the sensitive scope, and can never be shared
through a public link.
A share link opens a public URL onto one document or one dossier, with an
optional expiry, password and view quota; an ASN is the number of the paper
folder the document is filed in.
The status follows ingestion: processing, review, active, archived. The review
queue holds low-confidence automatic proposals: approve_review accepts them,
reject_assignment rejects one.
A document type describes "the same document we keep receiving": category,
issuer, subject, tags, title template, layouts carrying the extraction
rules, and an optional recurrence (weekly, monthly, quarterly, semiannual,
yearly) whose missing periods list_missing_periods reports.
apply_document_type writes all of that onto a document. A Dossier is a flat, cross-cutting collection, open or
closed. Reminders are generated from valid_until and from the recurring types.
Two documents are linked by version_of, page_of, supersedes, related_to or
fulfills (invoice <-> contract).
Every write requires the write scope.
Search before creating: find_party_by_identifier and list_tags avoid duplicates.`;

export interface CreateMcpServerOptions extends McpContext {}

/**
 * Builds an MCP server bound to a caller.
 *
 * One instance per request (or per MCP session): the context carries the
 * caller's API key, and its scopes must not leak from one request to another.
 */
export function createMcpServer(options: CreateMcpServerOptions): McpServer {
	const server = new McpServer(
		{ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
		{ instructions: MCP_INSTRUCTIONS },
	);

	const context: McpContext = {
		db: options.db,
		ingestion: options.ingestion,
		principal: options.principal,
	};

	registerDocumentTools(server, context);
	registerPartyTools(server, context);
	registerTaxonomyTools(server, context);
	registerCollectionTools(server, context);
	registerUploadTool(server, context);
	registerIntakeTools(server, context);
	registerSharingTools(server, context);
	registerResources(server, context);
	registerPrompts(server);

	return server;
}
