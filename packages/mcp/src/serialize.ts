import type {
	DocumentDetail,
	DocumentListItem,
} from "@docstore/shared/document";
import type { Party, PartyDetail } from "@docstore/shared/party";
import type { ReviewItem } from "@docstore/shared/review";
import { z } from "zod";

/**
 * Conversion of the `@docstore/api` DTOs into JSON transportable over MCP.
 *
 * The SDK validates `structuredContent` *before* JSON serialisation: `Date`
 * values must therefore already be ISO strings on the output side.
 */

function iso(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}

export const categorySummaryJson = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string().nullable(),
	source: z.string(),
	confidence: z.number().nullable(),
});

export const tagSummaryJson = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string().nullable(),
	source: z.string(),
	confidence: z.number().nullable(),
});

export const partyLinkJson = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	role: z.string(),
	source: z.string(),
	confidence: z.number().nullable(),
});

/** Search result row: enough to decide without loading the full detail. */
export const documentSummaryJson = z.object({
	id: z.string(),
	title: z.string(),
	status: z.string(),
	documentDate: z.string().nullable(),
	datePrecision: z.string().nullable(),
	sensitive: z.boolean(),
	createdAt: z.string(),
	category: categorySummaryJson.nullable(),
	tags: z.array(tagSummaryJson),
	parties: z.array(partyLinkJson),
});
export type DocumentSummaryJson = z.infer<typeof documentSummaryJson>;

export function toDocumentSummary(item: DocumentListItem): DocumentSummaryJson {
	return {
		id: item.id,
		title: item.title,
		status: item.status,
		documentDate: item.documentDate,
		datePrecision: item.datePrecision,
		sensitive: item.sensitive,
		createdAt: item.createdAt.toISOString(),
		category: item.category,
		tags: item.tags.map((tag) => ({
			id: tag.id,
			name: tag.name,
			color: tag.color,
			source: tag.source,
			confidence: tag.confidence,
		})),
		parties: item.parties.map((party) => ({
			id: party.id,
			name: party.name,
			type: party.type,
			role: party.role,
			source: party.source,
			confidence: party.confidence,
		})),
	};
}

export const reviewItemJson = documentSummaryJson.extend({
	reviewReasons: z.array(
		z.object({
			code: z.string(),
			message: z.string(),
			confidence: z.number().nullable(),
			field: z.string().nullable(),
		}),
	),
});
export type ReviewItemJson = z.infer<typeof reviewItemJson>;

export function toReviewItem(item: ReviewItem): ReviewItemJson {
	return {
		...toDocumentSummary(item),
		reviewReasons: item.reviewReasons.map((reason) => ({
			code: reason.code,
			message: reason.message,
			confidence: reason.confidence ?? null,
			field: reason.field ?? null,
		})),
	};
}

export const documentFileJson = z.object({
	id: z.string(),
	kind: z.string(),
	filename: z.string(),
	mime: z.string(),
	size: z.number(),
	pageCount: z.number().nullable(),
});

export const documentFieldValueJson = z.object({
	fieldId: z.string(),
	fieldName: z.string(),
	fieldSlug: z.string(),
	value: z.unknown(),
	source: z.string(),
	confidence: z.number().nullable(),
});

/** Relation to another document, seen from the document being viewed. */
export const documentRelationJson = z.object({
	id: z.string(),
	kind: z.string(),
	direction: z.string(),
	documentId: z.string(),
	documentTitle: z.string(),
	documentDate: z.string().nullable(),
});

/** Dossier a document belongs to. */
export const documentDossierJson = z.object({
	id: z.string(),
	name: z.string(),
	status: z.string(),
});

/** Document type of a document, and the period it covers in it. */
export const documentTypeJson = z.object({
	id: z.string(),
	name: z.string(),
	source: z.string(),
	confidence: z.number().nullable(),
	layoutId: z.string().nullable(),
	layoutName: z.string().nullable(),
	period: z.string().nullable(),
	membership: z.string(),
});

/** Full detail, without the OCR text (`get_document_text` handles that). */
export const documentDetailJson = documentSummaryJson.extend({
	periodStart: z.string().nullable(),
	periodEnd: z.string().nullable(),
	receivedAt: z.string().nullable(),
	validFrom: z.string().nullable(),
	validUntil: z.string().nullable(),
	asn: z.number().nullable(),
	physicalLocation: z.string().nullable(),
	/** Fields a human set by hand: the ingestion never rewrites them. */
	manualFields: z.array(z.string()),
	source: z.string(),
	processingError: z.string().nullable(),
	updatedAt: z.string(),
	deletedAt: z.string().nullable(),
	hasText: z.boolean(),
	reviewReasons: z.array(
		z.object({
			code: z.string(),
			message: z.string(),
			field: z.string().nullable(),
		}),
	),
	files: z.array(documentFileJson),
	fieldValues: z.array(documentFieldValueJson),
	relations: z.array(documentRelationJson),
	dossiers: z.array(documentDossierJson),
	documentType: documentTypeJson.nullable(),
});
export type DocumentDetailJson = z.infer<typeof documentDetailJson>;

export function toDocumentDetail(detail: DocumentDetail): DocumentDetailJson {
	return {
		...toDocumentSummary({
			id: detail.id,
			title: detail.title,
			status: detail.status,
			documentDate: detail.documentDate,
			datePrecision: detail.datePrecision,
			sensitive: detail.sensitive,
			createdAt: detail.createdAt,
			deletedAt: detail.deletedAt,
			parties: detail.parties,
			category: detail.category,
			tags: detail.tags,
			documentType: detail.documentType
				? {
						id: detail.documentType.id,
						name: detail.documentType.name,
						color: detail.documentType.color,
					}
				: null,
			thumbnailFileId: null,
			thumbnailKey: null,
			pageCount: null,
		}),
		periodStart: detail.periodStart,
		periodEnd: detail.periodEnd,
		receivedAt: detail.receivedAt,
		validFrom: detail.validFrom,
		validUntil: detail.validUntil,
		asn: detail.asn,
		physicalLocation: detail.physicalLocation,
		manualFields: detail.manualFields,
		source: detail.source,
		processingError: detail.processingError,
		updatedAt: detail.updatedAt.toISOString(),
		deletedAt: iso(detail.deletedAt),
		hasText: Boolean(detail.content && detail.content.length > 0),
		reviewReasons: detail.reviewReasons.map((reason) => ({
			code: reason.code,
			message: reason.message,
			field: reason.field ?? null,
		})),
		files: detail.files.map((file) => ({
			id: file.id,
			kind: file.kind,
			filename: file.filename,
			mime: file.mime,
			size: file.size,
			pageCount: file.pageCount,
		})),
		fieldValues: detail.fieldValues.map((value) => ({
			fieldId: value.fieldId,
			fieldName: value.field.name,
			fieldSlug: value.field.slug,
			value: value.value,
			source: value.source,
			confidence: value.confidence,
		})),
		relations: detail.relations.map((relation) => ({
			id: relation.id,
			kind: relation.kind,
			direction: relation.direction,
			documentId: relation.document.id,
			documentTitle: relation.document.title,
			documentDate: relation.document.documentDate,
		})),
		dossiers: detail.dossiers.map((item) => ({
			id: item.id,
			name: item.name,
			status: item.status,
		})),
		documentType: detail.documentType
			? {
					id: detail.documentType.id,
					name: detail.documentType.name,
					source: detail.documentType.source,
					confidence: detail.documentType.confidence,
					layoutId: detail.documentType.layout?.id ?? null,
					layoutName: detail.documentType.layout?.name ?? null,
					period: detail.documentType.period,
					membership: detail.documentType.membership,
				}
			: null,
	};
}

export const partyJson = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	aliases: z.array(z.string()),
	identifiers: z.record(z.string(), z.unknown()),
	isHouseholdMember: z.boolean(),
	notes: z.string().nullable(),
	archivedAt: z.string().nullable(),
	createdAt: z.string(),
});
export type PartyJson = z.infer<typeof partyJson>;

export function toParty(row: Party): PartyJson {
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		aliases: row.aliases,
		identifiers: row.identifiers,
		isHouseholdMember: row.isHouseholdMember,
		notes: row.notes,
		archivedAt: iso(row.archivedAt),
		createdAt: row.createdAt.toISOString(),
	};
}

export const partyDetailJson = partyJson.extend({
	documentCount: z.number(),
	relations: z.array(
		z.object({
			id: z.string(),
			kind: z.string(),
			direction: z.enum(["from", "to"]),
			otherPartyId: z.string(),
			otherPartyName: z.string(),
		}),
	),
});
export type PartyDetailJson = z.infer<typeof partyDetailJson>;

export function toPartyDetail(detail: PartyDetail): PartyDetailJson {
	return {
		...toParty(detail),
		documentCount: detail.documentCount,
		relations: [
			...detail.relationsFrom.map((relation) => ({
				id: relation.id,
				kind: relation.kind,
				direction: "from" as const,
				otherPartyId: relation.otherParty.id,
				otherPartyName: relation.otherParty.name,
			})),
			...detail.relationsTo.map((relation) => ({
				id: relation.id,
				kind: relation.kind,
				direction: "to" as const,
				otherPartyId: relation.otherParty.id,
				otherPartyName: relation.otherParty.name,
			})),
		],
	};
}

/** A human-readable line for the text block of the results. */
export function describeDocument(item: DocumentSummaryJson): string {
	const parts = [`${item.id} — ${item.title}`];
	if (item.documentDate) parts.push(`dated ${item.documentDate}`);
	if (item.category) parts.push(`category ${item.category.name}`);
	const issuer = item.parties.find((party) => party.role === "issuer");
	if (issuer) parts.push(`issuer ${issuer.name}`);
	if (item.tags.length > 0) {
		parts.push(`tags ${item.tags.map((tag) => tag.name).join(", ")}`);
	}
	parts.push(`status ${item.status}`);
	if (item.sensitive) parts.push("sensitive");
	return parts.join(" · ");
}

/** Same line, plus the document type the document belongs to. */
export function describeDocumentDetail(item: DocumentDetailJson): string {
	const line = describeDocument(item);
	const type = item.documentType;
	if (!type) return line;
	const period = type.period ? ` ${type.period}` : "";
	const layout = type.layoutName ? `, layout ${type.layoutName}` : "";
	const kind = type.membership === "computed" ? "" : ` (${type.membership})`;
	return `${line}\ndocument type: ${type.name}${period}${kind}${layout}`;
}
