import {
	applyDocumentType,
	createDocumentTypeFromDocument,
	getDocumentType,
	listDocumentTypes,
} from "@docstore/api/services/document-type.service";
import {
	addDossierDocuments,
	closeDossier,
	createDossier,
	listDossiers,
	removeDossierDocument,
	reopenDossier,
} from "@docstore/api/services/dossier.service";
import { listExtractionRules } from "@docstore/api/services/extraction-rule.service";
import { addRelation } from "@docstore/api/services/relation.service";
import { listReminders } from "@docstore/api/services/reminder.service";
import { listSavedSearches } from "@docstore/api/services/saved-search.service";
import { dateOnlySchema } from "@docstore/shared/common";
import { periodicitySchema } from "@docstore/shared/recurrence";
import { documentRelationKindSchema } from "@docstore/shared/relation";
import {
	reminderKindSchema,
	reminderStatusSchema,
} from "@docstore/shared/reminder";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "./context";
import { defineTool, requireWrite } from "./context";
import { mcpBoolean } from "./schema";

/**
 * "Collections" tools: document types, dossiers, reminders, relations and
 * saved searches. They give the agent what it needs to spot a missing document,
 * file it away, link it and track due dates.
 */

const documentTypeJson = z.object({
	id: z.string(),
	name: z.string(),
	/** `null` for a type without recurrence. */
	periodicity: z.string().nullable(),
	issuerName: z.string().nullable(),
	categoryName: z.string().nullable(),
	enabled: z.boolean(),
	startPeriod: z.string().nullable(),
	endPeriod: z.string().nullable(),
	documentCount: z.number(),
	layoutCount: z.number(),
	expected: z.number().nullable(),
	present: z.number().nullable(),
	missing: z.array(z.string()),
	lastPeriod: z.string().nullable(),
});

const periodJson = z.object({
	period: z.string(),
	status: z.string(),
	dueDate: z.string(),
	documentId: z.string().nullable(),
	documentTitle: z.string().nullable(),
});

const extractionRuleJson = z.object({
	id: z.string(),
	name: z.string(),
	/** `field`, `document_date`, `period`, `valid_until` or `title`. */
	target: z.string(),
	fieldId: z.string().nullable(),
});

const layoutJson = z.object({
	id: z.string(),
	name: z.string(),
	isDefault: z.boolean(),
	validFrom: z.string().nullable(),
	validUntil: z.string().nullable(),
	hasSignature: z.boolean(),
	/** Extraction rules of the layout: they only run when it is selected. */
	extractionRules: z.array(extractionRuleJson),
});

const dossierJson = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	status: z.string(),
	documentCount: z.number(),
});

const reminderJson = z.object({
	id: z.string(),
	kind: z.string(),
	status: z.string(),
	dueDate: z.string(),
	message: z.string(),
	documentId: z.string().nullable(),
	documentTitle: z.string().nullable(),
	documentTypeId: z.string().nullable(),
	documentTypeName: z.string().nullable(),
	period: z.string().nullable(),
});

const savedSearchJson = z.object({
	id: z.string(),
	name: z.string(),
	sortOrder: z.number(),
	filters: z.unknown(),
});

export function registerCollectionTools(
	server: McpServer,
	context: McpContext,
): void {
	defineTool(
		server,
		"list_document_types",
		{
			title: "List document types",
			description:
				'Document types ("the same document we keep receiving"): identity, layouts, and — for the recurring ones (weekly, monthly, quarterly, yearly) — the number of expected, covered and missing periods.',
			inputSchema: {
				query: z.string().trim().min(1).optional(),
				recurringOnly: mcpBoolean
					.optional()
					.describe("Keep only the types carrying a recurrence."),
				includeDisabled: mcpBoolean.optional(),
			},
			outputSchema: { items: z.array(documentTypeJson) },
			text: (output) =>
				output.items
					.map((item) =>
						item.periodicity
							? `- ${item.id} — ${item.name} (${item.periodicity}): ${item.present}/${item.expected} period(s), ${item.missing.length} missing`
							: `- ${item.id} — ${item.name}: ${item.documentCount} document(s)`,
					)
					.join("\n") || "No document type.",
		},
		async (input) => {
			const rows = await listDocumentTypes(context.db, {
				...(input.query ? { query: input.query } : {}),
				recurringOnly: input.recurringOnly ?? false,
				// Disabled types are out of the automatic flow: an agent listing
				// the types wants the ones actually in use.
				includeDisabled: input.includeDisabled ?? false,
			});
			return {
				items: rows.map((row) => ({
					id: row.id,
					name: row.name,
					periodicity: row.periodicity,
					issuerName: row.issuerName,
					categoryName: row.categoryName,
					enabled: row.enabled,
					startPeriod: row.startPeriod,
					endPeriod: row.endPeriod,
					documentCount: row.documentCount,
					layoutCount: row.layoutCount,
					expected: row.stats?.expected ?? null,
					present: row.stats?.present ?? null,
					missing: row.stats?.missing ?? [],
					lastPeriod: row.stats?.lastPeriod ?? null,
				})),
			};
		},
	);

	defineTool(
		server,
		"get_document_type",
		{
			title: "Document type detail",
			description:
				"Identity of a type, its layouts with their extraction rules and — when it is recurring — its period-by-period timeline: `present`, `missing` (past due) or `pending` (not due yet).",
			inputSchema: { documentTypeId: z.string().min(1) },
			outputSchema: {
				type: documentTypeJson,
				layouts: z.array(layoutJson),
				timeline: z.array(periodJson),
			},
			text: (output) =>
				`${output.type.name}: ${output.layouts.length} layout(s), ${output.layouts.reduce(
					(total, layout) => total + layout.extractionRules.length,
					0,
				)} extraction rule(s), ${output.timeline.length} period(s), ${output.type.missing.length} missing.`,
		},
		async (input) => {
			const detail = await getDocumentType(context.db, input.documentTypeId);
			const rules = await listExtractionRules(context.db, {
				documentTypeId: input.documentTypeId,
			});
			return {
				type: {
					id: detail.id,
					name: detail.name,
					periodicity: detail.periodicity,
					issuerName: detail.issuerName,
					categoryName: detail.categoryName,
					enabled: detail.enabled,
					startPeriod: detail.startPeriod,
					endPeriod: detail.endPeriod,
					documentCount: detail.documentCount,
					layoutCount: detail.layoutCount,
					expected: detail.stats?.expected ?? null,
					present: detail.stats?.present ?? null,
					missing: detail.stats?.missing ?? [],
					lastPeriod: detail.stats?.lastPeriod ?? null,
				},
				layouts: detail.layouts.map((layout) => ({
					id: layout.id,
					name: layout.name,
					isDefault: layout.isDefault,
					validFrom: layout.validFrom,
					validUntil: layout.validUntil,
					hasSignature: layout.signature !== null,
					extractionRules: rules
						.filter((rule) => rule.layoutId === layout.id)
						.map((rule) => ({
							id: rule.id,
							name: rule.name,
							target: rule.target.kind,
							fieldId:
								rule.target.kind === "field" ? rule.target.fieldId : null,
						})),
				})),
				timeline: detail.timeline.map((entry) => ({
					period: entry.period,
					status: entry.status,
					dueDate: entry.dueDate,
					documentId: entry.documentId,
					documentTitle: entry.documentTitle,
				})),
			};
		},
	);

	defineTool(
		server,
		"list_missing_periods",
		{
			title: "Missing periods of the recurring types",
			description:
				"Periods with no document, past their due date. Without `documentTypeId`, covers every enabled recurring type.",
			inputSchema: {
				documentTypeId: z.string().min(1).optional(),
				onlyMissing: mcpBoolean
					.optional()
					.describe("Keep only the missing periods (default: true)."),
			},
			outputSchema: {
				items: z.array(
					z.object({
						documentTypeId: z.string(),
						documentTypeName: z.string(),
						periods: z.array(periodJson),
					}),
				),
			},
			text: (output) =>
				output.items
					.map(
						(item) =>
							`- ${item.documentTypeName}: ${
								item.periods.map((period) => period.period).join(", ") ||
								"nothing to report"
							}`,
					)
					.join("\n") || "No recurring document type.",
		},
		async (input) => {
			const onlyMissing = input.onlyMissing ?? true;
			const ids = input.documentTypeId
				? [input.documentTypeId]
				: (
						await listDocumentTypes(context.db, {
							recurringOnly: true,
							includeDisabled: false,
						})
					).map((row) => row.id);

			const items = [];
			for (const id of ids) {
				const detail = await getDocumentType(context.db, id);
				items.push({
					documentTypeId: detail.id,
					documentTypeName: detail.name,
					periods: detail.timeline
						.filter((entry) => !onlyMissing || entry.status === "missing")
						.map((entry) => ({
							period: entry.period,
							status: entry.status,
							dueDate: entry.dueDate,
							documentId: entry.documentId,
							documentTitle: entry.documentTitle,
						})),
				});
			}
			return { items };
		},
	);

	defineTool(
		server,
		"apply_document_type",
		{
			title: "Apply a document type",
			description:
				"Writes the identity of the type onto the documents (category, issuer, subject, tags, sensitive, title), picks a layout and runs its extraction rules.",
			inputSchema: {
				documentTypeId: z.string().min(1),
				documentIds: z.array(z.string().min(1)).min(1).max(500),
				layoutId: z
					.string()
					.min(1)
					.optional()
					.describe("Forces a layout instead of running the selection."),
				force: mcpBoolean
					.optional()
					.describe("Applies the type even when it is disabled."),
			},
			outputSchema: {
				applied: z.number(),
				results: z.array(
					z.object({
						documentId: z.string(),
						applied: z.boolean(),
						layoutId: z.string().nullable(),
						layoutReason: z.string(),
						fieldsWritten: z.number(),
						error: z.string().nullable(),
					}),
				),
			},
			text: (output) =>
				`Type applied to ${output.applied}/${output.results.length} document(s).`,
		},
		async (input) => {
			requireWrite(context);
			return applyDocumentType(
				context.db,
				{
					documentTypeId: input.documentTypeId,
					documentIds: input.documentIds,
					force: input.force ?? false,
					...(input.layoutId ? { layoutId: input.layoutId } : {}),
				},
				context.ingestion ? { ingestion: context.ingestion.ctx } : {},
			);
		},
	);

	defineTool(
		server,
		"create_document_type_from_document",
		{
			title: "Create a document type from a document",
			description:
				"Creates a type prefilled from a document (category, issuer, subject, tags, sensitive) and applies it to that document, which becomes its first sample. Add `periodicity` to make it recurring.",
			inputSchema: {
				documentId: z.string().min(1),
				name: z.string().trim().min(1).max(200).optional(),
				periodicity: periodicitySchema.optional(),
				startPeriod: z.iso
					.date()
					.optional()
					.describe("First period covered; defaults to the document date."),
			},
			outputSchema: {
				id: z.string(),
				name: z.string(),
				periodicity: z.string().nullable(),
				documentCount: z.number(),
			},
			text: (output) =>
				`Document type "${output.name}" created (${output.id}).`,
		},
		async (input) => {
			requireWrite(context);
			const detail = await createDocumentTypeFromDocument(
				context.db,
				{
					documentId: input.documentId,
					...(input.name ? { name: input.name } : {}),
					...(input.periodicity
						? {
								recurrence: {
									periodicity: input.periodicity,
									startPeriod:
										input.startPeriod ?? new Date().toISOString().slice(0, 10),
								},
							}
						: {}),
				},
				context.ingestion ? { ingestion: context.ingestion.ctx } : {},
			);
			return {
				id: detail.id,
				name: detail.name,
				periodicity: detail.periodicity,
				documentCount: detail.documentCount,
			};
		},
	);

	defineTool(
		server,
		"list_dossiers",
		{
			title: "List Dossiers",
			description:
				"Flat, cross-cutting collections, with their document count. Closed Dossiers are hidden unless `includeClosed` is set.",
			inputSchema: {
				includeClosed: mcpBoolean.optional(),
				query: z.string().trim().min(1).optional(),
			},
			outputSchema: { items: z.array(dossierJson) },
			text: (output) =>
				output.items
					.map(
						(item) =>
							`- ${item.id} — ${item.name} (${item.documentCount} document(s)${
								item.status === "closed" ? ", closed" : ""
							})`,
					)
					.join("\n") || "No Dossier.",
		},
		async (input) => {
			const rows = await listDossiers(context.db, {
				includeClosed: input.includeClosed ?? false,
				query: input.query,
			});
			return {
				items: rows.map((row) => ({
					id: row.id,
					name: row.name,
					description: row.description,
					status: row.status,
					documentCount: row.documentCount,
				})),
			};
		},
	);

	defineTool(
		server,
		"add_to_dossier",
		{
			title: "Add documents to a Dossier",
			description:
				"Attaches a list of documents to an existing Dossier; already present attachments are ignored.",
			inputSchema: {
				dossierId: z.string().min(1),
				documentIds: z.array(z.string().min(1)).min(1).max(500),
			},
			outputSchema: dossierJson.shape,
			text: (output) =>
				`Dossier "${output.name}": ${output.documentCount} document(s).`,
		},
		async (input) => {
			requireWrite(context);
			const row = await addDossierDocuments(context.db, {
				id: input.dossierId,
				documentIds: input.documentIds,
			});
			return {
				id: row.id,
				name: row.name,
				description: row.description,
				status: row.status,
				documentCount: row.documentCount,
			};
		},
	);

	defineTool(
		server,
		"create_dossier",
		{
			title: "Create a Dossier",
			description:
				"Opens a flat, cross-cutting collection. Use `add_to_dossier` to fill it; `list_dossiers` first, so an existing one is reused rather than doubled.",
			inputSchema: {
				name: z.string().trim().min(1).max(200),
				description: z.string().trim().max(2000).optional(),
			},
			outputSchema: dossierJson.shape,
			text: (output) => `Dossier "${output.name}" created (${output.id}).`,
		},
		async (input) => {
			requireWrite(context);
			const row = await createDossier(context.db, {
				name: input.name,
				description: input.description,
			});
			return {
				id: row.id,
				name: row.name,
				description: row.description,
				status: row.status,
				// A Dossier is born empty: nothing to count yet.
				documentCount: 0,
			};
		},
	);

	defineTool(
		server,
		"remove_from_dossier",
		{
			title: "Remove a document from a Dossier",
			description:
				"Detaches one document from a Dossier; the document itself is left untouched. Removing the last sensitive document does **not** reopen the share links the Dossier lost: revocation is final.",
			inputSchema: {
				dossierId: z.string().min(1),
				documentId: z.string().min(1),
			},
			outputSchema: dossierJson.shape,
			text: (output) =>
				`Dossier "${output.name}": ${output.documentCount} document(s).`,
		},
		async (input) => {
			requireWrite(context);
			const row = await removeDossierDocument(context.db, {
				id: input.dossierId,
				documentId: input.documentId,
			});
			return {
				id: row.id,
				name: row.name,
				description: row.description,
				status: row.status,
				documentCount: row.documentCount,
			};
		},
	);

	defineTool(
		server,
		"close_dossier",
		{
			title: "Close a Dossier",
			description:
				"A closed Dossier drops out of the default lists but keeps every document it holds. `reopen: true` puts it back among the open ones.",
			inputSchema: {
				dossierId: z.string().min(1),
				reopen: mcpBoolean
					.optional()
					.describe("Reopens the Dossier instead of closing it."),
			},
			outputSchema: dossierJson.shape,
			text: (output) =>
				`Dossier "${output.name}" is now ${output.status} (${output.documentCount} document(s)).`,
		},
		async (input) => {
			requireWrite(context);
			const row = input.reopen
				? await reopenDossier(context.db, input.dossierId)
				: await closeDossier(context.db, input.dossierId);
			return {
				id: row.id,
				name: row.name,
				description: row.description,
				status: row.status,
				documentCount: row.documentCount,
			};
		},
	);

	defineTool(
		server,
		"list_reminders",
		{
			title: "List reminders",
			description:
				"Expiry reminders (`expiry`) and missing periods of the recurring types (`period_gap`), sorted by due date. By default, only pending reminders.",
			inputSchema: {
				status: reminderStatusSchema.optional(),
				kind: reminderKindSchema.optional(),
				upcoming: mcpBoolean
					.optional()
					.describe(
						"false restricts the list to reminders already due (past or today). Defaults to true.",
					),
				dueBefore: dateOnlySchema.optional(),
				limit: z.number().int().min(1).max(500).optional(),
			},
			outputSchema: { items: z.array(reminderJson) },
			text: (output) =>
				output.items
					.map((item) => `- ${item.dueDate} — ${item.message}`)
					.join("\n") || "No reminder.",
		},
		async (input) => {
			const rows = await listReminders(context.db, {
				status: input.status ?? "pending",
				kind: input.kind,
				upcoming: input.upcoming ?? true,
				dueBefore: input.dueBefore,
				limit: input.limit ?? 100,
			});
			return {
				items: rows.map((row) => ({
					id: row.id,
					kind: row.kind,
					status: row.status,
					dueDate: row.dueDate,
					message: row.message,
					documentId: row.documentId,
					documentTitle: row.documentTitle,
					documentTypeId: row.documentTypeId,
					documentTypeName: row.documentTypeName,
					period: row.periodKey,
				})),
			};
		},
	);

	defineTool(
		server,
		"add_document_relation",
		{
			title: "Link two documents",
			description:
				"Kinds: `version_of` (new version), `page_of` (page of a set), `supersedes` (replaces), `related_to` (free association), `fulfills` (invoice <-> contract).",
			inputSchema: {
				fromDocumentId: z.string().min(1),
				toDocumentId: z.string().min(1),
				kind: documentRelationKindSchema,
			},
			outputSchema: {
				id: z.string(),
				fromDocumentId: z.string(),
				toDocumentId: z.string(),
				kind: z.string(),
			},
			text: (output) =>
				`Relation ${output.kind} created: ${output.fromDocumentId} → ${output.toDocumentId}.`,
		},
		async (input) => {
			requireWrite(context);
			const row = await addRelation(context.db, {
				fromDocumentId: input.fromDocumentId,
				toDocumentId: input.toDocumentId,
				kind: input.kind,
			});
			return {
				id: row.id,
				fromDocumentId: row.fromDocumentId,
				toDocumentId: row.toDocumentId,
				kind: row.kind,
			};
		},
	);

	defineTool(
		server,
		"list_saved_searches",
		{
			title: "List saved searches",
			description:
				"Search filters persisted by the user; `filters` can be fed back as-is into `search_documents`.",
			inputSchema: {},
			outputSchema: { items: z.array(savedSearchJson) },
			text: (output) =>
				output.items.map((item) => `- ${item.id} — ${item.name}`).join("\n") ||
				"No saved search.",
		},
		async () => {
			const rows = await listSavedSearches(context.db);
			return {
				items: rows.map((row) => ({
					id: row.id,
					name: row.name,
					sortOrder: row.sortOrder,
					filters: row.filters,
				})),
			};
		},
	);
}
