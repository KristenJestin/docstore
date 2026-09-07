import type { Db } from "@docstore/db";
import { category } from "@docstore/db/schema/category";
import { document, documentParty } from "@docstore/db/schema/document";
import type {
	DocumentTypeLayoutRow,
	DocumentTypeRow,
} from "@docstore/db/schema/document-type";
import {
	documentType,
	documentTypeLayout,
	documentTypeOverride,
} from "@docstore/db/schema/document-type";
import { party } from "@docstore/db/schema/party";
import { tag } from "@docstore/db/schema/tag";
import type { IngestionContext } from "@docstore/ingestion";
import {
	applyDocumentType as applyDocumentTypeToDocument,
	averageResultConfidence,
	buildSubject,
	clearDocumentType,
	detectDocumentTypes,
	extractionRulesFor,
	layoutExtractionRules,
	loadLayouts,
	runExtractionRules,
	selectLayout,
	signatureFromText,
} from "@docstore/ingestion";
import {
	evaluateCondition,
	renderTitleTemplate,
	titleContextOf,
} from "@docstore/rules";
import type {
	AddDocumentTypeLayoutInput,
	ApplyDocumentTypeInput,
	ApplyDocumentTypeResult,
	ApplyDocumentTypeResultItem,
	CreateDocumentTypeFromDocumentInput,
	CreateDocumentTypeFromSuggestionInput,
	CreateDocumentTypeInput,
	CreateLayoutFromDocumentInput,
	DeleteDocumentTypeInput,
	DetectDocumentTypeResult,
	DocumentTypeDetail,
	DocumentTypeDto,
	DocumentTypeItem,
	DocumentTypeLayoutDto,
	DocumentTypeMembership,
	DocumentTypeOutOfRange,
	DocumentTypeSuggestion,
	ListDocumentTypesInput,
	PreviewDocumentTypeInput,
	PreviewDocumentTypeResult,
	RecurrenceInput,
	ReorderDocumentTypeLayoutsInput,
	ReorderDocumentTypesInput,
	SetDocumentTypeOverrideInput,
	TestDocumentTypeLayoutInput,
	TestDocumentTypeLayoutResult,
	ToggleDocumentTypeInput,
	UpdateDocumentTypeInput,
	UpdateDocumentTypeLayoutInput,
} from "@docstore/shared/document-type";
import {
	documentTypeCoversCouple,
	suggestedDocumentTypeName,
} from "@docstore/shared/document-type";
import type {
	Periodicity,
	RecurrencePeriod,
	RecurrenceStats,
} from "@docstore/shared/recurrence";
import {
	DEFAULT_GRACE_DAYS,
	dayGapsBetween,
	dueDateOf,
	enumeratePeriods,
	periodicityFromDayGaps,
	periodKeyOf,
	periodStartOf,
	SUGGEST_MIN_SAMPLES,
	todayIso,
} from "@docstore/shared/recurrence";
import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import {
	and,
	asc,
	count,
	eq,
	inArray,
	isNotNull,
	isNull,
	sql,
} from "drizzle-orm";
import { categorySubtreeIds } from "./category.service";
import { generateRemindersForDocument } from "./reminder.service";
import { likePattern } from "./sql-utils";

/**
 * Document types (SPEC §9) — the object that absorbed the Series.
 *
 * Members of a recurring type are never materialised: they are recomputed from
 * the documents carrying the type, plus those matching its issuer and its
 * category (subtree included). `document_type_override` forces or excludes a
 * document.
 */

/** Anchor date of a document: its period, otherwise its date. */
const anchorDate = sql<string>`coalesce(${document.periodStart}, ${document.documentDate})`;

/** Name of the layout created with every document type. */
export const DEFAULT_LAYOUT_NAME = "Default";

export { SUGGEST_MIN_SAMPLES };

export interface DocumentTypeMember {
	documentId: string;
	title: string;
	anchor: string;
}

export async function requireDocumentType(
	db: Db,
	id: string,
): Promise<DocumentTypeRow> {
	const rows = await db
		.select()
		.from(documentType)
		.where(eq(documentType.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document type "${id}" not found.`,
		});
	}
	return row;
}

async function requireLayout(
	db: Db,
	id: string,
): Promise<DocumentTypeLayoutRow> {
	const rows = await db
		.select()
		.from(documentTypeLayout)
		.where(eq(documentTypeLayout.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", { message: `Layout "${id}" not found.` });
	}
	return row;
}

async function requireDocument(db: Db, id: string): Promise<void> {
	const rows = await db
		.select({ id: document.id })
		.from(document)
		.where(eq(document.id, id))
		.limit(1);
	if (!rows[0]) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${id}" not found.`,
		});
	}
}

/** Same, and refuses a document sitting in the trash (SPEC §2). */
async function requireLiveDocument(db: Db, id: string): Promise<void> {
	const rows = await db
		.select({ id: document.id, deletedAt: document.deletedAt })
		.from(document)
		.where(eq(document.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${id}" not found.`,
		});
	}
	if (row.deletedAt) {
		throw new ORPCError("CONFLICT", {
			message: "Document is in the trash; restore it first.",
		});
	}
}

/* ------------------------------------------------------------------ */
/* Members and timeline                                                 */
/* ------------------------------------------------------------------ */

/**
 * Candidate documents: those carrying the type, plus those matching its issuer
 * and its category (subtree included). A type without either criterion only
 * ever collects the documents explicitly assigned to it.
 */
async function loadCandidates(
	db: Db,
	row: DocumentTypeRow,
): Promise<DocumentTypeMember[]> {
	const alternatives: SQL[] = [eq(document.documentTypeId, row.id)];

	if (row.issuerPartyId || row.categoryId) {
		const computed: SQL[] = [];
		if (row.issuerPartyId) {
			computed.push(
				sql`exists (
					select 1 from ${documentParty}
					where ${documentParty.documentId} = ${document.id}
						and ${documentParty.partyId} = ${row.issuerPartyId}
						and ${documentParty.role} = 'issuer'
				)`,
			);
		}
		if (row.categoryId) {
			const ids = await categorySubtreeIds(db, row.categoryId).catch(() => [
				row.categoryId as string,
			]);
			computed.push(inArray(document.categoryId, ids));
		}
		const merged = and(...computed);
		if (merged) alternatives.push(merged);
	}

	return db
		.select({
			documentId: document.id,
			title: document.title,
			anchor: anchorDate,
		})
		.from(document)
		.where(
			and(
				isNull(document.deletedAt),
				isNotNull(anchorDate),
				sql`(${sql.join(alternatives, sql` or `)})`,
			),
		);
}

/** Effective members of the type, with manual overrides applied. */
export async function documentTypeMembers(
	db: Db,
	row: DocumentTypeRow,
): Promise<DocumentTypeMember[]> {
	const [candidates, overrides] = await Promise.all([
		loadCandidates(db, row),
		db
			.select({
				documentId: documentTypeOverride.documentId,
				included: documentTypeOverride.included,
				title: document.title,
				anchor: anchorDate,
				deletedAt: document.deletedAt,
			})
			.from(documentTypeOverride)
			.innerJoin(document, eq(document.id, documentTypeOverride.documentId))
			.where(eq(documentTypeOverride.documentTypeId, row.id)),
	]);

	const byId = new Map(candidates.map((item) => [item.documentId, item]));
	for (const override of overrides) {
		if (override.included) {
			if (override.anchor && !override.deletedAt) {
				byId.set(override.documentId, {
					documentId: override.documentId,
					title: override.title,
					anchor: override.anchor,
				});
			}
		} else {
			byId.delete(override.documentId);
		}
	}
	return [...byId.values()];
}

/** Member identifiers, for the `documentTypeId` filter of `document.list`. */
export async function documentTypeMemberDocumentIds(
	db: Db,
	documentTypeId: string,
): Promise<string[]> {
	const row = await requireDocumentType(db, documentTypeId);
	const members = await documentTypeMembers(db, row);
	if (!row.periodicity || !row.startPeriod) {
		return members.map((member) => member.documentId);
	}
	const periodicity = row.periodicity;
	const first = periodStartOf(periodicity, row.startPeriod);
	const last = row.endPeriod ? periodStartOf(periodicity, row.endPeriod) : null;
	return members
		.filter((member) => {
			const start = periodStartOf(periodicity, member.anchor);
			return start >= first && (last === null || start <= last);
		})
		.map((member) => member.documentId);
}

/**
 * Timeline period by period. `pending` = period whose due date (expected date
 * + `graceDays`) has not passed yet. Empty for a non-recurring type.
 */
export async function documentTypeTimeline(
	db: Db,
	row: DocumentTypeRow,
	today: string = todayIso(),
): Promise<RecurrencePeriod[]> {
	if (!row.periodicity || !row.startPeriod) return [];
	const periodicity = row.periodicity;
	const members = await documentTypeMembers(db, row);

	// A single document per period: the oldest one wins.
	const byPeriod = new Map<string, DocumentTypeMember>();
	for (const member of members) {
		const start = periodStartOf(periodicity, member.anchor);
		const current = byPeriod.get(start);
		if (!current || member.anchor < current.anchor) {
			byPeriod.set(start, member);
		}
	}

	const upperBound =
		row.endPeriod && row.endPeriod < today ? row.endPeriod : today;
	const periods = enumeratePeriods(periodicity, row.startPeriod, upperBound);
	const graceDays = row.graceDays ?? DEFAULT_GRACE_DAYS;

	return periods.map((periodStart) => {
		const member = byPeriod.get(periodStart);
		const dueDate = dueDateOf(
			periodicity,
			periodStart,
			row.expectedDay,
			graceDays,
		);
		const status = member ? "present" : today > dueDate ? "missing" : "pending";
		return {
			period: periodKeyOf(periodicity, periodStart),
			periodStart,
			dueDate,
			documentId: member?.documentId ?? null,
			documentTitle: member?.title ?? null,
			status,
		};
	});
}

export function statsFromTimeline(
	timeline: RecurrencePeriod[],
): RecurrenceStats {
	const present = timeline.filter((entry) => entry.status === "present");
	const missing = timeline
		.filter((entry) => entry.status === "missing")
		.map((entry) => entry.period);
	return {
		expected: present.length + missing.length,
		present: present.length,
		missing,
		lastPeriod: present.at(-1)?.period ?? null,
	};
}

/* ------------------------------------------------------------------ */
/* Labels and counters                                                  */
/* ------------------------------------------------------------------ */

async function labelsFor(
	db: Db,
	rows: DocumentTypeRow[],
): Promise<{ parties: Map<string, string>; categories: Map<string, string> }> {
	const partyIds = [
		...new Set(
			rows
				.flatMap((row) => [row.issuerPartyId, row.subjectPartyId])
				.filter((id): id is string => id !== null),
		),
	];
	const categoryIds = [
		...new Set(rows.map((row) => row.categoryId).filter((id) => id !== null)),
	];

	const [partyRows, categoryRows] = await Promise.all([
		partyIds.length > 0
			? db
					.select({ id: party.id, name: party.name })
					.from(party)
					.where(inArray(party.id, partyIds))
			: Promise.resolve([]),
		categoryIds.length > 0
			? db
					.select({ id: category.id, name: category.name })
					.from(category)
					.where(inArray(category.id, categoryIds))
			: Promise.resolve([]),
	]);

	return {
		parties: new Map(partyRows.map((row) => [row.id, row.name])),
		categories: new Map(categoryRows.map((row) => [row.id, row.name])),
	};
}

/**
 * Documents and layouts per type.
 *
 * The document count is the one shown next to the type, so it says exactly what
 * the type page lists: the documents carrying it, plus the ones forced into it
 * by hand, minus the ones excluded by hand and the ones in the trash.
 */
async function countsFor(
	db: Db,
	ids: string[],
): Promise<{ documents: Map<string, number>; layouts: Map<string, number> }> {
	if (ids.length === 0) {
		return { documents: new Map(), layouts: new Map() };
	}
	const [carriers, overrides, layoutRows] = await Promise.all([
		db
			.select({ id: document.documentTypeId, documentId: document.id })
			.from(document)
			.where(
				and(isNull(document.deletedAt), inArray(document.documentTypeId, ids)),
			),
		db
			.select({
				id: documentTypeOverride.documentTypeId,
				documentId: documentTypeOverride.documentId,
				included: documentTypeOverride.included,
			})
			.from(documentTypeOverride)
			.innerJoin(document, eq(document.id, documentTypeOverride.documentId))
			.where(
				and(
					isNull(document.deletedAt),
					inArray(documentTypeOverride.documentTypeId, ids),
				),
			),
		db
			.select({ id: documentTypeLayout.documentTypeId, value: count() })
			.from(documentTypeLayout)
			.where(inArray(documentTypeLayout.documentTypeId, ids))
			.groupBy(documentTypeLayout.documentTypeId),
	]);

	const members = new Map<string, Set<string>>();
	for (const id of ids) members.set(id, new Set());
	for (const row of carriers) {
		if (row.id) members.get(row.id)?.add(row.documentId);
	}
	for (const row of overrides) {
		const bucket = members.get(row.id);
		if (!bucket) continue;
		if (row.included) bucket.add(row.documentId);
		else bucket.delete(row.documentId);
	}

	return {
		documents: new Map(
			[...members].map(([id, bucket]) => [id, bucket.size] as const),
		),
		layouts: new Map(layoutRows.map((row) => [row.id, row.value])),
	};
}

function toItem(
	row: DocumentTypeRow,
	labels: Awaited<ReturnType<typeof labelsFor>>,
	counts: Awaited<ReturnType<typeof countsFor>>,
	stats: RecurrenceStats | null,
): DocumentTypeItem {
	return {
		...row,
		categoryName: row.categoryId
			? (labels.categories.get(row.categoryId) ?? null)
			: null,
		issuerName: row.issuerPartyId
			? (labels.parties.get(row.issuerPartyId) ?? null)
			: null,
		subjectName: row.subjectPartyId
			? (labels.parties.get(row.subjectPartyId) ?? null)
			: null,
		layoutCount: counts.layouts.get(row.id) ?? 0,
		documentCount: counts.documents.get(row.id) ?? 0,
		stats,
	};
}

/* ------------------------------------------------------------------ */
/* Read                                                                 */
/* ------------------------------------------------------------------ */

export async function listDocumentTypes(
	db: Db,
	input: ListDocumentTypesInput,
): Promise<DocumentTypeItem[]> {
	const conditions: SQL[] = [];
	if (input.query) {
		conditions.push(
			sql`${documentType.name} ilike ${likePattern(input.query)}`,
		);
	}
	if (input.recurringOnly) {
		conditions.push(isNotNull(documentType.periodicity));
	}
	if (!input.includeDisabled) {
		conditions.push(eq(documentType.enabled, true));
	}

	const rows = await db
		.select()
		.from(documentType)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(
			asc(documentType.priority),
			asc(documentType.name),
			asc(documentType.id),
		);

	const [labels, counts] = await Promise.all([
		labelsFor(db, rows),
		countsFor(
			db,
			rows.map((row) => row.id),
		),
	]);
	const today = todayIso();

	const items: DocumentTypeItem[] = [];
	for (const row of rows) {
		const stats = row.periodicity
			? statsFromTimeline(await documentTypeTimeline(db, row, today))
			: null;
		items.push(toItem(row, labels, counts, stats));
	}
	return items;
}

/**
 * Members whose period falls before `startPeriod`: they belong to the type but
 * sit outside the window the timeline enumerates, so nothing would show them.
 */
function outOfRangeMembers(
	row: DocumentTypeRow,
	members: DocumentTypeMember[],
): DocumentTypeOutOfRange[] {
	if (!row.periodicity || !row.startPeriod) return [];
	const periodicity = row.periodicity;
	const first = periodStartOf(periodicity, row.startPeriod);

	return members
		.map((member) => ({
			member,
			periodStart: periodStartOf(periodicity, member.anchor),
		}))
		.filter((entry) => entry.periodStart < first)
		.sort((a, b) => a.periodStart.localeCompare(b.periodStart))
		.map((entry) => ({
			documentId: entry.member.documentId,
			title: entry.member.title,
			period: periodKeyOf(periodicity, entry.periodStart),
			periodStart: entry.periodStart,
		}));
}

export async function getDocumentType(
	db: Db,
	id: string,
): Promise<DocumentTypeDetail> {
	const row = await requireDocumentType(db, id);
	const [labels, counts, timeline, layouts, members] = await Promise.all([
		labelsFor(db, [row]),
		countsFor(db, [row.id]),
		documentTypeTimeline(db, row),
		loadLayouts(db, row.id),
		documentTypeMembers(db, row),
	]);

	return {
		...toItem(
			row,
			labels,
			counts,
			row.periodicity ? statsFromTimeline(timeline) : null,
		),
		layouts,
		timeline,
		memberCount: members.length,
		outOfRange: outOfRangeMembers(row, members),
	};
}

/* ------------------------------------------------------------------ */
/* Write                                                                */
/* ------------------------------------------------------------------ */

async function assertReferences(
	db: Db,
	input: {
		categoryId?: string | null;
		issuerPartyId?: string | null;
		subjectPartyId?: string | null;
		tagIds?: string[];
	},
): Promise<void> {
	if (input.categoryId) {
		const rows = await db
			.select({ id: category.id })
			.from(category)
			.where(eq(category.id, input.categoryId))
			.limit(1);
		if (!rows[0]) {
			throw new ORPCError("NOT_FOUND", {
				message: `Category "${input.categoryId}" not found.`,
			});
		}
	}
	for (const partyId of [input.issuerPartyId, input.subjectPartyId]) {
		if (!partyId) continue;
		const rows = await db
			.select({ id: party.id })
			.from(party)
			.where(eq(party.id, partyId))
			.limit(1);
		if (!rows[0]) {
			throw new ORPCError("NOT_FOUND", {
				message: `Party "${partyId}" not found.`,
			});
		}
	}
	const tagIds = [...new Set(input.tagIds ?? [])];
	if (tagIds.length > 0) {
		const rows = await db
			.select({ id: tag.id })
			.from(tag)
			.where(inArray(tag.id, tagIds));
		const found = new Set(rows.map((row) => row.id));
		const missing = tagIds.filter((id) => !found.has(id));
		if (missing.length > 0) {
			throw new ORPCError("NOT_FOUND", {
				message: `Tag not found: ${missing.join(", ")}.`,
			});
		}
	}
}

/** Normalizes the recurrence block into the columns of `document_type`. */
function recurrenceColumns(
	recurrence: RecurrenceInput | null | undefined,
): Pick<
	typeof documentType.$inferInsert,
	"periodicity" | "startPeriod" | "endPeriod" | "expectedDay" | "graceDays"
> {
	if (!recurrence) {
		return {
			periodicity: null,
			startPeriod: null,
			endPeriod: null,
			expectedDay: null,
			graceDays: null,
		};
	}
	const startPeriod = periodStartOf(
		recurrence.periodicity,
		recurrence.startPeriod,
	);
	const endPeriod = recurrence.endPeriod ?? null;
	if (endPeriod && endPeriod < startPeriod) {
		throw new ORPCError("BAD_REQUEST", {
			message: "`endPeriod` must be on or after `startPeriod`.",
		});
	}
	return {
		periodicity: recurrence.periodicity,
		startPeriod,
		endPeriod,
		expectedDay: recurrence.expectedDay ?? null,
		graceDays: recurrence.graceDays ?? DEFAULT_GRACE_DAYS,
	};
}

export async function createDocumentType(
	db: Db,
	input: CreateDocumentTypeInput,
): Promise<DocumentTypeDto> {
	await assertReferences(db, input);

	const rows = await db
		.insert(documentType)
		.values({
			name: input.name,
			description: input.description ?? null,
			icon: input.icon ?? null,
			color: input.color ?? null,
			categoryId: input.categoryId ?? null,
			issuerPartyId: input.issuerPartyId ?? null,
			subjectPartyId: input.subjectPartyId ?? null,
			tagIds: input.tagIds,
			sensitiveDefault: input.sensitiveDefault,
			titleTemplate: input.titleTemplate ?? null,
			detection: input.detection ?? null,
			...(input.detectionConfidence !== undefined
				? { detectionConfidence: input.detectionConfidence }
				: {}),
			...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
			...(input.priority !== undefined ? { priority: input.priority } : {}),
			...recurrenceColumns(input.recurrence),
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The document type could not be created.",
		});
	}

	// Every type owns at least one layout: it is where its extraction rules
	// live, and the fallback when no other layout matches (SPEC §9).
	await db.insert(documentTypeLayout).values({
		documentTypeId: row.id,
		name: DEFAULT_LAYOUT_NAME,
		isDefault: true,
		sortOrder: 0,
	});

	return row;
}

export async function updateDocumentType(
	db: Db,
	input: UpdateDocumentTypeInput,
): Promise<DocumentTypeDto> {
	const current = await requireDocumentType(db, input.id);
	await assertReferences(db, input);

	const patch: Partial<typeof documentType.$inferInsert> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) {
		patch.description = input.description ?? null;
	}
	if (input.icon !== undefined) patch.icon = input.icon ?? null;
	if (input.color !== undefined) patch.color = input.color ?? null;
	if (input.categoryId !== undefined) {
		patch.categoryId = input.categoryId ?? null;
	}
	if (input.issuerPartyId !== undefined) {
		patch.issuerPartyId = input.issuerPartyId ?? null;
	}
	if (input.subjectPartyId !== undefined) {
		patch.subjectPartyId = input.subjectPartyId ?? null;
	}
	if (input.tagIds !== undefined) patch.tagIds = input.tagIds;
	if (input.sensitiveDefault !== undefined) {
		patch.sensitiveDefault = input.sensitiveDefault;
	}
	if (input.titleTemplate !== undefined) {
		patch.titleTemplate = input.titleTemplate ?? null;
	}
	if (input.detection !== undefined) patch.detection = input.detection ?? null;
	if (input.detectionConfidence !== undefined) {
		patch.detectionConfidence = input.detectionConfidence;
	}
	if (input.enabled !== undefined) patch.enabled = input.enabled;
	if (input.priority !== undefined) patch.priority = input.priority;
	if (input.recurrence !== undefined) {
		Object.assign(patch, recurrenceColumns(input.recurrence));
	}

	if (Object.keys(patch).length === 0) return current;

	const rows = await db
		.update(documentType)
		.set(patch)
		.where(eq(documentType.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document type "${input.id}" not found.`,
		});
	}
	return row;
}

export async function deleteDocumentType(
	db: Db,
	input: DeleteDocumentTypeInput,
): Promise<{ id: string; deleted: true; detached: number }> {
	await requireDocumentType(db, input.id);

	const carriers = await db
		.select({ id: document.id })
		.from(document)
		.where(eq(document.documentTypeId, input.id));

	if (carriers.length > 0 && !input.detachDocuments) {
		throw new ORPCError("BAD_REQUEST", {
			message: `${carriers.length} document(s) still carry this type. Re-run with \`detachDocuments\` to clear them.`,
		});
	}

	for (const carrier of carriers) {
		await clearDocumentType(db, carrier.id);
	}
	// Layouts, overrides and reminders go away by cascade.
	await db.delete(documentType).where(eq(documentType.id, input.id));
	return { id: input.id, deleted: true as const, detached: carriers.length };
}

export async function toggleDocumentType(
	db: Db,
	input: ToggleDocumentTypeInput,
): Promise<DocumentTypeDto> {
	await requireDocumentType(db, input.id);
	const rows = await db
		.update(documentType)
		.set({ enabled: input.enabled })
		.where(eq(documentType.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document type "${input.id}" not found.`,
		});
	}
	return row;
}

export async function reorderDocumentTypes(
	db: Db,
	input: ReorderDocumentTypesInput,
): Promise<{ reordered: number }> {
	const ids = [...new Set(input.ids)];
	const rows = await db
		.select({ id: documentType.id })
		.from(documentType)
		.where(inArray(documentType.id, ids));
	const found = new Set(rows.map((row) => row.id));
	const missing = ids.filter((id) => !found.has(id));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document type not found: ${missing.join(", ")}.`,
		});
	}

	await db.transaction(async (tx) => {
		for (const [index, id] of ids.entries()) {
			await tx
				.update(documentType)
				.set({ priority: index })
				.where(eq(documentType.id, id));
		}
	});
	return { reordered: ids.length };
}

/* ------------------------------------------------------------------ */
/* Creation from a document / a suggestion                              */
/* ------------------------------------------------------------------ */

export interface DocumentTypeServiceOptions {
	/** Required to re-key the files when the type raises `sensitive`. */
	ingestion?: IngestionContext;
}

/**
 * Creates a type prefilled from a document (category, issuer, subject, tags,
 * sensitive) and applies it to that very document, which becomes its first
 * sample.
 */
export async function createDocumentTypeFromDocument(
	db: Db,
	input: CreateDocumentTypeFromDocumentInput,
	options: DocumentTypeServiceOptions = {},
): Promise<DocumentTypeDetail> {
	await requireLiveDocument(db, input.documentId);
	const prepared = await buildSubject(db, input.documentId);
	if (!prepared) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${input.documentId}" not found.`,
		});
	}

	const issuer = prepared.subject.parties.find(
		(item) => item.role === "issuer",
	);
	const subject = prepared.subject.parties.find(
		(item) => item.role === "subject",
	);
	const name =
		input.name ??
		(issuer && prepared.subject.categoryName
			? suggestedDocumentTypeName(issuer.name, prepared.subject.categoryName)
			: prepared.document.title);

	const created = await createDocumentType(db, {
		name,
		categoryId: prepared.document.categoryId,
		issuerPartyId: issuer?.partyId ?? null,
		subjectPartyId: subject?.partyId ?? null,
		tagIds: prepared.subject.tags,
		sensitiveDefault: prepared.document.sensitive,
		recurrence: input.recurrence ?? null,
	});

	await applyDocumentTypeToDocument(db, input.documentId, created.id, {
		source: "manual",
		...(options.ingestion ? { ingestion: options.ingestion } : {}),
	});

	return getDocumentType(db, created.id);
}

/**
 * Creates the recurring type behind a suggestion (or behind a
 * `recurringCandidate` review reason). Nothing is ever created automatically:
 * this is the explicit "yes" of the user.
 */
export async function createDocumentTypeFromSuggestion(
	db: Db,
	input: CreateDocumentTypeFromSuggestionInput,
): Promise<DocumentTypeItem> {
	await assertReferences(db, {
		categoryId: input.categoryId,
		issuerPartyId: input.partyId,
	});

	const [partyRows, categoryRows] = await Promise.all([
		db
			.select({ name: party.name })
			.from(party)
			.where(eq(party.id, input.partyId))
			.limit(1),
		db
			.select({ name: category.name })
			.from(category)
			.where(eq(category.id, input.categoryId))
			.limit(1),
	]);
	const partyName = partyRows[0]?.name ?? "";
	const categoryName = categoryRows[0]?.name ?? "";

	const created = await createDocumentType(db, {
		name: input.name ?? suggestedDocumentTypeName(partyName, categoryName),
		categoryId: input.categoryId,
		issuerPartyId: input.partyId,
		tagIds: [],
		sensitiveDefault: false,
		recurrence: {
			periodicity: input.periodicity,
			startPeriod: input.startPeriod,
			// An open recurrence: the point is to spot the next missing period.
			endPeriod: input.endPeriod ?? null,
		},
	});

	const [labels, counts, timeline] = await Promise.all([
		labelsFor(db, [created]),
		countsFor(db, [created.id]),
		documentTypeTimeline(db, created),
	]);
	return toItem(created, labels, counts, statsFromTimeline(timeline));
}

/**
 * Candidate types inferred from existing data: Issuer + category pairs covering
 * at least {@link SUGGEST_MIN_SAMPLES} distinct months. The periodicity comes
 * from the median gap, in days, between two consecutive observed months. Pairs
 * already covered by a type are discarded.
 */
export async function suggestDocumentTypes(
	db: Db,
): Promise<DocumentTypeSuggestion[]> {
	const monthExpression = sql<string>`to_char(date_trunc('month', ${anchorDate}), 'YYYY-MM-01')`;

	const rows = await db
		.select({
			documentId: document.id,
			partyId: documentParty.partyId,
			partyName: party.name,
			categoryId: document.categoryId,
			categoryName: category.name,
			month: monthExpression,
		})
		.from(documentParty)
		.innerJoin(document, eq(document.id, documentParty.documentId))
		.innerJoin(party, eq(party.id, documentParty.partyId))
		.innerJoin(category, eq(category.id, document.categoryId))
		.where(
			and(
				eq(documentParty.role, "issuer"),
				isNull(document.deletedAt),
				isNotNull(anchorDate),
			),
		)
		.orderBy(monthExpression, asc(document.id));

	const existing = await db
		.select({
			issuerPartyId: documentType.issuerPartyId,
			categoryId: documentType.categoryId,
		})
		.from(documentType);

	type Bucket = {
		partyId: string;
		partyName: string;
		categoryId: string;
		categoryName: string;
		months: string[];
		documentIds: string[];
	};
	const buckets = new Map<string, Bucket>();
	for (const row of rows) {
		if (!row.categoryId || !row.categoryName) continue;
		const key = `${row.partyId}:${row.categoryId}`;
		const bucket = buckets.get(key);
		if (bucket) {
			bucket.months.push(row.month);
			bucket.documentIds.push(row.documentId);
		} else {
			buckets.set(key, {
				partyId: row.partyId,
				partyName: row.partyName,
				categoryId: row.categoryId,
				categoryName: row.categoryName,
				months: [row.month],
				documentIds: [row.documentId],
			});
		}
	}

	const suggestions: DocumentTypeSuggestion[] = [];
	for (const bucket of buckets.values()) {
		const covered = existing.some((row) =>
			documentTypeCoversCouple(row, bucket.partyId, bucket.categoryId),
		);
		if (covered) continue;

		const months = [...new Set(bucket.months)].sort();
		if (months.length < SUGGEST_MIN_SAMPLES) continue;

		const periodicity = periodicityFromDayGaps(dayGapsBetween(months));
		const firstMonth = months[0];
		const lastMonth = months.at(-1);
		if (!firstMonth || !lastMonth) continue;

		suggestions.push({
			partyId: bucket.partyId,
			partyName: bucket.partyName,
			categoryId: bucket.categoryId,
			categoryName: bucket.categoryName,
			periodicity,
			startPeriod: periodStartOf(periodicity, firstMonth),
			endPeriod: periodStartOf(periodicity, lastMonth),
			sampleCount: months.length,
			documentIds: [...new Set(bucket.documentIds)],
		});
	}

	return suggestions.sort((a, b) => b.sampleCount - a.sampleCount);
}

/* ------------------------------------------------------------------ */
/* Overrides and membership                                             */
/* ------------------------------------------------------------------ */

export async function setDocumentOverride(
	db: Db,
	input: SetDocumentTypeOverrideInput,
): Promise<DocumentTypeDetail> {
	await requireDocumentType(db, input.documentTypeId);
	await requireLiveDocument(db, input.documentId);

	if (input.included === null) {
		await db
			.delete(documentTypeOverride)
			.where(
				and(
					eq(documentTypeOverride.documentTypeId, input.documentTypeId),
					eq(documentTypeOverride.documentId, input.documentId),
				),
			);
		return getDocumentType(db, input.documentTypeId);
	}

	await db
		.insert(documentTypeOverride)
		.values({
			documentTypeId: input.documentTypeId,
			documentId: input.documentId,
			included: input.included,
		})
		.onConflictDoUpdate({
			target: [
				documentTypeOverride.documentId,
				documentTypeOverride.documentTypeId,
			],
			set: { included: input.included },
		});

	return getDocumentType(db, input.documentTypeId);
}

/** Ids of a category and of all its ancestors, the category itself included. */
async function categoryAncestorIds(
	db: Db,
	categoryId: string | null,
): Promise<Set<string>> {
	const chain = new Set<string>();
	if (!categoryId) return chain;

	const rows = await db
		.select({ id: category.id, parentId: category.parentId })
		.from(category);
	const parents = new Map(rows.map((row) => [row.id, row.parentId]));

	let current: string | null = categoryId;
	while (current && !chain.has(current)) {
		chain.add(current);
		current = parents.get(current) ?? null;
	}
	return chain;
}

/**
 * The document type of a document, as shown on the document page.
 *
 * The assignment carried by `document.document_type_id` wins; otherwise a
 * forced override, otherwise the first recurring type whose issuer, category
 * and bounds cover the document (this is how the migrated Series keep working
 * without touching their members).
 */
export async function documentTypeForDocument(
	db: Db,
	documentId: string,
): Promise<DocumentTypeMembership | null> {
	const documentRows = await db
		.select({
			id: document.id,
			categoryId: document.categoryId,
			documentTypeId: document.documentTypeId,
			documentTypeSource: document.documentTypeSource,
			documentTypeConfidence: document.documentTypeConfidence,
			layoutId: document.layoutId,
			anchor: anchorDate,
			deletedAt: document.deletedAt,
		})
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	const doc = documentRows[0];
	if (!doc) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${documentId}" not found.`,
		});
	}

	const [rows, issuerRows, overrideRows, categoryIds] = await Promise.all([
		db
			.select()
			.from(documentType)
			.orderBy(
				asc(documentType.priority),
				asc(documentType.name),
				asc(documentType.id),
			),
		db
			.select({ partyId: documentParty.partyId })
			.from(documentParty)
			.where(
				and(
					eq(documentParty.documentId, documentId),
					eq(documentParty.role, "issuer"),
				),
			),
		db
			.select({
				documentTypeId: documentTypeOverride.documentTypeId,
				included: documentTypeOverride.included,
			})
			.from(documentTypeOverride)
			.where(eq(documentTypeOverride.documentId, documentId)),
		categoryAncestorIds(db, doc.categoryId),
	]);

	const issuers = new Set(issuerRows.map((row) => row.partyId));
	const overrides = new Map(
		overrideRows.map((row) => [row.documentTypeId, row.included]),
	);
	const byId = new Map(rows.map((row) => [row.id, row]));

	let match: DocumentTypeRow | undefined;
	let membership: DocumentTypeMembership["membership"] = "computed";

	if (doc.documentTypeId) {
		match = byId.get(doc.documentTypeId);
		const override = overrides.get(doc.documentTypeId);
		membership =
			override === false
				? "excluded"
				: override === true
					? "forced"
					: "computed";
	}
	if (!match) {
		const forced = overrideRows.find((row) => row.included);
		if (forced) {
			match = byId.get(forced.documentTypeId);
			membership = "forced";
		}
	}
	if (!match && doc.anchor && !doc.deletedAt) {
		match = rows.find((row) => {
			if (!row.periodicity || !row.startPeriod) return false;
			if (overrides.get(row.id) === false) return false;
			if (row.issuerPartyId === null && row.categoryId === null) return false;
			const matchesParty =
				row.issuerPartyId === null || issuers.has(row.issuerPartyId);
			const matchesCategory =
				row.categoryId === null || categoryIds.has(row.categoryId);
			if (!matchesParty || !matchesCategory) return false;
			const start = periodStartOf(row.periodicity, doc.anchor as string);
			const first = periodStartOf(row.periodicity, row.startPeriod);
			const last = row.endPeriod
				? periodStartOf(row.periodicity, row.endPeriod)
				: null;
			return start >= first && (last === null || start <= last);
		});
		membership = "computed";
	}
	if (!match) return null;

	const layout = doc.layoutId
		? ((
				await db
					.select({
						id: documentTypeLayout.id,
						name: documentTypeLayout.name,
						isDefault: documentTypeLayout.isDefault,
					})
					.from(documentTypeLayout)
					.where(eq(documentTypeLayout.id, doc.layoutId))
					.limit(1)
			)[0] ?? null)
		: null;

	return {
		id: match.id,
		name: match.name,
		icon: match.icon,
		color: match.color,
		source: doc.documentTypeId === match.id ? doc.documentTypeSource : "manual",
		confidence:
			doc.documentTypeId === match.id ? doc.documentTypeConfidence : null,
		layout,
		period:
			match.periodicity && doc.anchor
				? periodKeyOf(match.periodicity, doc.anchor)
				: null,
		membership,
	};
}

/* ------------------------------------------------------------------ */
/* Apply, detect, preview                                               */
/* ------------------------------------------------------------------ */

export async function applyDocumentType(
	db: Db,
	input: ApplyDocumentTypeInput,
	options: DocumentTypeServiceOptions = {},
): Promise<ApplyDocumentTypeResult> {
	const type = await requireDocumentType(db, input.documentTypeId);
	// A disabled type is out of the automatic flow: applying it by hand stays
	// possible, but only on purpose.
	if (!type.enabled && !input.force) {
		throw new ORPCError("BAD_REQUEST", {
			message: `The document type "${type.name}" is disabled. Re-run with \`force\` to apply it anyway.`,
		});
	}
	if (input.layoutId) {
		const layout = await requireLayout(db, input.layoutId);
		if (layout.documentTypeId !== input.documentTypeId) {
			throw new ORPCError("BAD_REQUEST", {
				message: "This layout does not belong to the document type.",
			});
		}
	}

	const ids = [...new Set(input.documentIds)];
	// A trashed document is a caller mistake, not a per-item failure: it is
	// refused up front. A missing id stays reported document by document.
	const trashed = await db
		.select({ id: document.id })
		.from(document)
		.where(and(inArray(document.id, ids), isNotNull(document.deletedAt)));
	if (trashed.length > 0) {
		throw new ORPCError("CONFLICT", {
			message: `Document is in the trash; restore it first. (${trashed
				.map((row) => row.id)
				.join(", ")})`,
		});
	}
	const results: ApplyDocumentTypeResultItem[] = [];
	for (const documentId of ids) {
		try {
			const before = await db
				.select({ validUntil: document.validUntil })
				.from(document)
				.where(eq(document.id, documentId))
				.limit(1);
			const outcome = await applyDocumentTypeToDocument(
				db,
				documentId,
				input.documentTypeId,
				{
					source: "manual",
					...(input.layoutId ? { layoutId: input.layoutId } : {}),
					...(options.ingestion ? { ingestion: options.ingestion } : {}),
				},
			);
			// The type's extraction rules can set `validUntil` (`set_valid_until`):
			// the expiry reminders are regenerated synchronously when it moved.
			const after = await db
				.select({ validUntil: document.validUntil })
				.from(document)
				.where(eq(document.id, documentId))
				.limit(1);
			if (before[0]?.validUntil !== after[0]?.validUntil) {
				await generateRemindersForDocument(db, documentId);
			}
			results.push({
				documentId,
				applied: true,
				layoutId: outcome.layoutId,
				layoutReason: outcome.layoutReason,
				fieldsWritten: outcome.fieldsWritten,
				error: null,
			});
		} catch (error) {
			results.push({
				documentId,
				applied: false,
				layoutId: null,
				layoutReason: "none",
				fieldsWritten: 0,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {
		applied: results.filter((item) => item.applied).length,
		results,
	};
}

export async function detectDocumentType(
	db: Db,
	documentId: string,
): Promise<DetectDocumentTypeResult> {
	await requireDocument(db, documentId);
	return { candidates: await detectDocumentTypes(db, documentId) };
}

/** What applying a type (persisted or draft) would do, without writing. */
export async function previewDocumentType(
	db: Db,
	input: PreviewDocumentTypeInput,
): Promise<PreviewDocumentTypeResult> {
	const prepared = await buildSubject(db, input.documentId);
	if (!prepared) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${input.documentId}" not found.`,
		});
	}

	const persisted = input.id ? await requireDocumentType(db, input.id) : null;
	const draft = input.draft;
	const spec = {
		id: persisted?.id ?? null,
		name: persisted?.name ?? draft?.name ?? "Draft",
		categoryId: persisted?.categoryId ?? draft?.categoryId ?? null,
		issuerPartyId: persisted?.issuerPartyId ?? draft?.issuerPartyId ?? null,
		subjectPartyId: persisted?.subjectPartyId ?? draft?.subjectPartyId ?? null,
		tagIds: persisted?.tagIds ?? draft?.tagIds ?? [],
		sensitiveDefault:
			persisted?.sensitiveDefault ?? draft?.sensitiveDefault ?? false,
		titleTemplate: persisted?.titleTemplate ?? draft?.titleTemplate ?? null,
		periodicity: persisted?.periodicity ?? null,
	};

	const [categoryRows, partyRows, tagRows] = await Promise.all([
		spec.categoryId
			? db
					.select({ id: category.id, name: category.name })
					.from(category)
					.where(eq(category.id, spec.categoryId))
					.limit(1)
			: Promise.resolve([]),
		spec.issuerPartyId || spec.subjectPartyId
			? db
					.select({ id: party.id, name: party.name })
					.from(party)
					.where(
						inArray(
							party.id,
							[spec.issuerPartyId, spec.subjectPartyId].filter(
								(id): id is string => id !== null,
							),
						),
					)
			: Promise.resolve([]),
		spec.tagIds.length > 0
			? db
					.select({ id: tag.id, name: tag.name })
					.from(tag)
					.where(inArray(tag.id, spec.tagIds))
			: Promise.resolve([]),
	]);

	const partyNames = new Map(partyRows.map((row) => [row.id, row.name]));
	const parties: PreviewDocumentTypeResult["parties"] = [];
	if (spec.issuerPartyId) {
		parties.push({
			partyId: spec.issuerPartyId,
			name: partyNames.get(spec.issuerPartyId) ?? spec.issuerPartyId,
			role: "issuer",
		});
	}
	if (spec.subjectPartyId) {
		parties.push({
			partyId: spec.subjectPartyId,
			name: partyNames.get(spec.subjectPartyId) ?? spec.subjectPartyId,
			role: "subject",
		});
	}

	const layouts = persisted ? await loadLayouts(db, persisted.id) : [];
	const selection = await selectLayout(
		db,
		input.documentId,
		layouts,
		prepared.subject,
	);
	const rules = await extractionRulesFor(db, {
		layoutId: selection.layoutId,
	});
	const extractions = await runExtractionRules(db, input.documentId, rules);

	const anchor =
		prepared.document.periodStart ?? prepared.document.documentDate;

	return {
		documentTypeId: spec.id,
		name: spec.name,
		category: categoryRows[0] ?? null,
		parties,
		tags: tagRows,
		sensitive:
			spec.sensitiveDefault && !prepared.document.sensitive ? true : null,
		title: spec.titleTemplate
			? renderTitleTemplate(
					spec.titleTemplate,
					titleContextOf(prepared.subject),
				)
			: null,
		layout: selection.layoutId
			? {
					id: selection.layoutId,
					name: selection.layoutName ?? "",
					reason: selection.reason,
				}
			: null,
		extractions,
		period:
			spec.periodicity && anchor ? periodKeyOf(spec.periodicity, anchor) : null,
	};
}

/* ------------------------------------------------------------------ */
/* Layouts                                                              */
/* ------------------------------------------------------------------ */

export function listLayouts(
	db: Db,
	documentTypeId: string,
): Promise<DocumentTypeLayoutDto[]> {
	return loadLayouts(db, documentTypeId);
}

export async function addLayout(
	db: Db,
	input: AddDocumentTypeLayoutInput,
): Promise<DocumentTypeLayoutDto> {
	await requireDocumentType(db, input.documentTypeId);
	const existing = await loadLayouts(db, input.documentTypeId);

	const rows = await db
		.insert(documentTypeLayout)
		.values({
			documentTypeId: input.documentTypeId,
			name: input.name,
			validFrom: input.validFrom ?? null,
			validUntil: input.validUntil ?? null,
			signature: input.signature ?? null,
			sortOrder: existing.length,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The layout could not be created.",
		});
	}
	return row;
}

export async function updateLayout(
	db: Db,
	input: UpdateDocumentTypeLayoutInput,
): Promise<DocumentTypeLayoutDto> {
	const current = await requireLayout(db, input.id);

	const patch: Partial<typeof documentTypeLayout.$inferInsert> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.validFrom !== undefined) patch.validFrom = input.validFrom ?? null;
	if (input.validUntil !== undefined) {
		patch.validUntil = input.validUntil ?? null;
	}
	if (input.signature !== undefined) patch.signature = input.signature ?? null;
	if (Object.keys(patch).length === 0) return current;

	const rows = await db
		.update(documentTypeLayout)
		.set(patch)
		.where(eq(documentTypeLayout.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Layout "${input.id}" not found.`,
		});
	}
	return row;
}

export async function removeLayout(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	const layout = await requireLayout(db, id);
	const siblings = await loadLayouts(db, layout.documentTypeId);
	if (siblings.length <= 1) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"A document type always keeps at least one layout: this one cannot be deleted.",
		});
	}

	// The extraction rules of the layout go away with it (cascade).
	await db.delete(documentTypeLayout).where(eq(documentTypeLayout.id, id));

	// The default layout is the fallback of the type: another one takes over.
	if (layout.isDefault) {
		const next = siblings.find((sibling) => sibling.id !== id);
		if (next) {
			await db
				.update(documentTypeLayout)
				.set({ isDefault: true })
				.where(eq(documentTypeLayout.id, next.id));
		}
	}
	return { id, deleted: true as const };
}

export async function reorderLayouts(
	db: Db,
	input: ReorderDocumentTypeLayoutsInput,
): Promise<DocumentTypeLayoutDto[]> {
	await requireDocumentType(db, input.documentTypeId);
	const ids = [...new Set(input.ids)];
	const existing = await loadLayouts(db, input.documentTypeId);
	const known = new Set(existing.map((row) => row.id));
	const missing = ids.filter((id) => !known.has(id));
	if (missing.length > 0) {
		throw new ORPCError("NOT_FOUND", {
			message: `Layout not found on this type: ${missing.join(", ")}.`,
		});
	}

	await db.transaction(async (tx) => {
		for (const [index, id] of ids.entries()) {
			await tx
				.update(documentTypeLayout)
				.set({ sortOrder: index })
				.where(eq(documentTypeLayout.id, id));
		}
	});
	return loadLayouts(db, input.documentTypeId);
}

/**
 * Creates a layout whose signature is seeded from the distinctive tokens of the
 * document (the first rare words of its OCR text). Deliberately simple: the
 * user refines the condition afterwards.
 */
export async function createLayoutFromDocument(
	db: Db,
	input: CreateLayoutFromDocumentInput,
): Promise<DocumentTypeLayoutDto> {
	await requireDocumentType(db, input.documentTypeId);
	// The signature is the document made into a rule: it is never seeded from
	// something the user dropped (SPEC §2).
	await requireLiveDocument(db, input.documentId);
	const rows = await db
		.select({ content: document.content })
		.from(document)
		.where(eq(document.id, input.documentId))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${input.documentId}" not found.`,
		});
	}

	return addLayout(db, {
		documentTypeId: input.documentTypeId,
		name: input.name,
		signature: signatureFromText(row.content ?? ""),
	});
}

/** Runs the extraction rules of a layout on a document, without writing. */
export async function testLayout(
	db: Db,
	input: TestDocumentTypeLayoutInput,
): Promise<TestDocumentTypeLayoutResult> {
	const layout = await requireLayout(db, input.layoutId);
	const prepared = await buildSubject(db, input.documentId);
	if (!prepared) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${input.documentId}" not found.`,
		});
	}

	const rules = await layoutExtractionRules(db, layout.id);
	const results = await runExtractionRules(db, input.documentId, rules);

	return {
		layoutId: layout.id,
		layoutName: layout.name,
		results,
		averageConfidence: averageResultConfidence(results),
		signatureMatched: layout.signature
			? evaluateCondition(layout.signature, prepared.subject).matched
			: null,
	};
}

/** Enabled recurring types, for reminder generation. */
export function enabledRecurringTypes(db: Db): Promise<DocumentTypeRow[]> {
	return db
		.select()
		.from(documentType)
		.where(
			and(eq(documentType.enabled, true), isNotNull(documentType.periodicity)),
		)
		.orderBy(asc(documentType.id));
}

export type { Periodicity };
