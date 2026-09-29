import {
	maskSensitiveDocument,
	type ScopedCaller,
} from "@docstore/shared/api-key";
import type {
	DocumentDetail,
	DocumentGetResult,
	DocumentListItem,
} from "@docstore/shared/document";
import type { Party, PartyDetail } from "@docstore/shared/party";
import { maskParty } from "@docstore/shared/party-masking";
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
	logoKey: z.string().nullable(),
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
	/** Last change of any kind: the cursor of `search_documents.updatedSince`. */
	updatedAt: z.string(),
	/** Non-null while the document sits in the trash. */
	deletedAt: z.string().nullable(),
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
		updatedAt: item.updatedAt.toISOString(),
		deletedAt: iso(item.deletedAt),
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
			logoKey: party.logoKey,
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

/** Note of an external system (the life wiki) referencing the document. */
export const documentExternalRefJson = z.object({
	system: z.string(),
	ref: z.string(),
	url: z.string().nullable(),
	label: z.string().nullable(),
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
	/** `manual` or `auto`: who handed the archive serial number out. */
	asnSource: z.string(),
	physicalLocation: z.string().nullable(),
	/** Free-text notes typed by a human, in light Markdown. */
	notes: z.string().nullable(),
	/**
	 * `true` when the document is sensitive and the API key lacks the
	 * `sensitive` scope: `fieldValues` is then empty and `notes` null, whatever
	 * the document holds (the OCR text is masked the same way).
	 */
	masked: z.boolean(),
	/** Fields a human set by hand: the ingestion never rewrites them. */
	manualFields: z.array(z.string()),
	source: z.string(),
	processingError: z.string().nullable(),
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
	/** Notes of external systems citing the document, by system then ref. */
	externalRefs: z.array(documentExternalRefJson),
	documentType: documentTypeJson.nullable(),
});
export type DocumentDetailJson = z.infer<typeof documentDetailJson>;

/**
 * `get_document` and the `docstore://document/{id}` resource: the detail plus
 * the stable URLs a citation keeps (issue #2).
 */
export const documentGetJson = documentDetailJson.extend({
	/** Page of the document in the web app, for humans. */
	webUrl: z.string(),
	/** Primary file (`GET /d/<id>`), with the same API key. */
	fileUrl: z.string(),
	/** The id asked for, when it was merged into this document. */
	redirectedFrom: z.string().nullable(),
});
export type DocumentGetJson = z.infer<typeof documentGetJson>;

export function toDocumentGet(
	result: DocumentGetResult,
	caller: ScopedCaller,
): DocumentGetJson {
	return {
		...toDocumentDetail(result, caller),
		webUrl: result.webUrl,
		fileUrl: result.fileUrl,
		redirectedFrom: result.redirectedFrom,
	};
}

/**
 * Every document an MCP tool or resource returns goes through here, so the
 * masking of a sensitive document (issue #22) cannot be forgotten by a tool:
 * `caller` is the principal of the server.
 */
export function toDocumentDetail(
	unmasked: DocumentDetail,
	caller: ScopedCaller,
): DocumentDetailJson {
	const detail = maskSensitiveDocument(unmasked, caller);
	return {
		...toDocumentSummary({
			id: detail.id,
			title: detail.title,
			status: detail.status,
			documentDate: detail.documentDate,
			datePrecision: detail.datePrecision,
			sensitive: detail.sensitive,
			createdAt: detail.createdAt,
			updatedAt: detail.updatedAt,
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
			mime: null,
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
		asnSource: detail.asnSource,
		physicalLocation: detail.physicalLocation,
		notes: detail.notes,
		masked: detail.masked,
		manualFields: detail.manualFields,
		source: detail.source,
		processingError: detail.processingError,
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
		externalRefs: detail.externalRefs.map((item) => ({
			system: item.system,
			ref: item.ref,
			url: item.url,
			label: item.label,
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
	/**
	 * True when identifiers or notes were withheld because the key lacks the
	 * `sensitive` scope (issue #23).
	 */
	masked: z.boolean(),
	archivedAt: z.string().nullable(),
	createdAt: z.string(),
});
export type PartyJson = z.infer<typeof partyJson>;

/**
 * `caller` is required so that no tool can serve a Party without going
 * through `maskParty` (issue #23).
 */
export function toParty(row: Party, caller: ScopedCaller): PartyJson {
	const party = maskParty(row, caller);
	return {
		id: party.id,
		name: party.name,
		type: party.type,
		aliases: party.aliases,
		identifiers: party.identifiers,
		isHouseholdMember: party.isHouseholdMember,
		notes: party.notes,
		masked: party.masked,
		archivedAt: iso(party.archivedAt),
		createdAt: party.createdAt.toISOString(),
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

export function toPartyDetail(
	detail: PartyDetail,
	caller: ScopedCaller,
): PartyDetailJson {
	return {
		...toParty(detail, caller),
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
	if (item.deletedAt) parts.push("in the trash");
	if (item.sensitive) parts.push("sensitive");
	return parts.join(" · ");
}

/** Detail line, then the redirect and the stable URLs of `get_document`. */
export function describeDocumentGet(item: DocumentGetJson): string {
	const lines = [describeDocumentDetail(item)];
	if (item.redirectedFrom) {
		lines.push(`${item.redirectedFrom} was merged into ${item.id}`);
	}
	lines.push(`page: ${item.webUrl}`, `file: ${item.fileUrl}`);
	for (const ref of item.externalRefs) {
		const label = ref.label ? ` (${ref.label})` : "";
		lines.push(`referenced by ${ref.system}: ${ref.ref}${label}`);
	}
	return lines.join("\n");
}

/** Same line, plus the document type the document belongs to. */
export function describeDocumentDetail(item: DocumentDetailJson): string {
	const base = describeDocument(item);
	const line = item.masked
		? `${base}\ncustom fields and notes masked: \`sensitive\` scope required`
		: base;
	const type = item.documentType;
	if (!type) return line;
	const period = type.period ? ` ${type.period}` : "";
	const layout = type.layoutName ? `, layout ${type.layoutName}` : "";
	const kind = type.membership === "computed" ? "" : ` (${type.membership})`;
	return `${line}\ndocument type: ${type.name}${period}${kind}${layout}`;
}
