import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Prompts: two ready-to-use operating modes for an agent connected to this
 * server (classify a document, clear the review queue).
 */

const CLASSIFY = `You are classifying a document from the family document store.

Steps:
1. \`get_document\` then \`get_document_text\` to read the document. If the text
   is masked, work from the metadata alone and say so.
2. Identify the issuer: look for a SIREN, SIRET, VAT number, IBAN, email or
   domain in the text, then call \`find_party_by_identifier\`. Otherwise use
   \`list_parties\` with the name. Only create a Party with \`create_party\` if
   none matches, and then fill in its identifiers.
3. \`link_party\` with the role \`issuer\`, \`recipient\` or \`subject\` (the
   person concerned).
4. \`list_categories\` then \`set_document_category\` with the most precise
   category. \`list_tags\` then \`set_document_tags\` for the useful tags.
5. \`update_document\` for the title, the document date and its precision
   (\`day\`, \`month\` or \`year\` depending on what the document actually
   states), the covered period, the end-of-validity date, and
   \`sensitive: true\` for a medical, banking or identity document.
6. \`list_custom_fields\` then \`set_field_value\` for the amounts, contract
   numbers and references extracted from the text.
7. If the document is in \`review\` status, finish with \`approve_review\`.

Never guess a date or an amount that is absent from the document: leave the
field empty.`;

const REVIEW_QUEUE = `You are working through the review queue of the document store.

1. \`list_review_queue\` to get the documents and their reasons.
2. For each document, read the reasons: low confidence, missing category or
   issuer, failed extraction, likely duplicate.
3. Check the proposal with \`get_document\` and \`get_document_text\`.
   - correct proposal: \`approve_review\` (with a \`patch\` if a date or a title
     needs fixing along the way);
   - wrong proposal: \`reject_assignment\` specifying \`kind\` and \`ref\`, then
     set the right value (\`set_document_category\`, \`link_party\`, ...) before
     approving;
   - unreadable document: \`reprocess_document\`.
4. Handle at most ten documents per pass, then summarise what was done and what
   is still waiting for a human decision.`;

export function registerPrompts(server: McpServer): void {
	server.registerPrompt(
		"classify_document",
		{
			title: "Classify a document",
			description:
				"Guide to categorise a document, link its issuer, extract dates and amounts, then approve it.",
			argsSchema: {
				documentId: z
					.string()
					.min(1)
					.describe("Identifier of the document to classify"),
			},
		},
		({ documentId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `${CLASSIFY}\n\nDocument to handle: ${documentId}`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"review_queue",
		{
			title: "Work through the review queue",
			description:
				"Guide to clear the review queue: approve, correct or reject the automatic assignments.",
			argsSchema: {},
		},
		() => ({
			messages: [
				{ role: "user", content: { type: "text", text: REVIEW_QUEUE } },
			],
		}),
	);
}
