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
	getContentLocale,
	layoutExtractionRules,
	loadLayouts,
	runExtractionRules,
	selectLayout,
	signatureFromText,
	typeTitleContext,
} from "@docstore/ingestion";
import { evaluateCondition, renderTitleTemplate } from "@docstore/rules";
import { isManualField } from "@docstore/shared/document";
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
	DocumentTypeTitlePreview,
	LayoutOverlap,
	ListDocumentTypesInput,
	PreviewDocumentTypeInput,
	PreviewDocumentTypeResult,
	PreviewDocumentTypeTitlesInput,
	RecurrenceInput,
	RegenerateDocumentTypeTitlesInput,
	RegenerateTitlesResult,
	ReorderDocumentTypeLayoutsInput,
	ReorderDocumentTypesInput,
	SavedDocumentTypeLayout,
	SetDocumentTypeOverrideInput,
	TestDocumentTypeLayoutInput,
	TestDocumentTypeLayoutResult,
	ToggleDocumentTypeInput,
	UpdateDocumentTypeInput,
	UpdateDocumentTypeLayoutInput,
} from "@docstore/shared/document-type";
import {
	DEFAULT_RECURRING_TITLE_TEMPLATE,
	documentTypeCoversCouple,
	suggestedDocumentTypeName,
} from "@docstore/shared/document-type";
import type {
	Periodicity,
	RecurrencePeriod,
	RecurrenceRange,
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

/** The three recurrence columns the effective range is resolved from. */
type RecurrenceBounds = Pick<
	DocumentTypeRow,
	"periodicity" | "startPeriod" | "endPeriod"
>;

/**
 * Effective range of the recurrence, both bounds resolved.
 *
 * `startPeriod` and `endPeriod` are optional: whatever is missing is read from
 * the member documents. The range starts at the oldest member when no first
 * period was set, and an open recurrence runs to the current period — further
 * still when a member is filed ahead of it. `null` means there is nothing to
 * enumerate: the type is not recurring, or it has neither a first period nor a
 * single member, and a red cell reaching back to 1970 helps nobody.
 *
 * `end` is the logical bound of the recurrence. The timeline stops at the
 * current period on top of it, so a recurrence closing in the future never
 * paints periods nobody could have filed yet.
 */
export function effectiveRecurrenceRange(
	type: RecurrenceBounds,
	members: readonly DocumentTypeMember[],
	today: string = todayIso(),
): RecurrenceRange | null {
	const periodicity = type.periodicity;
	if (!periodicity) return null;

	let oldest: string | null = null;
	let newest: string | null = null;
	for (const member of members) {
		const start = periodStartOf(periodicity, member.anchor);
		if (oldest === null || start < oldest) oldest = start;
		if (newest === null || start > newest) newest = start;
	}

	const explicitStart = type.startPeriod
		? periodStartOf(periodicity, type.startPeriod)
		: null;
	const start = explicitStart ?? oldest;
	if (start === null) return null;

	const current = periodStartOf(periodicity, today);
	const explicitEnd = type.endPeriod
		? periodStartOf(periodicity, type.endPeriod)
		: null;
	const end =
		explicitEnd ?? (newest !== null && newest > current ? newest : current);

	return {
		start,
		end,
		derived: explicitStart === null,
		open: explicitEnd === null,
	};
}

/** Member identifiers, for the `documentTypeId` filter of `document.list`. */
export async function documentTypeMemberDocumentIds(
	db: Db,
	documentTypeId: string,
): Promise<string[]> {
	const row = await requireDocumentType(db, documentTypeId);
	const members = await documentTypeMembers(db, row);
	const range = effectiveRecurrenceRange(row, members);
	const periodicity = row.periodicity;
	if (!periodicity || !range) {
		return members.map((member) => member.documentId);
	}
	return members
		.filter((member) => {
			const start = periodStartOf(periodicity, member.anchor);
			return start >= range.start && start <= range.end;
		})
		.map((member) => member.documentId);
}

/**
 * Timeline period by period, over the effective range only. `pending` = period
 * whose due date (expected date + `graceDays`) has not passed yet. Empty for a
 * non-recurring type, and for a recurrence nothing bounds yet.
 */
function buildTimeline(
	row: DocumentTypeRow,
	periodicity: Periodicity,
	members: readonly DocumentTypeMember[],
	range: RecurrenceRange,
	today: string,
): RecurrencePeriod[] {
	// A single document per period: the oldest one wins.
	const byPeriod = new Map<string, DocumentTypeMember>();
	for (const member of members) {
		const start = periodStartOf(periodicity, member.anchor);
		const current = byPeriod.get(start);
		if (!current || member.anchor < current.anchor) {
			byPeriod.set(start, member);
		}
	}

	// Nothing is enumerated past the current period: a period that has not begun
	// is neither missing nor pending, it simply does not exist yet.
	const currentPeriod = periodStartOf(periodicity, today);
	const upperBound = range.end < currentPeriod ? range.end : currentPeriod;
	const periods = enumeratePeriods(periodicity, range.start, upperBound);
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

/**
 * Everything a recurring type needs read at once: its members are loaded a
 * single time, and the range they resolve feeds both the timeline and what the
 * interface shows above it.
 */
export interface RecurrenceView {
	members: DocumentTypeMember[];
	range: RecurrenceRange | null;
	timeline: RecurrencePeriod[];
}

export async function recurrenceViewOf(
	db: Db,
	row: DocumentTypeRow,
	today: string = todayIso(),
): Promise<RecurrenceView> {
	const members = await documentTypeMembers(db, row);
	const range = effectiveRecurrenceRange(row, members, today);
	const periodicity = row.periodicity;
	return {
		members,
		range,
		timeline:
			periodicity && range
				? buildTimeline(row, periodicity, members, range, today)
				: [],
	};
}

/** Timeline of a recurring type; empty when nothing bounds the recurrence. */
export async function documentTypeTimeline(
	db: Db,
	row: DocumentTypeRow,
	today: string = todayIso(),
): Promise<RecurrencePeriod[]> {
	return (await recurrenceViewOf(db, row, today)).timeline;
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

interface PartyLabel {
	name: string;
	logoKey: string | null;
}

async function labelsFor(
	db: Db,
	rows: DocumentTypeRow[],
): Promise<{
	parties: Map<string, PartyLabel>;
	categories: Map<string, string>;
}> {
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
					.select({ id: party.id, name: party.name, logoKey: party.logoKey })
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
		parties: new Map(
			partyRows.map((row) => [
				row.id,
				{ name: row.name, logoKey: row.logoKey },
			]),
		),
		categories: new Map(categoryRows.map((row) => [row.id, row.name])),
	};
}

/** Party reference exposed on a document type item (`issuer`/`subject`). */
function partyRefFor(
	partyId: string | null,
	labels: Map<string, PartyLabel>,
): { id: string; name: string; logoKey: string | null } | null {
	if (!partyId) return null;
	const label = labels.get(partyId);
	return label
		? { id: partyId, name: label.name, logoKey: label.logoKey }
		: null;
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
	range: RecurrenceRange | null,
): DocumentTypeItem {
	return {
		...row,
		categoryName: row.categoryId
			? (labels.categories.get(row.categoryId) ?? null)
			: null,
		issuerName: row.issuerPartyId
			? (labels.parties.get(row.issuerPartyId)?.name ?? null)
			: null,
		subjectName: row.subjectPartyId
			? (labels.parties.get(row.subjectPartyId)?.name ?? null)
			: null,
		issuer: partyRefFor(row.issuerPartyId, labels.parties),
		subject: partyRefFor(row.subjectPartyId, labels.parties),
		layoutCount: counts.layouts.get(row.id) ?? 0,
		documentCount: counts.documents.get(row.id) ?? 0,
		stats,
		range,
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
		if (!row.periodicity) {
			items.push(toItem(row, labels, counts, null, null));
			continue;
		}
		const view = await recurrenceViewOf(db, row, today);
		items.push(
			toItem(row, labels, counts, statsFromTimeline(view.timeline), view.range),
		);
	}
	return items;
}

/**
 * Members whose period falls before an **explicit** `startPeriod`: they belong
 * to the type but sit outside the window the timeline enumerates, so nothing
 * would show them. A recurrence without a first period has none of those: its
 * range extends down to the oldest document instead.
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
	const [labels, counts, view, layouts] = await Promise.all([
		labelsFor(db, [row]),
		countsFor(db, [row.id]),
		recurrenceViewOf(db, row),
		loadLayouts(db, row.id),
	]);

	return {
		...toItem(
			row,
			labels,
			counts,
			row.periodicity ? statsFromTimeline(view.timeline) : null,
			view.range,
		),
		layouts,
		timeline: view.timeline,
		memberCount: view.members.length,
		outOfRange: outOfRangeMembers(row, view.members),
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
	// No first period: the range starts at the oldest document of the type, and
	// follows it as older ones arrive (`effectiveRecurrenceRange`).
	const startPeriod = recurrence.startPeriod
		? periodStartOf(recurrence.periodicity, recurrence.startPeriod)
		: null;
	const endPeriod = recurrence.endPeriod ?? null;
	if (startPeriod && endPeriod && endPeriod < startPeriod) {
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
			paperOriginal: input.paperOriginal,
			// A recurring type gets a template out of the box, so its documents
			// come out named after their period; a caller that passed one (even
			// `null`, to say "leave the titles alone") is always obeyed.
			titleTemplate:
				input.titleTemplate !== undefined
					? (input.titleTemplate ?? null)
					: input.recurrence
						? DEFAULT_RECURRING_TITLE_TEMPLATE
						: null,
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
	if (input.paperOriginal !== undefined) {
		patch.paperOriginal = input.paperOriginal;
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
		paperOriginal: false,
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
		paperOriginal: false,
		recurrence: {
			periodicity: input.periodicity,
			// Without a first period, the range follows the documents themselves.
			startPeriod: input.startPeriod ?? null,
			// An open recurrence: the point is to spot the next missing period.
			endPeriod: input.endPeriod ?? null,
		},
	});

	const [labels, counts, view] = await Promise.all([
		labelsFor(db, [created]),
		countsFor(db, [created.id]),
		recurrenceViewOf(db, created),
	]);
	return toItem(
		created,
		labels,
		counts,
		statsFromTimeline(view.timeline),
		view.range,
	);
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
			partyLogoKey: party.logoKey,
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
		partyLogoKey: string | null;
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
				partyLogoKey: row.partyLogoKey,
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
			partyLogoKey: bucket.partyLogoKey,
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
			if (!row.periodicity) return false;
			if (overrides.get(row.id) === false) return false;
			if (row.issuerPartyId === null && row.categoryId === null) return false;
			const matchesParty =
				row.issuerPartyId === null || issuers.has(row.issuerPartyId);
			const matchesCategory =
				row.categoryId === null || categoryIds.has(row.categoryId);
			if (!matchesParty || !matchesCategory) return false;
			const start = periodStartOf(row.periodicity, doc.anchor as string);
			// Without a first period the range simply extends down to this
			// document: only an explicit bound can leave it outside.
			const first = row.startPeriod
				? periodStartOf(row.periodicity, row.startPeriod)
				: null;
			const last = row.endPeriod
				? periodStartOf(row.periodicity, row.endPeriod)
				: null;
			return (
				(first === null || start >= first) && (last === null || start <= last)
			);
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
					typeTitleContext(
						{ name: spec.name, periodicity: spec.periodicity },
						prepared.subject,
					),
					await getContentLocale(db),
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
/* Titles                                                               */
/* ------------------------------------------------------------------ */

/** What the template of a type would make of the title of one document. */
interface TitleOutcome {
	documentId: string;
	currentTitle: string;
	/** `null` when the template renders nothing usable. */
	title: string | null;
	manual: boolean;
}

async function titleOutcomeFor(
	db: Db,
	documentId: string,
	type: Pick<DocumentTypeRow, "name" | "periodicity" | "titleTemplate">,
): Promise<TitleOutcome | null> {
	if (!type.titleTemplate) return null;
	const prepared = await buildSubject(db, documentId);
	if (!prepared) return null;
	const rendered = renderTitleTemplate(
		type.titleTemplate,
		typeTitleContext(type, prepared.subject),
		// A stored title is content: it follows `content.locale`, not the
		// English interface.
		await getContentLocale(db),
	);
	return {
		documentId,
		currentTitle: prepared.document.title,
		title: rendered.trim().length > 0 ? rendered : null,
		manual: isManualField(prepared.document.manualFields, "title"),
	};
}

/** Both procedures refuse a type that would render nothing at all. */
function requireTitleTemplate(row: DocumentTypeRow): void {
	if (!row.titleTemplate) {
		throw new ORPCError("BAD_REQUEST", {
			message: `The document type "${row.name}" has no title template.`,
		});
	}
}

/** Members of a type, most recent period first. */
async function membersNewestFirst(
	db: Db,
	row: DocumentTypeRow,
): Promise<DocumentTypeMember[]> {
	const members = await documentTypeMembers(db, row);
	return members.sort((a, b) => b.anchor.localeCompare(a.anchor));
}

/**
 * Titles the template of a type would produce, without writing anything: what
 * the confirmation dialog shows before the rewrite.
 */
export async function previewDocumentTypeTitles(
	db: Db,
	input: PreviewDocumentTypeTitlesInput,
): Promise<DocumentTypeTitlePreview[]> {
	const row = await requireDocumentType(db, input.id);
	requireTitleTemplate(row);

	const members = (await membersNewestFirst(db, row)).slice(0, input.limit);
	const previews: DocumentTypeTitlePreview[] = [];
	for (const member of members) {
		const outcome = await titleOutcomeFor(db, member.documentId, row);
		if (!outcome) continue;
		previews.push({
			documentId: outcome.documentId,
			currentTitle: outcome.currentTitle,
			title: outcome.title,
			manual: outcome.manual,
		});
	}
	return previews;
}

/** Writes the rendered titles; `skipped` covers manual, empty and unchanged. */
async function writeTitles(
	db: Db,
	outcomes: (TitleOutcome | null)[],
	overwriteManual: boolean,
): Promise<RegenerateTitlesResult> {
	let updated = 0;
	let skipped = 0;
	for (const outcome of outcomes) {
		if (
			outcome === null ||
			outcome.title === null ||
			(outcome.manual && !overwriteManual) ||
			outcome.title === outcome.currentTitle
		) {
			skipped += 1;
			continue;
		}
		// The rewrite does not mark the title manual: the next run must be free
		// to follow the template again.
		await db
			.update(document)
			.set({ title: outcome.title })
			.where(eq(document.id, outcome.documentId));
		updated += 1;
	}
	return { updated, skipped };
}

/**
 * Rewrites the titles of the members of a type from its template. A title
 * someone typed by hand is kept unless `overwriteManual` says otherwise.
 */
export async function regenerateDocumentTypeTitles(
	db: Db,
	input: RegenerateDocumentTypeTitlesInput,
): Promise<RegenerateTitlesResult> {
	const row = await requireDocumentType(db, input.id);
	requireTitleTemplate(row);

	const members = await membersNewestFirst(db, row);
	const outcomes: (TitleOutcome | null)[] = [];
	for (const member of members) {
		outcomes.push(await titleOutcomeFor(db, member.documentId, row));
	}
	return writeTitles(db, outcomes, input.overwriteManual);
}

/**
 * Same rewrite for an arbitrary selection: every document uses the template of
 * the type **it** carries. A document without a type, or whose type has no
 * template, is skipped.
 */
export async function regenerateTitlesForDocuments(
	db: Db,
	documentIds: string[],
	options: { overwriteManual?: boolean } = {},
): Promise<RegenerateTitlesResult> {
	const ids = [...new Set(documentIds)];
	if (ids.length === 0) return { updated: 0, skipped: 0 };

	const rows = await db
		.select({ id: document.id, documentTypeId: document.documentTypeId })
		.from(document)
		.where(inArray(document.id, ids));

	const typeIds = [
		...new Set(
			rows.map((row) => row.documentTypeId).filter((id) => id !== null),
		),
	];
	const types =
		typeIds.length > 0
			? await db
					.select()
					.from(documentType)
					.where(inArray(documentType.id, typeIds))
			: [];
	const byId = new Map(types.map((row) => [row.id, row]));

	const outcomes: (TitleOutcome | null)[] = [];
	for (const row of rows) {
		const type = row.documentTypeId ? byId.get(row.documentTypeId) : undefined;
		outcomes.push(type ? await titleOutcomeFor(db, row.id, type) : null);
	}
	return writeTitles(db, outcomes, options.overwriteManual ?? false);
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

/** `null` on either side means "open": the widest of the two bounds wins. */
function laterBound(a: string | null, b: string | null): string | null {
	if (a === null) return b;
	if (b === null) return a;
	return a > b ? a : b;
}

function earlierBound(a: string | null, b: string | null): string | null {
	if (a === null) return b;
	if (b === null) return a;
	return a < b ? a : b;
}

/**
 * Siblings whose validity window meets the one of `layout`.
 *
 * A layout without any bound never takes part: `coversDate` only considers a
 * layout that states at least one bound, so an unbounded one is not in the
 * date-range race at all. The result is advisory — nothing refuses the write,
 * because a temporary overlap while both ends are being typed in is normal.
 */
async function layoutOverlaps(
	db: Db,
	layout: DocumentTypeLayoutDto,
): Promise<LayoutOverlap[]> {
	if (!layout.validFrom && !layout.validUntil) return [];
	const siblings = await loadLayouts(db, layout.documentTypeId);
	const overlaps: LayoutOverlap[] = [];
	for (const sibling of siblings) {
		if (sibling.id === layout.id) continue;
		if (!sibling.validFrom && !sibling.validUntil) continue;
		const from = laterBound(layout.validFrom, sibling.validFrom);
		const until = earlierBound(layout.validUntil, sibling.validUntil);
		if (from !== null && until !== null && from > until) continue;
		overlaps.push({ id: sibling.id, name: sibling.name, from, until });
	}
	return overlaps;
}

export async function addLayout(
	db: Db,
	input: AddDocumentTypeLayoutInput,
): Promise<SavedDocumentTypeLayout> {
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
	return { ...row, overlaps: await layoutOverlaps(db, row) };
}

export async function updateLayout(
	db: Db,
	input: UpdateDocumentTypeLayoutInput,
): Promise<SavedDocumentTypeLayout> {
	const current = await requireLayout(db, input.id);

	const patch: Partial<typeof documentTypeLayout.$inferInsert> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.validFrom !== undefined) patch.validFrom = input.validFrom ?? null;
	if (input.validUntil !== undefined) {
		patch.validUntil = input.validUntil ?? null;
	}
	if (input.signature !== undefined) patch.signature = input.signature ?? null;
	if (Object.keys(patch).length === 0) {
		return { ...current, overlaps: await layoutOverlaps(db, current) };
	}

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
	return { ...row, overlaps: await layoutOverlaps(db, row) };
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

/**
 * Moves the "Default" of a type onto another of its layouts.
 *
 * The default layout is the fallback when nothing else matches, and the home of
 * the extraction rules of a type that has only one. Until now it was whichever
 * layout `documentType.create` opened, for good: the only way to move it was to
 * delete it and let `removeLayout` promote a sibling, taking its extraction
 * rules down with it. A type keeps exactly one, so promoting demotes the other.
 */
export async function setDefaultLayout(
	db: Db,
	id: string,
): Promise<DocumentTypeLayoutDto[]> {
	const layout = await requireLayout(db, id);
	if (layout.isDefault) return loadLayouts(db, layout.documentTypeId);

	await db.transaction(async (tx) => {
		await tx
			.update(documentTypeLayout)
			.set({ isDefault: false })
			.where(
				and(
					eq(documentTypeLayout.documentTypeId, layout.documentTypeId),
					eq(documentTypeLayout.isDefault, true),
				),
			);
		await tx
			.update(documentTypeLayout)
			.set({ isDefault: true })
			.where(eq(documentTypeLayout.id, id));
	});
	return loadLayouts(db, layout.documentTypeId);
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
