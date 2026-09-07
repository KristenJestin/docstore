import type { Db } from "@docstore/db";
import { category } from "@docstore/db/schema/category";
import {
	customField,
	documentFieldValue,
} from "@docstore/db/schema/custom-field";
import {
	document,
	documentFile,
	documentParty,
} from "@docstore/db/schema/document";
import { documentType } from "@docstore/db/schema/document-type";
import { documentDossier } from "@docstore/db/schema/dossier";
import { duplicateIgnore } from "@docstore/db/schema/duplicate-ignore";
import { party } from "@docstore/db/schema/party";
import { documentRelation } from "@docstore/db/schema/relation";
import { documentTag } from "@docstore/db/schema/tag";
import type { IngestionContext } from "@docstore/ingestion";
import {
	AsnAllocationError,
	allocateAsn,
	categoryChainIds,
	clearDocumentType,
	computeReviewReasons,
	revokeShareLinksForSensitive,
} from "@docstore/ingestion";
import type { CategorySummary } from "@docstore/shared/category";
import type {
	CustomField,
	CustomFieldValue,
	DocumentFieldFilter,
} from "@docstore/shared/custom-field";
import type {
	AssignmentSource,
	DocumentBulkInput,
	DocumentBulkResult,
	DocumentDetail,
	DocumentDto,
	DocumentDuplicate,
	DocumentFieldValue,
	DocumentFileLayout,
	DocumentListItem,
	DocumentPartyAssignment,
	DocumentPartyLink,
	DocumentPartyRole,
	DocumentSort,
	DocumentStats,
	DocumentStatus,
	DuplicateIgnoreResult,
	IgnoreDuplicateInput,
	ListDocumentDuplicatesInput,
	ListDocumentsInput,
	MergeAsVersionResult,
	NextAsnResult,
	UpdateDocumentInput,
} from "@docstore/shared/document";
import {
	DOCUMENT_STATUSES,
	MANUAL_DOCUMENT_FIELDS,
} from "@docstore/shared/document";
import type { DocumentTypeSummary } from "@docstore/shared/document-type";
import type { Paginated } from "@docstore/shared/pagination";
import { paginationMeta } from "@docstore/shared/pagination";
import { addDays, todayIso } from "@docstore/shared/recurrence";
import type { MergeAsVersionInput } from "@docstore/shared/relation";
import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	sql,
} from "drizzle-orm";
import { assertCategoryExists, categorySubtreeIds } from "./category.service";
import {
	assertFieldAppliesToCategory,
	assertValueMatchesField,
	requireCustomField,
} from "./custom-field.service";
import {
	applyDocumentType as applyDocumentTypeToDocuments,
	documentTypeForDocument,
	documentTypeMemberDocumentIds,
	regenerateTitlesForDocuments,
} from "./document-type.service";
import { listDossiersForDocument } from "./dossier.service";
import {
	loadDocumentRelations,
	requireDocumentIds,
	requireLiveDocumentIds,
} from "./relation.service";
import { generateRemindersForDocument } from "./reminder.service";
import { likePattern } from "./sql-utils";
import { loadTagsByDocument, requireTags } from "./tag.service";

/** Every column of `document` except `search_vector` (internal). */
const documentColumns = {
	id: document.id,
	title: document.title,
	status: document.status,
	documentDate: document.documentDate,
	datePrecision: document.datePrecision,
	dateSource: document.dateSource,
	dateConfidence: document.dateConfidence,
	periodStart: document.periodStart,
	periodEnd: document.periodEnd,
	receivedAt: document.receivedAt,
	validFrom: document.validFrom,
	validUntil: document.validUntil,
	sensitive: document.sensitive,
	asn: document.asn,
	asnSource: document.asnSource,
	physicalLocation: document.physicalLocation,
	content: document.content,
	notes: document.notes,
	categoryId: document.categoryId,
	categorySource: document.categorySource,
	categoryConfidence: document.categoryConfidence,
	categoryConfirmedAt: document.categoryConfirmedAt,
	manualFields: document.manualFields,
	source: document.source,
	reviewReasons: document.reviewReasons,
	processingError: document.processingError,
	createdById: document.createdById,
	createdAt: document.createdAt,
	updatedAt: document.updatedAt,
	deletedAt: document.deletedAt,
};

const documentListColumns = {
	id: document.id,
	title: document.title,
	status: document.status,
	documentDate: document.documentDate,
	datePrecision: document.datePrecision,
	sensitive: document.sensitive,
	createdAt: document.createdAt,
	deletedAt: document.deletedAt,
	categoryId: document.categoryId,
	categorySource: document.categorySource,
	categoryConfidence: document.categoryConfidence,
	categoryConfirmedAt: document.categoryConfirmedAt,
	documentTypeId: document.documentTypeId,
};

const documentFileColumns = {
	id: documentFile.id,
	documentId: documentFile.documentId,
	kind: documentFile.kind,
	filename: documentFile.filename,
	mime: documentFile.mime,
	size: documentFile.size,
	sha256: documentFile.sha256,
	storageKey: documentFile.storageKey,
	pageCount: documentFile.pageCount,
	encrypted: documentFile.encrypted,
	thumbnailKey: documentFile.thumbnailKey,
	createdAt: documentFile.createdAt,
};

const documentPartyColumns = {
	documentId: documentParty.documentId,
	id: party.id,
	name: party.name,
	type: party.type,
	logoKey: party.logoKey,
	role: documentParty.role,
	source: documentParty.source,
	confidence: documentParty.confidence,
	confirmedAt: documentParty.confirmedAt,
};

/** Postgres dictionary used for indexing and search. */
function frenchQuery(query: string): SQL {
	return sql`websearch_to_tsquery('french', ${query})`;
}

function orderByClause(sort: DocumentSort): SQL[] {
	switch (sort) {
		case "documentDate:asc":
			return [sql`${document.documentDate} asc nulls last`, asc(document.id)];
		case "createdAt:desc":
			return [desc(document.createdAt), asc(document.id)];
		case "createdAt:asc":
			return [asc(document.createdAt), asc(document.id)];
		case "title:asc":
			return [asc(document.title), asc(document.id)];
		case "title:desc":
			return [desc(document.title), asc(document.id)];
		case "validUntil:asc":
			return [sql`${document.validUntil} asc nulls last`, asc(document.id)];
		default:
			return [sql`${document.documentDate} desc nulls last`, asc(document.id)];
	}
}

/**
 * Turns a filter on a custom field value into a SQL condition.
 * The expression extracted from the JSONB depends on the field type.
 */
function fieldFilterCondition(
	field: CustomField,
	filter: DocumentFieldFilter,
): SQL {
	const value = filter.value;
	const jsonText = (key: string) =>
		sql`(${documentFieldValue.value} ->> ${key}::text)`;

	let comparison: SQL;
	switch (field.type) {
		case "number":
		case "money": {
			const column =
				field.type === "number"
					? sql`${jsonText("number")}::numeric`
					: sql`${jsonText("amount")}::numeric`;
			if (typeof value !== "number") {
				throw new ORPCError("BAD_REQUEST", {
					message: `The filter on "${field.name}" expects a numeric value.`,
				});
			}
			if (filter.op === "contains") {
				throw new ORPCError("BAD_REQUEST", {
					message: `The "contains" operator does not apply to the field "${field.name}".`,
				});
			}
			const operand = sql`${String(value)}::numeric`;
			comparison =
				filter.op === "gt"
					? sql`${column} > ${operand}`
					: filter.op === "lt"
						? sql`${column} < ${operand}`
						: sql`${column} = ${operand}`;
			break;
		}
		case "date": {
			if (typeof value !== "string") {
				throw new ORPCError("BAD_REQUEST", {
					message: `The filter on "${field.name}" expects a "YYYY-MM-DD" date.`,
				});
			}
			const column = sql`${jsonText("date")}::date`;
			const operand = sql`${value}::date`;
			comparison =
				filter.op === "gt"
					? sql`${column} > ${operand}`
					: filter.op === "lt"
						? sql`${column} < ${operand}`
						: sql`${column} = ${operand}`;
			break;
		}
		case "boolean": {
			if (typeof value !== "boolean" || filter.op !== "eq") {
				throw new ORPCError("BAD_REQUEST", {
					message: `The field "${field.name}" only supports boolean equality.`,
				});
			}
			comparison = sql`${jsonText("boolean")}::boolean = ${value}`;
			break;
		}
		case "party_ref": {
			if (typeof value !== "string" || filter.op !== "eq") {
				throw new ORPCError("BAD_REQUEST", {
					message: `The field "${field.name}" only supports equality on a Party identifier.`,
				});
			}
			comparison = sql`${jsonText("partyId")} = ${value}`;
			break;
		}
		default: {
			const key =
				field.type === "select"
					? "choice"
					: field.type === "url"
						? "url"
						: "text";
			if (typeof value !== "string") {
				throw new ORPCError("BAD_REQUEST", {
					message: `The filter on "${field.name}" expects a string.`,
				});
			}
			const column = jsonText(key);
			comparison =
				filter.op === "contains"
					? sql`${column} ilike ${likePattern(value)}`
					: filter.op === "gt"
						? sql`${column} > ${value}`
						: filter.op === "lt"
							? sql`${column} < ${value}`
							: sql`${column} = ${value}`;
			break;
		}
	}

	return sql`exists (
		select 1 from ${documentFieldValue}
		where ${documentFieldValue.documentId} = ${document.id}
			and ${documentFieldValue.fieldId} = ${field.id}
			and ${comparison}
	)`;
}

async function fieldFilterConditions(
	db: Db,
	filters: DocumentFieldFilter[],
): Promise<SQL[]> {
	if (filters.length === 0) {
		return [];
	}
	const ids = [...new Set(filters.map((filter) => filter.fieldId))];
	const fields = await db
		.select()
		.from(customField)
		.where(inArray(customField.id, ids));
	const byId = new Map(fields.map((field) => [field.id, field]));

	return filters.map((filter) => {
		const field = byId.get(filter.fieldId);
		if (!field) {
			throw new ORPCError("NOT_FOUND", {
				message: `Custom field "${filter.fieldId}" not found.`,
			});
		}
		return fieldFilterCondition(field, filter);
	});
}

function listConditions(input: ListDocumentsInput): SQL[] {
	const conditions: SQL[] = [];

	if (input.deleted === "exclude") {
		conditions.push(isNull(document.deletedAt));
	} else if (input.deleted === "only") {
		conditions.push(isNotNull(document.deletedAt));
	}
	if (input.status) {
		conditions.push(eq(document.status, input.status));
	}
	if (input.sensitive !== undefined) {
		conditions.push(eq(document.sensitive, input.sensitive));
	}
	if (input.year !== undefined) {
		const year = String(input.year).padStart(4, "0");
		conditions.push(gte(document.documentDate, `${year}-01-01`));
		conditions.push(lte(document.documentDate, `${year}-12-31`));
	}
	if (input.dateFrom) {
		conditions.push(gte(document.documentDate, input.dateFrom));
	}
	if (input.dateTo) {
		conditions.push(lte(document.documentDate, input.dateTo));
	}
	if (input.validUntilFrom) {
		conditions.push(gte(document.validUntil, input.validUntilFrom));
	}
	if (input.validUntilTo) {
		conditions.push(lte(document.validUntil, input.validUntilTo));
	}
	if (input.dossierId) {
		conditions.push(
			sql`exists (
				select 1 from ${documentDossier}
				where ${documentDossier.documentId} = ${document.id}
					and ${documentDossier.dossierId} = ${input.dossierId}
			)`,
		);
	}
	if (input.hasRelation !== undefined) {
		const linked = sql`exists (
			select 1 from ${documentRelation}
			where ${documentRelation.fromDocumentId} = ${document.id}
				or ${documentRelation.toDocumentId} = ${document.id}
		)`;
		conditions.push(input.hasRelation ? linked : sql`not ${linked}`);
	}
	if (input.physicalLocation) {
		conditions.push(
			sql`${document.physicalLocation} ilike ${likePattern(input.physicalLocation)}`,
		);
	}
	if (input.hasAsn !== undefined) {
		conditions.push(
			input.hasAsn ? isNotNull(document.asn) : isNull(document.asn),
		);
	}
	if (input.partyId) {
		conditions.push(
			sql`exists (
				select 1 from ${documentParty}
				where ${documentParty.documentId} = ${document.id}
					and ${documentParty.partyId} = ${input.partyId}
			)`,
		);
	}
	if (input.query) {
		conditions.push(
			sql`${document.searchVector} @@ ${frenchQuery(input.query)}`,
		);
	}

	return conditions;
}

/**
 * Conditions that need a database round-trip: category subtree, required tags
 * and custom field filters.
 */
async function asyncListConditions(
	db: Db,
	input: ListDocumentsInput,
): Promise<SQL[]> {
	const conditions: SQL[] = [];

	if (input.categoryId) {
		const ids = await categorySubtreeIds(db, input.categoryId);
		conditions.push(inArray(document.categoryId, ids));
	}

	if (input.documentTypeId) {
		// Members are computed, not stored: we resolve the list then filter on it
		// (a document type stays modest in size).
		const ids = await documentTypeMemberDocumentIds(db, input.documentTypeId);
		conditions.push(ids.length > 0 ? inArray(document.id, ids) : sql`false`);
	}

	const tagIds = [...new Set(input.tagIds ?? [])];
	for (const tagId of tagIds) {
		// One `exists` per tag: the document must carry all of them.
		conditions.push(
			sql`exists (
				select 1 from ${documentTag}
				where ${documentTag.documentId} = ${document.id}
					and ${documentTag.tagId} = ${tagId}
			)`,
		);
	}

	conditions.push(
		...(await fieldFilterConditions(db, input.fieldFilters ?? [])),
	);

	return conditions;
}

async function loadPartyLinks(
	db: Db,
	documentIds: string[],
): Promise<Map<string, DocumentPartyLink[]>> {
	const result = new Map<string, DocumentPartyLink[]>();
	if (documentIds.length === 0) {
		return result;
	}

	const rows = await db
		.select(documentPartyColumns)
		.from(documentParty)
		.innerJoin(party, eq(party.id, documentParty.partyId))
		.where(inArray(documentParty.documentId, documentIds))
		.orderBy(asc(party.name), asc(documentParty.role));

	for (const row of rows) {
		const { documentId, ...link } = row;
		const bucket = result.get(documentId);
		if (bucket) {
			bucket.push(link);
		} else {
			result.set(documentId, [link]);
		}
	}
	return result;
}

type CategoryBase = { id: string; name: string; color: string | null };

async function loadCategoryBases(
	db: Db,
	categoryIds: string[],
): Promise<Map<string, CategoryBase>> {
	const result = new Map<string, CategoryBase>();
	const unique = [...new Set(categoryIds)];
	if (unique.length === 0) {
		return result;
	}
	const rows = await db
		.select({ id: category.id, name: category.name, color: category.color })
		.from(category)
		.where(inArray(category.id, unique));
	for (const row of rows) {
		result.set(row.id, row);
	}
	return result;
}

/**
 * Builds the category summary of a document: `source`/`confidence` describe
 * *this* document's assignment (`document.category_source`/
 * `category_confidence`), not a property of the category itself.
 */
function categorySummaryOf(
	row: {
		categoryId: string | null;
		categorySource: AssignmentSource;
		categoryConfidence: number | null;
		categoryConfirmedAt: Date | null;
	},
	bases: Map<string, CategoryBase>,
): CategorySummary | null {
	if (!row.categoryId) return null;
	const base = bases.get(row.categoryId);
	if (!base) return null;
	return {
		...base,
		source: row.categorySource,
		confidence: row.categoryConfidence,
		confirmedAt: row.categoryConfirmedAt,
	};
}

/** Names and colors of the document types carried by a page of results. */
async function loadDocumentTypeSummaries(
	db: Db,
	documentTypeIds: string[],
): Promise<Map<string, DocumentTypeSummary>> {
	const result = new Map<string, DocumentTypeSummary>();
	const unique = [...new Set(documentTypeIds)];
	if (unique.length === 0) {
		return result;
	}
	const rows = await db
		.select({
			id: documentType.id,
			name: documentType.name,
			color: documentType.color,
		})
		.from(documentType)
		.where(inArray(documentType.id, unique));
	for (const row of rows) {
		result.set(row.id, row);
	}
	return result;
}

/** Custom field values of a document, together with their definition. */
async function loadFieldValues(
	db: Db,
	documentId: string,
): Promise<DocumentFieldValue[]> {
	const rows = await db
		.select({
			fieldId: documentFieldValue.fieldId,
			value: documentFieldValue.value,
			confidence: documentFieldValue.confidence,
			source: documentFieldValue.source,
			confirmedAt: documentFieldValue.confirmedAt,
			updatedAt: documentFieldValue.updatedAt,
			field: customField,
		})
		.from(documentFieldValue)
		.innerJoin(customField, eq(customField.id, documentFieldValue.fieldId))
		.where(eq(documentFieldValue.documentId, documentId))
		.orderBy(asc(customField.sortOrder), asc(customField.name));
	return rows;
}

type FileSummary = {
	fileId: string;
	thumbnailKey: string | null;
	pageCount: number | null;
};

/** Keeps the `original` file of each document, otherwise the oldest one. */
async function loadPrimaryFiles(
	db: Db,
	documentIds: string[],
): Promise<Map<string, FileSummary>> {
	const result = new Map<string, FileSummary>();
	if (documentIds.length === 0) {
		return result;
	}

	const rows = await db
		.select({
			id: documentFile.id,
			documentId: documentFile.documentId,
			kind: documentFile.kind,
			thumbnailKey: documentFile.thumbnailKey,
			pageCount: documentFile.pageCount,
		})
		.from(documentFile)
		.where(inArray(documentFile.documentId, documentIds))
		.orderBy(asc(documentFile.createdAt), asc(documentFile.id));

	const hasOriginal = new Set<string>();
	for (const row of rows) {
		const isOriginal = row.kind === "original";
		if (
			!result.has(row.documentId) ||
			(isOriginal && !hasOriginal.has(row.documentId))
		) {
			result.set(row.documentId, {
				fileId: row.id,
				thumbnailKey: row.thumbnailKey,
				pageCount: row.pageCount,
			});
		}
		if (isOriginal) {
			hasOriginal.add(row.documentId);
		}
	}
	return result;
}

export async function listDocuments(
	db: Db,
	input: ListDocumentsInput,
): Promise<Paginated<DocumentListItem>> {
	const conditions = [
		...listConditions(input),
		...(await asyncListConditions(db, input)),
	];
	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const totalRows = await db
		.select({ value: count() })
		.from(document)
		.where(where);
	const total = totalRows[0]?.value ?? 0;

	const orderBy = input.query
		? [
				desc(
					sql`ts_rank(${document.searchVector}, ${frenchQuery(input.query)})`,
				),
				sql`${document.documentDate} desc nulls last`,
				asc(document.id),
			]
		: orderByClause(input.sort);

	const rows = await db
		.select(documentListColumns)
		.from(document)
		.where(where)
		.orderBy(...orderBy)
		.limit(input.pageSize)
		.offset((input.page - 1) * input.pageSize);

	const ids = rows.map((row) => row.id);
	const [partyLinks, primaryFiles, tagLinks, categoryBases, documentTypes] =
		await Promise.all([
			loadPartyLinks(db, ids),
			loadPrimaryFiles(db, ids),
			loadTagsByDocument(db, ids),
			loadCategoryBases(
				db,
				rows
					.map((row) => row.categoryId)
					.filter((value): value is string => value !== null),
			),
			loadDocumentTypeSummaries(
				db,
				rows
					.map((row) => row.documentTypeId)
					.filter((value): value is string => value !== null),
			),
		]);

	const items: DocumentListItem[] = rows.map((row) => {
		const file = primaryFiles.get(row.id);
		const {
			categoryId,
			categorySource,
			categoryConfidence,
			categoryConfirmedAt,
			documentTypeId,
			...rest
		} = row;
		return {
			...rest,
			parties: partyLinks.get(row.id) ?? [],
			tags: tagLinks.get(row.id) ?? [],
			category: categorySummaryOf(row, categoryBases),
			documentType: documentTypeId
				? (documentTypes.get(documentTypeId) ?? null)
				: null,
			thumbnailFileId: file?.fileId ?? null,
			thumbnailKey: file?.thumbnailKey ?? null,
			pageCount: file?.pageCount ?? null,
		};
	});

	return { items, ...paginationMeta(total, input.page, input.pageSize) };
}

/**
 * `DocumentDto` plus the two internal columns needed to build the category
 * summary (`getDocument`); every other caller only cares about the `DocumentDto`
 * fields, to which this is assignable.
 */
type DocumentRow = DocumentDto & {
	categorySource: AssignmentSource;
	categoryConfidence: number | null;
	categoryConfirmedAt: Date | null;
};

async function requireDocument(db: Db, id: string): Promise<DocumentRow> {
	const rows = await db
		.select(documentColumns)
		.from(document)
		.where(eq(document.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${id}" not found.`,
		});
	}
	return row;
}

/** Refused on a trashed document (SPEC §2: the trash is read-only). */
export const TRASHED_DOCUMENT_MESSAGE =
	"Document is in the trash; restore it first.";

/**
 * A document in the trash accepts nothing but `restore` and the permanent
 * delete: editing it would silently resurrect data the user meant to drop.
 */
export function assertNotTrashed(row: { deletedAt: Date | null }): void {
	if (row.deletedAt) {
		throw new ORPCError("CONFLICT", { message: TRASHED_DOCUMENT_MESSAGE });
	}
}

/** Loads a document and refuses it when it sits in the trash. */
export async function requireLiveDocument(
	db: Db,
	id: string,
): Promise<DocumentRow> {
	const row = await requireDocument(db, id);
	assertNotTrashed(row);
	return row;
}

export async function getDocument(db: Db, id: string): Promise<DocumentDetail> {
	const row = await requireDocument(db, id);

	const [
		files,
		partyLinks,
		tagLinks,
		fieldValues,
		categoryBases,
		relations,
		dossiers,
		documentTypeMembership,
	] = await Promise.all([
		db
			.select(documentFileColumns)
			.from(documentFile)
			.where(eq(documentFile.documentId, id))
			.orderBy(asc(documentFile.createdAt), asc(documentFile.id)),
		loadPartyLinks(db, [id]),
		loadTagsByDocument(db, [id]),
		loadFieldValues(db, id),
		loadCategoryBases(db, row.categoryId ? [row.categoryId] : []),
		loadDocumentRelations(db, id),
		listDossiersForDocument(db, id),
		documentTypeForDocument(db, id),
	]);

	return {
		...row,
		files,
		parties: partyLinks.get(id) ?? [],
		tags: tagLinks.get(id) ?? [],
		fieldValues,
		category: categorySummaryOf(row, categoryBases),
		relations,
		dossiers,
		documentType: documentTypeMembership,
	};
}

/**
 * Duplicate resolution (SPEC §5 "intake"): `documentId` is absorbed by
 * `intoDocumentId`. Its files join the kept document as attachments — changing
 * `kind` also frees the sha256 uniqueness of originals —, a `version_of`
 * relation is created and the duplicate goes to the trash.
 */
export async function mergeAsVersion(
	db: Db,
	input: MergeAsVersionInput,
): Promise<MergeAsVersionResult> {
	if (input.documentId === input.intoDocumentId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "A document cannot be merged with itself.",
		});
	}
	// Both ends are written to: the duplicate loses its files and goes to the
	// trash, the kept one gains them. Neither may already sit there (SPEC §2).
	await requireLiveDocumentIds(db, [input.documentId, input.intoDocumentId]);

	const movedFiles = await db.transaction(async (tx) => {
		const moved = await tx
			.update(documentFile)
			.set({ documentId: input.intoDocumentId, kind: "attachment" })
			.where(eq(documentFile.documentId, input.documentId))
			.returning({ id: documentFile.id });

		await tx
			.insert(documentRelation)
			.values({
				fromDocumentId: input.documentId,
				toDocumentId: input.intoDocumentId,
				kind: "version_of",
			})
			.onConflictDoNothing();

		await tx
			.update(document)
			.set({ deletedAt: new Date() })
			.where(eq(document.id, input.documentId));

		return moved.length;
	});

	return {
		target: await getDocument(db, input.intoDocumentId),
		trashedId: input.documentId,
		movedFiles,
	};
}

/** `ocr_layout` is bulky: only this procedure returns it. */
export async function getDocumentFileLayout(
	db: Db,
	fileId: string,
): Promise<DocumentFileLayout> {
	const rows = await db
		.select({
			fileId: documentFile.id,
			documentId: documentFile.documentId,
			pageCount: documentFile.pageCount,
			ocrLayout: documentFile.ocrLayout,
		})
		.from(documentFile)
		.where(eq(documentFile.id, fileId))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `File "${fileId}" not found.`,
		});
	}
	return { ...row, ocrLayout: row.ocrLayout ?? null };
}

function pick<T>(patched: T | null | undefined, current: T | null): T | null {
	return patched === undefined ? current : (patched ?? null);
}

/**
 * Cross validations: precision required together with a date, and consistent
 * period / validity bounds once the patch is applied.
 *
 * The date pair is judged on the **patch**, not on the state it lands on: rows
 * written before the `fix-orphan-date-precision` migration can carry a
 * precision without a date, and validating the resulting state would make every
 * one of them impossible to edit — even to fix the very inconsistency.
 */
function assertConsistentDates(
	current: DocumentDto,
	input: UpdateDocumentInput,
): void {
	const documentDate = pick(input.documentDate, current.documentDate);
	// Clearing the date clears the precision with it: a precision on its own
	// describes nothing.
	const datePrecision =
		input.documentDate === null && input.datePrecision === undefined
			? null
			: pick(input.datePrecision, current.datePrecision);
	const periodStart = pick(input.periodStart, current.periodStart);
	const periodEnd = pick(input.periodEnd, current.periodEnd);
	const validFrom = pick(input.validFrom, current.validFrom);
	const validUntil = pick(input.validUntil, current.validUntil);

	// A patch that leaves both columns alone says nothing about the date pair:
	// whatever the row holds is none of its business.
	const touchesDatePair =
		input.documentDate !== undefined || input.datePrecision !== undefined;

	if (touchesDatePair && documentDate && !datePrecision) {
		throw new ORPCError("BAD_REQUEST", {
			message: "`datePrecision` is required when `documentDate` is provided.",
		});
	}
	// A precision alone describes nothing: clearing the date clears it too (see
	// `updateDocument`), and setting one without a date is a mistake.
	if (touchesDatePair && !documentDate && datePrecision) {
		throw new ORPCError("BAD_REQUEST", {
			message: "`datePrecision` cannot be set without a `documentDate`.",
		});
	}
	if (periodStart && periodEnd && periodEnd < periodStart) {
		throw new ORPCError("BAD_REQUEST", {
			message: "`periodEnd` must be on or after `periodStart`.",
		});
	}
	if (validFrom && validUntil && validUntil < validFrom) {
		throw new ORPCError("BAD_REQUEST", {
			message: "`validUntil` must be on or after `validFrom`.",
		});
	}
}

/**
 * Called when `sensitive` actually flips, to bring the stored files in line
 * (encryption at rest, SPEC §8 iteration 7).
 *
 * Injected like `onDeleteFiles`: the service stays pure, the router hands over
 * `setSensitive` from `@docstore/ingestion` when a pipeline is available.
 */
export type OnSensitiveChange = (
	documentId: string,
	sensitive: boolean,
) => Promise<unknown>;

export type UpdateDocumentOptions = {
	onSensitiveChange?: OnSensitiveChange;
	/** Needed by the `setDocumentType` bulk action to re-key sensitive files. */
	ingestion?: IngestionContext;
};

export async function updateDocument(
	db: Db,
	id: string,
	input: UpdateDocumentInput,
	options: UpdateDocumentOptions = {},
): Promise<DocumentDetail> {
	const current = await requireDocument(db, id);
	assertNotTrashed(current);
	assertConsistentDates(current, input);

	const patch: Partial<typeof document.$inferInsert> = {};
	if (input.title !== undefined) patch.title = input.title;
	// Notes are never computed by the pipeline, so they stay out of
	// `manualFields`; an empty string reads as "no notes".
	if (input.notes !== undefined) {
		patch.notes = input.notes?.trim() ? input.notes : null;
	}
	if (input.status !== undefined) patch.status = input.status;
	if (input.sensitive !== undefined) patch.sensitive = input.sensitive;
	if (input.documentDate !== undefined) {
		patch.documentDate = input.documentDate ?? null;
		// `documentDate: null` takes the precision with it.
		if (input.documentDate === null) patch.datePrecision = null;
		// A date typed in is nobody's guess any more: the "inferred" badge and the
		// confidence that went with it go away.
		patch.dateSource = input.documentDate === null ? null : "manual";
		patch.dateConfidence = null;
	}
	if (input.datePrecision !== undefined) {
		patch.datePrecision = input.datePrecision ?? null;
	}
	if (input.periodStart !== undefined) {
		patch.periodStart = input.periodStart ?? null;
	}
	if (input.periodEnd !== undefined) patch.periodEnd = input.periodEnd ?? null;
	if (input.receivedAt !== undefined) {
		patch.receivedAt = input.receivedAt ?? null;
	}
	if (input.validFrom !== undefined) patch.validFrom = input.validFrom ?? null;
	if (input.validUntil !== undefined) {
		patch.validUntil = input.validUntil ?? null;
	}
	// A number typed in by hand is a manual one, and stays so even if the
	// automatic numbering had put it there first.
	if (input.asn !== undefined) {
		patch.asn = input.asn ?? null;
		patch.asnSource = "manual";
	}
	if (input.physicalLocation !== undefined) {
		patch.physicalLocation = input.physicalLocation ?? null;
	}

	// Whatever a human set here is now off limits to the pipeline: `reprocess`
	// rewrites the metadata it computed, never the metadata it was given.
	// Clearing a field counts — "this document has no validity date" is a
	// decision too, and re-deriving one would undo it.
	const manualFields = [
		...new Set([
			...current.manualFields,
			...MANUAL_DOCUMENT_FIELDS.filter((field) => field in patch),
		]),
	];
	if (manualFields.length !== current.manualFields.length) {
		patch.manualFields = manualFields;
	}

	if (Object.keys(patch).length > 0) {
		try {
			await db.update(document).set(patch).where(eq(document.id, id));
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new ORPCError("CONFLICT", {
					message: `The ASN ${patch.asn} is already used by another document.`,
				});
			}
			throw error;
		}
	}

	// Re-encryption comes after the write: the flag is already persisted, so a
	// failure here leaves the files readable through their own `encrypted` flag
	// and a later call reconciles them.
	if (input.sensitive !== undefined && input.sensitive !== current.sensitive) {
		if (options.onSensitiveChange) {
			await options.onSensitiveChange(id, input.sensitive);
		} else if (input.sensitive) {
			// Without a pipeline nothing re-keys the files, but the public windows
			// must close all the same.
			await revokeShareLinksForSensitive(db, id);
		}
	}

	// A manual edit can satisfy what sent the document to Review (a date, a
	// title...): the reasons are refreshed instead of being left stale.
	await computeReviewReasons(db, id);

	// A changed (or cleared) `validUntil` makes the expiry reminders stale:
	// regenerated synchronously rather than waiting for the next
	// `reminder.generate` run.
	if (
		input.validUntil !== undefined &&
		input.validUntil !== current.validUntil
	) {
		await generateRemindersForDocument(db, id);
	}

	return getDocument(db, id);
}

/* ------------------------------------------------------------------ */
/* Physical archiving (ASN)                                             */
/* ------------------------------------------------------------------ */

/** Next free archive serial number: `max(asn) + 1`, `1` on an empty store. */
export async function nextAsn(db: Db): Promise<NextAsnResult> {
	const [row] = await db
		.select({ max: sql<number | null>`max(${document.asn})` })
		.from(document);
	return { next: (row?.max ?? 0) + 1 };
}

/**
 * Assigns the next ASN to a document, atomically.
 *
 * The allocation itself lives in `@docstore/ingestion` (`allocateAsn`), shared
 * with the automatic numbering: whoever asks, a number is handed out once and
 * never twice.
 */
export async function assignAsn(db: Db, id: string): Promise<DocumentDetail> {
	// Numbering a document is filing it in a paper folder: the trash is not one
	// (SPEC §2), and the number would be burnt on a document nobody keeps.
	// Already numbered: `allocateAsn` returns null rather than wasting a second
	// number and breaking the link with the paper folder.
	await requireLiveDocument(db, id);

	try {
		await allocateAsn(db, id, "manual");
	} catch (error) {
		if (error instanceof AsnAllocationError) {
			throw new ORPCError("CONFLICT", { message: error.message });
		}
		throw error;
	}
	return getDocument(db, id);
}

/** Document carrying this ASN; `NOT_FOUND` when the number is free. */
export async function getDocumentByAsn(
	db: Db,
	asn: number,
): Promise<DocumentDetail> {
	const [row] = await db
		.select({ id: document.id })
		.from(document)
		.where(eq(document.asn, asn))
		.limit(1);
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `No document carries the ASN ${asn}.`,
		});
	}
	return getDocument(db, row.id);
}

/** Detects a Postgres unique constraint violation (`23505`). */
function isUniqueViolation(error: unknown): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	const candidate = error as { code?: unknown; cause?: { code?: unknown } };
	return candidate.code === "23505" || candidate.cause?.code === "23505";
}

async function requireParties(db: Db, partyIds: string[]): Promise<void> {
	if (partyIds.length === 0) {
		return;
	}
	const rows = await db
		.select({ id: party.id })
		.from(party)
		.where(inArray(party.id, partyIds));
	const found = new Set(rows.map((row) => row.id));
	const missing = partyIds.filter((partyId) => !found.has(partyId));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Party not found: ${missing.join(", ")}.`,
		});
	}
}

/** Replaces every link of the document with the provided list. */
export async function setDocumentParties(
	db: Db,
	id: string,
	parties: DocumentPartyAssignment[],
): Promise<DocumentDetail> {
	await requireLiveDocument(db, id);

	const unique = new Map<string, DocumentPartyAssignment>();
	for (const assignment of parties) {
		unique.set(`${assignment.partyId}:${assignment.role}`, assignment);
	}
	const assignments = [...unique.values()];
	await requireParties(db, [
		...new Set(assignments.map((item) => item.partyId)),
	]);

	await db.transaction(async (tx) => {
		await tx.delete(documentParty).where(eq(documentParty.documentId, id));
		if (assignments.length > 0) {
			await tx.insert(documentParty).values(
				assignments.map((assignment) => ({
					documentId: id,
					partyId: assignment.partyId,
					role: assignment.role,
					source: "manual" as const,
					confidence: null,
				})),
			);
		}
	});

	// `missingIssuer` and the low-confidence reasons on the parties are settled.
	await computeReviewReasons(db, id);
	return getDocument(db, id);
}

export async function addDocumentParty(
	db: Db,
	id: string,
	partyId: string,
	role: DocumentPartyRole,
): Promise<DocumentDetail> {
	await requireLiveDocument(db, id);
	await requireParties(db, [partyId]);

	const existing = await db
		.select({ documentId: documentParty.documentId })
		.from(documentParty)
		.where(
			and(
				eq(documentParty.documentId, id),
				eq(documentParty.partyId, partyId),
				eq(documentParty.role, role),
			),
		)
		.limit(1);
	if (existing[0]) {
		throw new ORPCError("CONFLICT", {
			message: "This Party is already linked to the document with this role.",
		});
	}

	await db.insert(documentParty).values({
		documentId: id,
		partyId,
		role,
		source: "manual",
		confidence: null,
	});

	await computeReviewReasons(db, id);
	return getDocument(db, id);
}

export async function removeDocumentParty(
	db: Db,
	id: string,
	partyId: string,
	role: DocumentPartyRole,
): Promise<DocumentDetail> {
	await requireLiveDocument(db, id);

	const deleted = await db
		.delete(documentParty)
		.where(
			and(
				eq(documentParty.documentId, id),
				eq(documentParty.partyId, partyId),
				eq(documentParty.role, role),
			),
		)
		.returning({ partyId: documentParty.partyId });
	if (!deleted[0]) {
		throw new ORPCError("NOT_FOUND", {
			message: "This document/Party link does not exist.",
		});
	}

	return getDocument(db, id);
}

async function setDeletedAt(
	db: Db,
	id: string,
	deletedAt: Date | null,
): Promise<DocumentDto> {
	await requireDocument(db, id);
	const rows = await db
		.update(document)
		.set({ deletedAt })
		.where(eq(document.id, id))
		.returning(documentColumns);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${id}" not found.`,
		});
	}
	return row;
}

/**
 * Trash: the document stays in the database but leaves the default lists.
 *
 * Trashing an already trashed document is a no-op — pushing back `deletedAt`
 * would restart the retention clock on something the user dropped long ago.
 */
export async function trashDocument(db: Db, id: string): Promise<DocumentDto> {
	const current = await requireDocument(db, id);
	if (current.deletedAt) return current;
	return setDeletedAt(db, id, new Date());
}

export function restoreDocument(db: Db, id: string): Promise<DocumentDto> {
	return setDeletedAt(db, id, null);
}

export type DeleteDocumentOptions = {
	/**
	 * Hook for the physical deletion of files, wired by the ingestion pipeline.
	 * Receives the `storage_key` and `thumbnail_key` values.
	 */
	onDeleteFiles?: (storageKeys: string[]) => Promise<void>;
};

export async function deleteDocumentPermanently(
	db: Db,
	id: string,
	options: DeleteDocumentOptions = {},
): Promise<{ id: string; deleted: true; storageKeys: string[] }> {
	await requireDocument(db, id);

	const files = await db
		.select({
			storageKey: documentFile.storageKey,
			thumbnailKey: documentFile.thumbnailKey,
		})
		.from(documentFile)
		.where(eq(documentFile.documentId, id));

	const storageKeys = files.flatMap((file) =>
		file.thumbnailKey
			? [file.storageKey, file.thumbnailKey]
			: [file.storageKey],
	);

	// `document_file` and `document_party` are deleted by cascade.
	await db.delete(document).where(eq(document.id, id));

	if (options.onDeleteFiles) {
		await options.onDeleteFiles(storageKeys);
	}

	return { id, deleted: true, storageKeys };
}

/* ------------------------------------------------------------------ */
/* Category, tags and custom fields                                     */
/* ------------------------------------------------------------------ */

/**
 * Manual assignment (SPEC): always resets `categorySource`/`categoryConfidence`.
 * A category someone typed is theirs, so the approval stamp goes with the value
 * it described.
 */
export async function setDocumentCategory(
	db: Db,
	id: string,
	categoryId: string | null,
): Promise<DocumentDetail> {
	await requireLiveDocument(db, id);
	if (categoryId) {
		await assertCategoryExists(db, categoryId);
	}
	await db
		.update(document)
		.set({
			categoryId,
			categorySource: "manual",
			categoryConfidence: null,
			categoryConfirmedAt: null,
		})
		.where(eq(document.id, id));
	// `missingCategory` and the low-confidence reason on the category no longer
	// apply once a human has decided.
	await computeReviewReasons(db, id);
	return getDocument(db, id);
}

/** Replaces every tag of the document (source "manual"). */
export async function setDocumentTags(
	db: Db,
	id: string,
	tagIds: string[],
): Promise<DocumentDetail> {
	await requireLiveDocument(db, id);
	const unique = [...new Set(tagIds)];
	await requireTags(db, unique);

	await db.transaction(async (tx) => {
		await tx.delete(documentTag).where(eq(documentTag.documentId, id));
		if (unique.length > 0) {
			await tx.insert(documentTag).values(
				unique.map((tagId) => ({
					documentId: id,
					tagId,
					source: "manual" as const,
					confidence: null,
				})),
			);
		}
	});

	return getDocument(db, id);
}

export async function addDocumentTag(
	db: Db,
	id: string,
	tagId: string,
): Promise<DocumentDetail> {
	await requireLiveDocument(db, id);
	await requireTags(db, [tagId]);

	await db
		.insert(documentTag)
		.values({ documentId: id, tagId, source: "manual", confidence: null })
		.onConflictDoNothing();

	return getDocument(db, id);
}

export async function removeDocumentTag(
	db: Db,
	id: string,
	tagId: string,
): Promise<DocumentDetail> {
	await requireLiveDocument(db, id);
	const deleted = await db
		.delete(documentTag)
		.where(and(eq(documentTag.documentId, id), eq(documentTag.tagId, tagId)))
		.returning({ tagId: documentTag.tagId });
	if (!deleted[0]) {
		throw new ORPCError("NOT_FOUND", {
			message: "This tag is not associated with the document.",
		});
	}
	return getDocument(db, id);
}

/**
 * Writes a custom field value. `source: "rule"` (with its confidence) is what
 * the "Extract" action of a field uses when the user applies the result of a
 * tested extraction rule; everything else is a manual entry.
 */
export async function setDocumentFieldValue(
	db: Db,
	id: string,
	fieldId: string,
	value: CustomFieldValue,
	origin: { source?: "manual" | "rule"; confidence?: number | null } = {},
): Promise<DocumentDetail> {
	const current = await requireLiveDocument(db, id);
	const field = await requireCustomField(db, fieldId);
	assertFieldAppliesToCategory(
		field,
		await categoryChainIds(db, current.categoryId),
	);
	assertValueMatchesField(field, value);

	if (value.kind === "party_ref") {
		await requireParties(db, [value.partyId]);
	}

	const source = origin.source ?? "manual";
	const confidence = source === "rule" ? (origin.confidence ?? null) : null;

	// A new value invalidates the approval the old one carried.
	await db
		.insert(documentFieldValue)
		.values({ documentId: id, fieldId, value, source, confidence })
		.onConflictDoUpdate({
			target: [documentFieldValue.documentId, documentFieldValue.fieldId],
			set: {
				value,
				source,
				confidence,
				confirmedAt: null,
				updatedAt: new Date(),
			},
		});

	return getDocument(db, id);
}

export async function clearDocumentFieldValue(
	db: Db,
	id: string,
	fieldId: string,
): Promise<DocumentDetail> {
	await requireLiveDocument(db, id);
	const deleted = await db
		.delete(documentFieldValue)
		.where(
			and(
				eq(documentFieldValue.documentId, id),
				eq(documentFieldValue.fieldId, fieldId),
			),
		)
		.returning({ fieldId: documentFieldValue.fieldId });
	if (!deleted[0]) {
		throw new ORPCError("NOT_FOUND", {
			message: "No value for this custom field on this document.",
		});
	}
	return getDocument(db, id);
}

/* ------------------------------------------------------------------ */
/* Bulk actions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Applies an action to a selection of documents in a single transaction.
 * `updated` counts the documents actually touched.
 */
export async function bulkDocuments(
	db: Db,
	input: DocumentBulkInput,
	options: UpdateDocumentOptions = {},
): Promise<DocumentBulkResult> {
	const ids = [...new Set(input.ids)];
	const existing = await db
		.select({ id: document.id, deletedAt: document.deletedAt })
		.from(document)
		.where(inArray(document.id, ids));
	const found = existing.map((row) => row.id);
	const missing = ids.filter((id) => !found.includes(id));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document not found: ${missing.join(", ")}.`,
		});
	}

	const action = input.action;

	// Only leaving the trash (`restore`) and entering it (`trash`, a no-op on a
	// document already there) touch a trashed document.
	if (action.type !== "restore" && action.type !== "trash") {
		const trashed = existing
			.filter((row) => row.deletedAt !== null)
			.map((row) => row.id);
		if (trashed.length > 0) {
			throw new ORPCError("CONFLICT", {
				message: `${TRASHED_DOCUMENT_MESSAGE} (${trashed.join(", ")})`,
			});
		}
	}
	if (action.type === "setCategory" && action.categoryId) {
		await assertCategoryExists(db, action.categoryId);
	}
	if (action.type === "addTags" || action.type === "removeTags") {
		await requireTags(db, [...new Set(action.tagIds)]);
	}
	if (action.type === "addParty") {
		await requireParties(db, [action.partyId]);
	}
	if (action.type === "regenerateTitle") {
		// Rendering a template needs the subject of each document: like
		// `setDocumentType`, this runs document by document, outside a
		// transaction.
		const outcome = await regenerateTitlesForDocuments(db, found);
		return { updated: outcome.updated };
	}
	if (action.type === "setDocumentType") {
		// Applying a type runs the extraction rules document by document: it does
		// not belong in the single transaction the other actions share.
		if (action.documentTypeId === null) {
			for (const id of found) await clearDocumentType(db, id);
			return { updated: found.length };
		}
		const outcome = await applyDocumentTypeToDocuments(
			db,
			{
				documentTypeId: action.documentTypeId,
				documentIds: found,
				// A bulk assignment names the type explicitly: a disabled one is
				// applied without asking a second time.
				force: true,
				...(action.layoutId ? { layoutId: action.layoutId } : {}),
			},
			options.ingestion ? { ingestion: options.ingestion } : {},
		);
		return { updated: outcome.applied };
	}

	const result = await db.transaction(async (tx) => {
		switch (action.type) {
			case "setCategory": {
				const rows = await tx
					.update(document)
					.set({
						categoryId: action.categoryId,
						categorySource: "manual",
						categoryConfidence: null,
						categoryConfirmedAt: null,
					})
					.where(inArray(document.id, found))
					.returning({ id: document.id });
				return { updated: rows.length };
			}
			case "setSensitive": {
				const rows = await tx
					.update(document)
					.set({ sensitive: action.sensitive })
					.where(inArray(document.id, found))
					.returning({ id: document.id });
				return { updated: rows.length };
			}
			case "trash": {
				const rows = await tx
					.update(document)
					.set({ deletedAt: new Date() })
					.where(and(inArray(document.id, found), isNull(document.deletedAt)))
					.returning({ id: document.id });
				return { updated: rows.length };
			}
			case "restore": {
				const rows = await tx
					.update(document)
					.set({ deletedAt: null })
					.where(
						and(inArray(document.id, found), isNotNull(document.deletedAt)),
					)
					.returning({ id: document.id });
				return { updated: rows.length };
			}
			case "addTags": {
				const tagIds = [...new Set(action.tagIds)];
				const rows = await tx
					.insert(documentTag)
					.values(
						found.flatMap((documentId) =>
							tagIds.map((tagId) => ({
								documentId,
								tagId,
								source: "manual" as const,
								confidence: null,
							})),
						),
					)
					.onConflictDoNothing()
					.returning({ documentId: documentTag.documentId });
				return { updated: new Set(rows.map((row) => row.documentId)).size };
			}
			case "removeTags": {
				const tagIds = [...new Set(action.tagIds)];
				const rows = await tx
					.delete(documentTag)
					.where(
						and(
							inArray(documentTag.documentId, found),
							inArray(documentTag.tagId, tagIds),
						),
					)
					.returning({ documentId: documentTag.documentId });
				return { updated: new Set(rows.map((row) => row.documentId)).size };
			}
			default: {
				const rows = await tx
					.insert(documentParty)
					.values(
						found.map((documentId) => ({
							documentId,
							partyId: action.partyId,
							role: action.role,
							source: "manual" as const,
							confidence: null,
						})),
					)
					.onConflictDoNothing()
					.returning({ documentId: documentParty.documentId });
				return { updated: new Set(rows.map((row) => row.documentId)).size };
			}
		}
	});

	// Re-encryption runs outside the transaction: it touches the filesystem, and
	// `setSensitive` is idempotent — a document already in the right state costs
	// one query and no rewrite.
	if (action.type === "setSensitive") {
		for (const id of found) {
			if (options.onSensitiveChange) {
				await options.onSensitiveChange(id, action.sensitive);
			} else if (action.sensitive) {
				await revokeShareLinksForSensitive(db, id);
			}
		}
	}

	return result;
}

/* ------------------------------------------------------------------ */
/* Duplicates                                                           */
/* ------------------------------------------------------------------ */

/** Base info attached to each side of a duplicate pair. */
type DuplicateSide = {
	title: string;
	documentDate: string | null;
	datePrecision: DocumentDto["datePrecision"];
	thumbnailFileId: string | null;
};

async function loadDuplicateSides(
	db: Db,
	documentIds: string[],
): Promise<Map<string, DuplicateSide>> {
	const result = new Map<string, DuplicateSide>();
	const unique = [...new Set(documentIds)];
	if (unique.length === 0) {
		return result;
	}

	const [rows, primaryFiles] = await Promise.all([
		db
			.select({
				id: document.id,
				title: document.title,
				documentDate: document.documentDate,
				datePrecision: document.datePrecision,
			})
			.from(document)
			.where(inArray(document.id, unique)),
		loadPrimaryFiles(db, unique),
	]);

	for (const row of rows) {
		result.set(row.id, {
			title: row.title,
			documentDate: row.documentDate,
			datePrecision: row.datePrecision,
			thumbnailFileId: primaryFiles.get(row.id)?.fileId ?? null,
		});
	}
	return result;
}

/** Normalizes a pair so `documentId < otherDocumentId`, as stored. */
function normalizedPair(
	documentId: string,
	otherDocumentId: string,
): { documentId: string; otherDocumentId: string } {
	return documentId < otherDocumentId
		? { documentId, otherDocumentId }
		: { documentId: otherDocumentId, otherDocumentId: documentId };
}

/**
 * Pairs of potentially duplicated documents.
 *
 * Two rules: same original hash between an active document and a trashed one,
 * or same normalised title and same date. The strict duplicate at intake time
 * is handled upstream by `intakeFile`. Pairs dismissed through
 * `ignoreDuplicate` are excluded unless `includeIgnored` is set.
 */
export async function listDocumentDuplicates(
	db: Db,
	input: ListDocumentDuplicatesInput = { includeIgnored: false },
): Promise<DocumentDuplicate[]> {
	const byHash = await db.execute<{
		document_id: string;
		duplicate_of_id: string;
	}>(sql`
		select active.id as document_id, trashed.id as duplicate_of_id
		from ${documentFile} as af
		inner join ${document} as active on active.id = af.document_id
		inner join ${documentFile} as tf on tf.sha256 = af.sha256 and tf.id <> af.id
		inner join ${document} as trashed on trashed.id = tf.document_id
		where af.kind = 'original'
			and tf.kind = 'original'
			and active.deleted_at is null
			and trashed.deleted_at is not null
		order by active.id, trashed.id
	`);

	const byTitle = await db.execute<{
		document_id: string;
		duplicate_of_id: string;
	}>(sql`
		select later.id as document_id, earlier.id as duplicate_of_id
		from ${document} as later
		inner join ${document} as earlier
			on earlier.document_date = later.document_date
			and lower(btrim(regexp_replace(earlier.title, '\\s+', ' ', 'g')))
				= lower(btrim(regexp_replace(later.title, '\\s+', ' ', 'g')))
			and (earlier.created_at, earlier.id) < (later.created_at, later.id)
		where later.deleted_at is null
			and earlier.deleted_at is null
			and later.document_date is not null
		order by later.created_at, later.id
	`);

	type RawPair = {
		documentId: string;
		duplicateOfId: string;
		reason: DocumentDuplicate["reason"];
	};
	const pairs: RawPair[] = byHash.rows.map((row) => ({
		documentId: row.document_id,
		duplicateOfId: row.duplicate_of_id,
		reason: "sameOriginalHash" as const,
	}));

	const seen = new Set(
		pairs.map((item) => `${item.documentId}:${item.duplicateOfId}`),
	);
	for (const row of byTitle.rows) {
		const key = `${row.document_id}:${row.duplicate_of_id}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		pairs.push({
			documentId: row.document_id,
			duplicateOfId: row.duplicate_of_id,
			reason: "sameTitleAndDate",
		});
	}

	if (pairs.length === 0) {
		return [];
	}

	const ignoredRows = await db.select().from(duplicateIgnore);
	const ignoredKeys = new Set(
		ignoredRows.map((row) => `${row.documentId}:${row.otherDocumentId}`),
	);

	const sides = await loadDuplicateSides(
		db,
		pairs.flatMap((pair) => [pair.documentId, pair.duplicateOfId]),
	);

	const includeIgnored = input.includeIgnored ?? false;
	const duplicates: DocumentDuplicate[] = [];
	for (const pair of pairs) {
		const { documentId: a, otherDocumentId: b } = normalizedPair(
			pair.documentId,
			pair.duplicateOfId,
		);
		const ignored = ignoredKeys.has(`${a}:${b}`);
		if (ignored && !includeIgnored) {
			continue;
		}

		const side = sides.get(pair.documentId);
		const otherSide = sides.get(pair.duplicateOfId);
		duplicates.push({
			documentId: pair.documentId,
			title: side?.title ?? "",
			documentDate: side?.documentDate ?? null,
			datePrecision: side?.datePrecision ?? null,
			thumbnailFileId: side?.thumbnailFileId ?? null,
			duplicateOfId: pair.duplicateOfId,
			duplicateOfTitle: otherSide?.title ?? "",
			duplicateOfDate: otherSide?.documentDate ?? null,
			duplicateOfDatePrecision: otherSide?.datePrecision ?? null,
			duplicateOfThumbnailFileId: otherSide?.thumbnailFileId ?? null,
			reason: pair.reason,
			ignored,
		});
	}

	return duplicates;
}

/**
 * Both documents of the pair must exist, and the one the call is made *on*
 * must be live: dismissing a duplicate is a decision taken about a document
 * still in the store.
 *
 * Only that side is guarded on purpose. The `sameOriginalHash` rule always
 * pairs an active document with a trashed one, so requiring both to be live
 * would make exactly the pairs the duplicates screen reports impossible to
 * dismiss.
 */
async function assertLiveDuplicateSubject(
	db: Db,
	input: IgnoreDuplicateInput,
): Promise<void> {
	if (input.documentId === input.otherDocumentId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "A document cannot be paired with itself.",
		});
	}
	await requireDocumentIds(db, [input.documentId, input.otherDocumentId]);
	await requireLiveDocument(db, input.documentId);
}

/** Dismisses a duplicate pair: `document.duplicates` stops reporting it. */
export async function ignoreDuplicate(
	db: Db,
	input: IgnoreDuplicateInput,
): Promise<DuplicateIgnoreResult> {
	await assertLiveDuplicateSubject(db, input);

	const pair = normalizedPair(input.documentId, input.otherDocumentId);
	await db.insert(duplicateIgnore).values(pair).onConflictDoNothing();

	return { ...pair, ignored: true };
}

/** Un-dismisses a duplicate pair: it can be reported again. */
export async function unignoreDuplicate(
	db: Db,
	input: IgnoreDuplicateInput,
): Promise<DuplicateIgnoreResult> {
	await assertLiveDuplicateSubject(db, input);

	const pair = normalizedPair(input.documentId, input.otherDocumentId);
	await db
		.delete(duplicateIgnore)
		.where(
			and(
				eq(duplicateIgnore.documentId, pair.documentId),
				eq(duplicateIgnore.otherDocumentId, pair.otherDocumentId),
			),
		);

	return { ...pair, ignored: false };
}

export async function getDocumentStats(db: Db): Promise<DocumentStats> {
	const horizon = addDays(todayIso(), 30);

	const [rows, storageRows, expiringRows, partyRows] = await Promise.all([
		db
			.select({ status: document.status, value: count() })
			.from(document)
			.where(isNull(document.deletedAt))
			.groupBy(document.status),
		// Real storage usage: the trash still weighs on the disk.
		db
			.select({
				bytes: sql<number>`coalesce(sum(${documentFile.size}), 0)::bigint`,
				files: sql<number>`count(*)::int`,
			})
			.from(documentFile),
		db
			.select({ value: sql<number>`count(*)::int` })
			.from(document)
			.where(
				and(
					isNull(document.deletedAt),
					isNotNull(document.validUntil),
					lte(document.validUntil, horizon),
				),
			),
		db
			.select({ value: sql<number>`count(*)::int` })
			.from(party)
			.where(isNull(party.archivedAt)),
	]);

	const byStatus = Object.fromEntries(
		DOCUMENT_STATUSES.map((status) => [status, 0]),
	) as Record<DocumentStatus, number>;

	let total = 0;
	for (const row of rows) {
		byStatus[row.status] = row.value;
		total += row.value;
	}

	return {
		total,
		byStatus,
		review: byStatus.review,
		storage: {
			// `sum(bigint)` comes back as `numeric`: node-postgres returns it as a string.
			bytes: Number(storageRows[0]?.bytes ?? 0),
			files: storageRows[0]?.files ?? 0,
		},
		expiringSoon: expiringRows[0]?.value ?? 0,
		parties: partyRows[0]?.value ?? 0,
	};
}
