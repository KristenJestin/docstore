import type { Db } from "@docstore/db";
import { category } from "@docstore/db/schema/category";
import { documentFieldValue } from "@docstore/db/schema/custom-field";
import { document, documentParty } from "@docstore/db/schema/document";
import {
	documentType,
	documentTypeLayout,
} from "@docstore/db/schema/document-type";
import { party } from "@docstore/db/schema/party";
import { pickDocumentDate } from "@docstore/rules";
import type { ReviewReason } from "@docstore/shared/document";
import {
	isBlockingReviewReason,
	isManualField,
} from "@docstore/shared/document";
import { documentTypeCoversCouple } from "@docstore/shared/document-type";
import {
	dayGapsBetween,
	PERIODICITY_LABELS,
	periodicityFromDayGaps,
	periodStartOf,
	SUGGEST_MIN_SAMPLES,
} from "@docstore/shared/recurrence";
import type { RuleTrigger } from "@docstore/shared/rule";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { IngestionContext } from "./context";
import { applyDocumentType, detectDocumentTypes } from "./document-type";
import { applyRules } from "./rules";
import { getReviewSettings } from "./settings";
import type { DocumentSubject } from "./subject";
import { buildSubject, findTitleDateDuplicate } from "./subject";

/**
 * `analyze` step of the pipeline (SPEC §5).
 *
 * Automatic pre-pass before the rules: Party matching by identifier, date
 * proposal, then execution of the `ingest` rules. Low-confidence proposals feed
 * `document.review_reasons`, which `finalize` turns into the `review` status.
 */

/** Role proposed for a Party matched by identifier. */
const PROPOSED_ROLE = "issuer" as const;

function dedupe(reasons: ReviewReason[]): ReviewReason[] {
	const seen = new Set<string>();
	return reasons.filter((reason) => {
		const key = `${reason.code}:${reason.field ?? ""}:${reason.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Human-readable role, for the review message. */
const ROLE_LABELS = { issuer: "Issuer", subject: "Subject" } as const;

/**
 * Links the Parties matched by identifier, at most one per role.
 *
 * A household member is never the issuer of anything: their IBAN on a payslip
 * is the account the money lands in, their name on a tax notice is who it is
 * addressed to. Matching one proposes them as the **subject** instead, which
 * leaves the issuer slot free for the company that actually sent the document
 * (SPEC §2). Whichever role, a role the document already carries is left alone.
 */
async function proposeParties(
	db: Db,
	documentId: string,
	prepared: DocumentSubject,
	threshold: number,
): Promise<ReviewReason[]> {
	const reasons: ReviewReason[] = [];

	for (const role of ["issuer", "subject"] as const) {
		const taken = prepared.subject.parties.some((item) => item.role === role);
		if (taken) continue;
		const match = prepared.identifierMatches.find((item) =>
			role === "subject" ? item.isHouseholdMember : !item.isHouseholdMember,
		);
		if (!match) continue;

		await db
			.insert(documentParty)
			.values({
				documentId,
				partyId: match.partyId,
				role,
				source: "rule",
				confidence: match.confidence,
			})
			.onConflictDoNothing();

		prepared.subject.parties.push({
			partyId: match.partyId,
			role,
			name: match.partyName,
		});

		if (match.confidence >= threshold) continue;
		reasons.push({
			code: "lowConfidence",
			message: `${ROLE_LABELS[role]} "${match.partyName}" proposed from a ${match.identifier.kind} identifier (confidence ${Math.round(match.confidence * 100)}%).`,
			confidence: match.confidence,
			field: role,
		});
	}

	return reasons;
}

/**
 * Fills the covered period from the text ("du 01/08/2026 au 31/08/2026",
 * "period from … to …") when the document does not carry one.
 *
 * Purely informational: a period never sends a document to Review, it is what
 * places a payslip on the timeline of its recurring document type.
 */
async function proposeDocumentPeriod(
	db: Db,
	documentId: string,
	prepared: DocumentSubject,
): Promise<void> {
	const manual = prepared.document.manualFields;
	if (
		isManualField(manual, "periodStart") ||
		isManualField(manual, "periodEnd")
	) {
		return;
	}
	const period = prepared.subject.detectedPeriods?.[0];
	// Nothing detected: whatever the row holds is left alone. A period read off
	// the text, on the other hand, is written even over an earlier automatic
	// value — that is what lets `reprocess` fix what an older analyzer missed.
	if (!period) return;
	if (
		prepared.document.periodStart === period.start &&
		prepared.document.periodEnd === period.end
	) {
		return;
	}

	await db
		.update(document)
		.set({ periodStart: period.start, periodEnd: period.end })
		.where(eq(document.id, documentId));
	prepared.subject.periodStart = period.start;
	prepared.subject.periodEnd = period.end;
}

/**
 * Proposes the date of the document from its text.
 *
 * An explicit payment or issue date ("payé le", "date d'émission", "issued
 * on") wins over the first date of the text: on a payslip that first date is
 * the start of the covered period, which files the document a month early.
 * `document.date_source` records which of the two answered, and
 * `document.date_confidence` how much it is worth — only a bare first date
 * (`inferred`) sits under the threshold, and even then the reason it raises is
 * informational: the date is written, badged, and corrected in one click
 * instead of sending every single document to Review.
 *
 * The date already on the row is overwritten unless a human set it: a payslip
 * ingested before this module learnt to read "payé le" carries the start of its
 * period, and `document.reprocess` is how that gets fixed. A date the pipeline
 * cannot re-derive (no candidate in the text) is left alone rather than
 * cleared.
 */
async function proposeDocumentDate(
	db: Db,
	documentId: string,
	prepared: DocumentSubject,
	threshold: number,
): Promise<ReviewReason[]> {
	const manual = prepared.document.manualFields;
	if (
		isManualField(manual, "documentDate") ||
		isManualField(manual, "datePrecision")
	) {
		return [];
	}
	const pick = pickDocumentDate({
		text: prepared.subject.content,
		detectedDates: prepared.subject.detectedDates,
		periodStart: prepared.subject.periodStart,
		periodEnd: prepared.subject.periodEnd,
	});
	if (!pick) return [];
	const { candidate } = pick;

	await db
		.update(document)
		.set({
			documentDate: candidate.date,
			datePrecision: candidate.precision,
			dateSource: pick.source,
			dateConfidence: pick.confidence,
		})
		.where(eq(document.id, documentId));
	prepared.subject.documentDate = candidate.date;

	if (pick.confidence >= threshold) return [];
	return [
		{
			code: "lowConfidence",
			message: `Date "${candidate.raw}" inferred from the text (confidence ${Math.round(pick.confidence * 100)}%).`,
			confidence: pick.confidence,
			field: "documentDate",
		},
	];
}

/** Anchor date of a document: its period start, otherwise its date. */
const anchorDate = sql<string>`coalesce(${document.periodStart}, ${document.documentDate})`;

/** First day of the month of the anchor date, as `YYYY-MM-01`. */
const anchorMonth = sql<string>`to_char(date_trunc('month', ${anchorDate}), 'YYYY-MM-01')`;

/**
 * Detects that the freshly ingested document completes a recurring
 * Issuer + category pattern: at least {@link SUGGEST_MIN_SAMPLES} documents on
 * distinct periods, and no document type covering the couple yet.
 *
 * The resulting reason is **informational** (SPEC §9): it never sends the
 * document to `review` on its own, and it carries everything
 * `documentType.createFromSuggestion` needs in its `meta`.
 */
async function proposeRecurringType(
	db: Db,
	documentId: string,
): Promise<ReviewReason[]> {
	const documentRows = await db
		.select({
			categoryId: document.categoryId,
			categoryName: category.name,
			anchor: anchorDate,
			deletedAt: document.deletedAt,
		})
		.from(document)
		.innerJoin(category, eq(category.id, document.categoryId))
		.where(eq(document.id, documentId))
		.limit(1);
	const current = documentRows[0];
	if (!current?.categoryId || !current.anchor || current.deletedAt) return [];
	const categoryId = current.categoryId;

	const issuers = await db
		.select({ partyId: documentParty.partyId, partyName: party.name })
		.from(documentParty)
		.innerJoin(party, eq(party.id, documentParty.partyId))
		.where(
			and(
				eq(documentParty.documentId, documentId),
				eq(documentParty.role, PROPOSED_ROLE),
			),
		)
		.orderBy(asc(documentParty.partyId));
	if (issuers.length === 0) return [];

	const existing = await db
		.select({
			issuerPartyId: documentType.issuerPartyId,
			categoryId: documentType.categoryId,
		})
		.from(documentType);

	const reasons: ReviewReason[] = [];
	for (const issuer of issuers) {
		const covered = existing.some((row) =>
			documentTypeCoversCouple(row, issuer.partyId, categoryId),
		);
		if (covered) continue;

		const siblings = await db
			.select({ id: document.id, month: anchorMonth })
			.from(document)
			.innerJoin(
				documentParty,
				and(
					eq(documentParty.documentId, document.id),
					eq(documentParty.role, PROPOSED_ROLE),
					eq(documentParty.partyId, issuer.partyId),
				),
			)
			.where(
				and(
					eq(document.categoryId, categoryId),
					isNull(document.deletedAt),
					isNotNull(anchorDate),
				),
			)
			.orderBy(anchorMonth, asc(document.id));

		const months = [...new Set(siblings.map((row) => row.month))].sort();
		if (months.length < SUGGEST_MIN_SAMPLES) continue;

		const periodicity = periodicityFromDayGaps(dayGapsBetween(months));
		const firstMonth = months[0];
		const lastMonth = months.at(-1);
		if (!firstMonth || !lastMonth) continue;

		const documentIds = [...new Set(siblings.map((row) => row.id))];
		reasons.push({
			code: "recurringCandidate",
			message: `Looks like a recurring document: ${documentIds.length} documents from ${issuer.partyName} in ${current.categoryName} (${PERIODICITY_LABELS[periodicity]}). Create a document type?`,
			ref: issuer.partyId,
			meta: {
				partyId: issuer.partyId,
				categoryId,
				periodicity,
				startPeriod: periodStartOf(periodicity, firstMonth),
				endPeriod: periodStartOf(periodicity, lastMonth),
				documentIds,
			},
		});
	}
	return reasons;
}

/**
 * Runs the document type detection (SPEC §9): the best match above the
 * confidence threshold is applied straight away, a weaker one is only proposed
 * through the informational `typeCandidate` reason.
 *
 * A document that already carries a type is left alone: detection never
 * overrides an assignment, whatever its origin.
 */
async function detectAndApplyType(
	db: Db,
	documentId: string,
	prepared: DocumentSubject,
	threshold: number,
	ingestion?: IngestionContext,
): Promise<ReviewReason[]> {
	if (prepared.document.documentTypeId) return [];

	const candidates = await detectDocumentTypes(db, documentId, prepared);
	const best = candidates[0];
	if (!best) return [];

	if (best.confidence < threshold) {
		return [
			{
				code: "typeCandidate",
				message: `Document type "${best.name}" detected with a confidence of ${Math.round(best.confidence * 100)}%. Apply it?`,
				confidence: best.confidence,
				field: "documentType",
				ref: best.documentTypeId,
				meta: {
					documentTypeId: best.documentTypeId,
					confidence: best.confidence,
					...(best.layoutId ? { layoutId: best.layoutId } : {}),
				},
			},
		];
	}

	const outcome = await applyDocumentType(db, documentId, best.documentTypeId, {
		source: "rule",
		confidence: best.confidence,
		confidenceThreshold: threshold,
		...(ingestion ? { ingestion } : {}),
	});
	return outcome.reviewReasons;
}

export interface AnalyzeOptions {
	/** Trigger of the evaluated rules (default: `ingest`). */
	trigger?: RuleTrigger;
	/** Skips the pre-pass (Party matching, date). */
	skipProposals?: boolean;
	/** Ingestion context, required by the `webhook` rule action. */
	ingestion?: IngestionContext;
}

/**
 * Analyzes a document: automatic proposals, rules, then computation of the
 * review reasons, written to `document.review_reasons`.
 */
export async function analyzeDocument(
	db: Db,
	documentId: string,
	options: AnalyzeOptions = {},
): Promise<ReviewReason[]> {
	const settings = await getReviewSettings(db);
	let prepared = await buildSubject(db, documentId);
	if (!prepared) return [];

	const reasons: ReviewReason[] = [];

	if (!options.skipProposals) {
		reasons.push(
			...(await proposeParties(
				db,
				documentId,
				prepared,
				settings.confidenceThreshold,
			)),
		);
		// Before the date: the period is what tells a payslip's own date apart
		// from the first day it covers.
		await proposeDocumentPeriod(db, documentId, prepared);
		reasons.push(
			...(await proposeDocumentDate(
				db,
				documentId,
				prepared,
				settings.confidenceThreshold,
			)),
		);
		const typeReasons = await detectAndApplyType(
			db,
			documentId,
			prepared,
			settings.confidenceThreshold,
			options.ingestion,
		);
		reasons.push(...typeReasons);
		// Applying a type rewrites the category, the parties and the tags: the
		// rules must see the document as it is now.
		prepared = (await buildSubject(db, documentId)) ?? prepared;
	}

	const applied = await applyRules(db, documentId, {
		trigger: options.trigger ?? "ingest",
		prepared,
		confidenceThreshold: settings.confidenceThreshold,
		...(options.ingestion ? { ingestion: options.ingestion } : {}),
	});
	if (applied) reasons.push(...applied.reviewReasons);

	// Final state, after the rules have been applied.
	const rows = await db
		.select({ categoryId: document.categoryId })
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	const current = rows[0];

	if (settings.requireCategory && !current?.categoryId) {
		reasons.push({
			code: "missingCategory",
			message: "No category could be determined.",
			field: "category",
		});
	}

	if (settings.requireIssuer) {
		const issuers = await db
			.select({ partyId: documentParty.partyId })
			.from(documentParty)
			.where(
				and(
					eq(documentParty.documentId, documentId),
					eq(documentParty.role, PROPOSED_ROLE),
				),
			)
			.limit(1);
		if (!issuers[0]) {
			reasons.push({
				code: "missingIssuer",
				message: "No issuer could be identified.",
				field: "issuer",
			});
		}
	}

	reasons.push(...(await proposeRecurringType(db, documentId)));

	const duplicateOf = await findTitleDateDuplicate(db, documentId);
	if (duplicateOf) {
		reasons.push({
			code: "possibleDuplicate",
			message: `A document already has this title and date: “${duplicateOf.title}”.`,
			field: "title",
			ref: duplicateOf.id,
		});
	}

	const reviewReasons = dedupe(reasons);
	await db
		.update(document)
		.set({ reviewReasons })
		.where(eq(document.id, documentId));

	return reviewReasons;
}

/** True when `confidence` no longer justifies a `lowConfidence` reason. */
function isConfidenceSatisfied(
	confidence: number | null | undefined,
	threshold: number,
): boolean {
	// `null`/`undefined` means the value was since taken over manually (a manual
	// entry clears its `confidence` column): the reason no longer applies.
	return (
		confidence === null || confidence === undefined || confidence >= threshold
	);
}

/**
 * `true` when the document carries no layout, or only the default one of its
 * type — in both cases no layout has actually recognised it.
 */
async function isFallbackLayout(
	db: Db,
	layoutId: string | null,
): Promise<boolean> {
	if (!layoutId) return true;
	const rows = await db
		.select({ isDefault: documentTypeLayout.isDefault })
		.from(documentTypeLayout)
		.where(eq(documentTypeLayout.id, layoutId))
		.limit(1);
	return rows[0]?.isDefault ?? true;
}

/**
 * Recomputes the review reasons of a document from its current state, without
 * re-running the proposals or the rules: `missingCategory`/`missingIssuer` are
 * dropped once satisfied, `lowConfidence` reasons whose underlying value moved
 * past the threshold (or was taken over manually) are dropped too, and
 * `recurringCandidate` is dropped as soon as a document type covers its couple.
 *
 * Used after a rule run (manual trigger or applied automatically) fills in
 * data that used to be missing, so the review reasons and status stay in
 * sync without requiring a full `analyzeDocument` pass. Never adds new
 * reasons, and never auto-approves: the document only leaves `review` when
 * the recomputed list is empty.
 */
export async function computeReviewReasons(
	db: Db,
	documentId: string,
): Promise<ReviewReason[]> {
	const rows = await db
		.select({
			categoryId: document.categoryId,
			categoryConfidence: document.categoryConfidence,
			documentTypeId: document.documentTypeId,
			layoutId: document.layoutId,
			manualFields: document.manualFields,
			dateConfidence: document.dateConfidence,
			reviewReasons: document.reviewReasons,
		})
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	const current = rows[0];
	if (!current) return [];

	const needsPartyCheck = current.reviewReasons.some(
		(reason) =>
			reason.code === "missingIssuer" ||
			(reason.code === "lowConfidence" &&
				(reason.field === "issuer" ||
					reason.field === "subject" ||
					reason.field === "party")),
	);
	const parties = needsPartyCheck
		? await db
				.select({
					role: documentParty.role,
					confidence: documentParty.confidence,
				})
				.from(documentParty)
				.where(eq(documentParty.documentId, documentId))
		: [];
	const hasIssuer = needsPartyCheck
		? parties.some((item) => item.role === PROPOSED_ROLE)
		: false;

	const fieldIds = new Set(
		current.reviewReasons
			.filter(
				(reason) =>
					reason.code === "lowConfidence" &&
					reason.field &&
					!["category", "issuer", "subject", "party", "documentDate"].includes(
						reason.field,
					),
			)
			.map((reason) => reason.field as string),
	);
	const fieldConfidences = new Map<string, number | null>();
	if (fieldIds.size > 0) {
		const values = await db
			.select({
				fieldId: documentFieldValue.fieldId,
				confidence: documentFieldValue.confidence,
			})
			.from(documentFieldValue)
			.where(eq(documentFieldValue.documentId, documentId));
		for (const value of values)
			fieldConfidences.set(value.fieldId, value.confidence);
	}

	// A `recurringCandidate` disappears as soon as a type covers its couple.
	const typeRows = current.reviewReasons.some(
		(reason) => reason.code === "recurringCandidate",
	)
		? await db
				.select({
					issuerPartyId: documentType.issuerPartyId,
					categoryId: documentType.categoryId,
				})
				.from(documentType)
		: [];

	// The default layout is the fallback, not a recognised layout: the reason
	// only goes away once a real one has been picked.
	const layoutStillUnknown = current.reviewReasons.some(
		(reason) => reason.code === "unknownLayout",
	)
		? await isFallbackLayout(db, current.layoutId)
		: false;

	const settings = await getReviewSettings(db);
	const threshold = settings.confidenceThreshold;

	const reasons = current.reviewReasons.filter((reason) => {
		if (reason.code === "missingCategory") return !current.categoryId;
		if (reason.code === "missingIssuer") return !hasIssuer;
		if (reason.code === "recurringCandidate") {
			const partyId = reason.meta?.partyId;
			const categoryId = reason.meta?.categoryId;
			if (typeof partyId !== "string" || typeof categoryId !== "string") {
				return true;
			}
			return !typeRows.some((row) =>
				documentTypeCoversCouple(row, partyId, categoryId),
			);
		}
		// The type has been applied (or the layout picked): the proposal is moot.
		if (reason.code === "typeCandidate") return !current.documentTypeId;
		if (reason.code === "unknownLayout") return layoutStillUnknown;
		if (reason.code !== "lowConfidence") return true;

		switch (reason.field) {
			case "category":
				return !isConfidenceSatisfied(current.categoryConfidence, threshold);
			case "issuer":
			case "subject": {
				const inRole = parties.filter((item) => item.role === reason.field);
				if (inRole.length === 0) return true;
				return inRole.some(
					(item) => !isConfidenceSatisfied(item.confidence, threshold),
				);
			}
			case "party":
				if (parties.length === 0) return true;
				return parties.some(
					(item) => !isConfidenceSatisfied(item.confidence, threshold),
				);
			case "documentDate":
				// A date someone typed settles the question, whatever the pipeline
				// had read; otherwise the persisted confidence decides.
				if (isManualField(current.manualFields, "documentDate")) return false;
				return !isConfidenceSatisfied(current.dateConfidence, threshold);
			default: {
				if (!reason.field || !fieldConfidences.has(reason.field)) return true;
				return !isConfidenceSatisfied(
					fieldConfidences.get(reason.field),
					threshold,
				);
			}
		}
	});

	if (reasons.length !== current.reviewReasons.length) {
		await db
			.update(document)
			.set({ reviewReasons: reasons })
			.where(eq(document.id, documentId));
	}

	// Informational reasons (`recurringCandidate`) do not hold a document back.
	if (!reasons.some(isBlockingReviewReason)) {
		await db
			.update(document)
			.set({ status: "active" })
			.where(and(eq(document.id, documentId), eq(document.status, "review")));
	}

	return reasons;
}
