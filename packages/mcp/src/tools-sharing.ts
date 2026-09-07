import {
	assignAsn,
	getDocumentByAsn,
	nextAsn,
} from "@docstore/api/services/document.service";
import { previewExport } from "@docstore/api/services/export.service";
import {
	createShareLink,
	listShareLinks,
	revokeShareLink,
} from "@docstore/api/services/share-link.service";
import { futureDatetimeSchema } from "@docstore/shared/common";
import {
	exportDocumentsInput,
	exportLayoutSchema,
} from "@docstore/shared/export";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "./context";
import { defineTool, McpToolError, requireWrite } from "./context";
import { mcpBoolean } from "./schema";
import {
	describeDocument,
	documentDetailJson,
	toDocumentDetail,
} from "./serialize";

/**
 * "Sharing" tools (iteration 7): share links, tree export and physical
 * archiving (ASN).
 *
 * `export_documents` deliberately stops at the preview: an agent has no use for
 * a multi-megabyte ZIP over JSON-RPC, and the archive is one `POST /api/export`
 * away for whoever actually needs the bytes.
 */

const shareLinkJson = z.object({
	id: z.string(),
	url: z.string(),
	kind: z.string(),
	targetTitle: z.string(),
	documentId: z.string().nullable(),
	dossierId: z.string().nullable(),
	expiresAt: z.string().nullable(),
	hasPassword: z.boolean(),
	maxViews: z.number().nullable(),
	views: z.number(),
	allowDownload: z.boolean(),
	revokedAt: z.string().nullable(),
	createdAt: z.string(),
});

type ShareLinkJson = z.infer<typeof shareLinkJson>;

function toShareLinkJson(link: {
	id: string;
	url: string;
	kind: string;
	targetTitle: string;
	documentId: string | null;
	dossierId: string | null;
	expiresAt: Date | null;
	hasPassword: boolean;
	maxViews: number | null;
	views: number;
	allowDownload: boolean;
	revokedAt: Date | null;
	createdAt: Date;
}): ShareLinkJson {
	return {
		id: link.id,
		url: link.url,
		kind: link.kind,
		targetTitle: link.targetTitle,
		documentId: link.documentId,
		dossierId: link.dossierId,
		expiresAt: link.expiresAt?.toISOString() ?? null,
		hasPassword: link.hasPassword,
		maxViews: link.maxViews,
		views: link.views,
		allowDownload: link.allowDownload,
		revokedAt: link.revokedAt?.toISOString() ?? null,
		createdAt: link.createdAt.toISOString(),
	};
}

function describeShareLink(link: ShareLinkJson): string {
	const parts = [`${link.url} → ${link.kind} "${link.targetTitle}"`];
	if (link.expiresAt) parts.push(`expires ${link.expiresAt}`);
	if (link.hasPassword) parts.push("password protected");
	if (link.maxViews !== null)
		parts.push(`${link.views}/${link.maxViews} views`);
	if (!link.allowDownload) parts.push("no download");
	if (link.revokedAt) parts.push("revoked");
	return parts.join(", ");
}

export function registerSharingTools(
	server: McpServer,
	context: McpContext,
): void {
	defineTool(
		server,
		"list_share_links",
		{
			title: "List share links",
			description:
				"Public links onto a document or a dossier, with their expiry, quota and view counter. Filter by `documentId` or `dossierId`.",
			inputSchema: {
				documentId: z.string().min(1).optional(),
				dossierId: z.string().min(1).optional(),
				includeInactive: mcpBoolean
					.optional()
					.describe("Also returns revoked links (default: false)."),
			},
			outputSchema: { links: z.array(shareLinkJson) },
			text: (output) =>
				output.links.length === 0
					? "No share link."
					: output.links
							.map((link) => `- ${describeShareLink(link)}`)
							.join("\n"),
		},
		async (input) => {
			const links = await listShareLinks(context.db, {
				documentId: input.documentId,
				dossierId: input.dossierId,
				includeInactive: input.includeInactive ?? false,
			});
			return { links: links.map(toShareLinkJson) };
		},
	);

	defineTool(
		server,
		"create_share_link",
		{
			title: "Create a share link",
			description:
				"Opens a public URL onto one document or one dossier (exactly one of the two). A sensitive document — or a dossier holding one — is refused. Hand the URL only to the person it is meant for: the token is the only key.",
			inputSchema: {
				documentId: z.string().min(1).optional(),
				dossierId: z.string().min(1).optional(),
				expiresAt: futureDatetimeSchema
					.optional()
					.describe("ISO 8601, in the future; absent = never expires."),
				password: z.string().min(4).max(200).optional(),
				maxViews: z.number().int().min(1).max(100_000).optional(),
				allowDownload: mcpBoolean
					.optional()
					.describe("false = metadata only, files stay out of reach."),
			},
			outputSchema: shareLinkJson.shape,
			text: (output) => `Share link created: ${describeShareLink(output)}`,
		},
		async (input) => {
			requireWrite(context);
			if (Boolean(input.documentId) === Boolean(input.dossierId)) {
				throw new McpToolError(
					"Provide exactly one of `documentId` or `dossierId`.",
				);
			}
			const { link } = await createShareLink(
				context.db,
				context.principal.userId,
				{
					documentId: input.documentId,
					dossierId: input.dossierId,
					expiresAt: input.expiresAt,
					password: input.password,
					maxViews: input.maxViews,
					allowDownload: input.allowDownload ?? true,
				},
			);
			return toShareLinkJson(link);
		},
	);

	defineTool(
		server,
		"revoke_share_link",
		{
			title: "Revoke a share link",
			description:
				"The public URL answers 410 from then on. The link stays listed, so the revocation is auditable.",
			inputSchema: { id: z.string().min(1).describe("Share link identifier") },
			outputSchema: shareLinkJson.shape,
			text: (output) => `Share link revoked: ${output.url}`,
		},
		async (input) => {
			requireWrite(context);
			return toShareLinkJson(await revokeShareLink(context.db, input.id));
		},
	);

	defineTool(
		server,
		"export_documents",
		{
			title: "Preview a tree export",
			description:
				"Counts what a ZIP export of the selection would contain and shows the first rendered paths. It does not return the archive: download it with `POST /api/export` using the same body.",
			inputSchema: {
				filters: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("Same filters as `search_documents` (no pagination)."),
				template: z
					.string()
					.min(1)
					.max(300)
					.optional()
					.describe("Title template, e.g. `{date} - {issuer} - {title}`."),
				layout: exportLayoutSchema.optional(),
				includeMetadata: mcpBoolean.optional(),
				includeSensitive: mcpBoolean.optional(),
			},
			outputSchema: {
				count: z.number(),
				bytes: z.number(),
				sample: z.array(z.string()),
				truncated: z.boolean(),
				downloadWith: z.string(),
			},
			text: (output) =>
				output.count === 0
					? "The selection is empty: nothing to export."
					: `${output.count} document(s), ${Math.round(output.bytes / 1024)} KB${output.truncated ? " (selection truncated)" : ""}:\n${output.sample.map((path) => `- ${path}`).join("\n")}`,
		},
		async (input) => {
			const parsed = exportDocumentsInput.safeParse({
				filters: input.filters ?? {},
				template: input.template,
				layout: input.layout,
				includeMetadata: input.includeMetadata,
				includeSensitive: input.includeSensitive,
			});
			if (!parsed.success) {
				throw new McpToolError(parsed.error.message);
			}
			const preview = await previewExport(context.db, parsed.data);
			return { ...preview, downloadWith: "POST /api/export" };
		},
	);

	defineTool(
		server,
		"assign_asn",
		{
			title: "Assign an archive serial number",
			description:
				"Gives the document the next free ASN (the number written on the paper folder). A document that already carries one is returned unchanged.",
			inputSchema: { id: z.string().min(1).describe("Document identifier") },
			outputSchema: documentDetailJson.shape,
			text: (output) => `ASN ${output.asn} — ${describeDocument(output)}`,
		},
		async (input) => {
			requireWrite(context);
			return toDocumentDetail(await assignAsn(context.db, input.id));
		},
	);

	defineTool(
		server,
		"find_by_asn",
		{
			title: "Find a document by ASN",
			description:
				"Looks up the document filed under this archive serial number. Without `asn`, returns the next free number instead.",
			inputSchema: {
				asn: z
					.number()
					.int()
					.min(1)
					.optional()
					.describe("Archive serial number; omit to get the next free one."),
			},
			outputSchema: {
				nextAsn: z.number().nullable(),
				document: documentDetailJson.nullable(),
			},
			text: (output) =>
				output.document
					? describeDocument(output.document)
					: `Next free ASN: ${output.nextAsn}.`,
		},
		async (input) => {
			if (input.asn === undefined) {
				const { next } = await nextAsn(context.db);
				return { nextAsn: next, document: null };
			}
			return {
				nextAsn: null,
				document: toDocumentDetail(
					await getDocumentByAsn(context.db, input.asn),
				),
			};
		},
	);
}
