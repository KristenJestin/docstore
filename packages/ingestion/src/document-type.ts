import type { Db } from "@docstore/db";
import { document, documentParty } from "@docstore/db/schema/document";
import type {
	DocumentTypeLayoutRow,
	DocumentTypeRow,
} from "@docstore/db/schema/document-type";
import {
	documentType,
	documentTypeLayout,
} from "@docstore/db/schema/document-type";
import type { ExtractionRuleRow } from "@docstore/db/schema/rule";
import { extractionRule } from "@docstore/db/schema/rule";
import { documentTag } from "@docstore/db/schema/tag";
import type { ExtractionOutcome, RuleSubject } from "@docstore/rules";
import {
	evaluateCondition,
	operationFromExtraction,
	renderTitleTemplate,
	runExtraction,
	titleContextOf,
} from "@docstore/rules";
import type { AssignmentSource, ReviewReason } from "@docstore/shared/document";
import { isManualField } from "@docstore/shared/document";
import type {
	DocumentTypeCandidate,
	LayoutFieldResult,
	LayoutSelectionReason,
} from "@docstore/shared/document-type";
import {
	LAYOUT_SIGNATURE_TOKENS,
	LAYOUT_TRIAL_THRESHOLD,
} from "@docstore/shared/document-type";
import type { RuleCondition } from "@docstore/shared/rule";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { computeReviewReasons } from "./analyze";
import type { IngestionContext } from "./context";
import { DocumentTypeNotFoundError } from "./errors";
import { titleFromFilename } from "./media";
import { applyOperations } from "./rules";
import { revokeShareLinksForSensitive, setSensitive } from "./sensitive";
import type { DocumentSubject } from "./subject";
import { buildSubject, loadExtractionInput, primaryFile } from "./subject";

/**
 * Document types (SPEC §9).
 *
 * Applying a type is the single operation shared by the pipeline (automatic
 * detection), the rule action `set_document_type` and the API (manual
 * assignment, bulk action): it writes the identity of the type onto the
 * document, picks a layout and runs its extraction rules.
 */

/* ------------------------------------------------------------------ */
/* Loading                                                              */
/* ------------------------------------------------------------------ */

export async function loadDocumentType(
	db: Db,
	id: string,
): Promise<DocumentTypeRow> {
	const rows = await db
		.select()
		.from(documentType)
		.where(eq(documentType.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) throw new DocumentTypeNotFoundError(id);
	return row;
}

export function loadLayouts(
	db: Db,
	documentTypeId: string,
): Promise<DocumentTypeLayoutRow[]> {
	return db
		.select()
		.from(documentTypeLayout)
		.where(eq(documentTypeLayout.documentTypeId, documentTypeId))
		.orderBy(asc(documentTypeLayout.sortOrder), asc(documentTypeLayout.id));
}

/**
 * Extraction rules that apply to a document: those owned by the selected
 * layout. An extraction rule only exists inside a document type (SPEC §9), so
 * without a layout there is nothing to run.
 */
export function extractionRulesFor(
	db: Db,
	options: { layoutId: string | null },
): Promise<ExtractionRuleRow[]> {
	if (!options.layoutId) return Promise.resolve([]);
	return layoutExtractionRules(db, options.layoutId);
}

/** Extraction rules owned by a layout, whatever the document. */
export function layoutExtractionRules(
	db: Db,
	layoutId: string,
): Promise<ExtractionRuleRow[]> {
	return db
		.select()
		.from(extractionRule)
		.where(eq(extractionRule.layoutId, layoutId))
		.orderBy(asc(extractionRule.name), asc(extractionRule.id));
}

/* ------------------------------------------------------------------ */
/* Extraction                                                           */
/* ------------------------------------------------------------------ */

function targetFieldId(row: ExtractionRuleRow): string | null {
	return row.target.kind === "field" ? row.target.fieldId : null;
}

/** Runs a set of extraction rules on a document, without writing anything. */
export async function runExtractionRules(
	db: Db,
	documentId: string,
	rules: ExtractionRuleRow[],
): Promise<LayoutFieldResult[]> {
	if (rules.length === 0) return [];
	const input = await loadExtractionInput(db, documentId);
	if (!input) return [];

	return rules.map((row) => {
		const result = runExtraction(row.strategy, row.postprocess, {
			text: input.text,
			layout: input.layout,
		});
		return {
			...result,
			extractionRuleId: row.id,
			extractionRuleName: row.name,
			targetKind: row.target.kind,
			fieldId: targetFieldId(row),
		};
	});
}

/** Mean confidence over the rules that produced a value; `0` without any. */
export function averageResultConfidence(results: LayoutFieldResult[]): number {
	const scored = results.filter(
		(result) => result.value !== null && result.value !== undefined,
	);
	if (scored.length === 0) return 0;
	const total = scored.reduce((sum, result) => sum + result.confidence, 0);
	return total / scored.length;
}

function toOutcome(
	row: ExtractionRuleRow,
	result: LayoutFieldResult,
): ExtractionOutcome {
	return {
		rule: {
			id: row.id,
			name: row.name,
			target: row.target,
			strategy: row.strategy,
			postprocess: row.postprocess,
		},
		result,
	};
}

/* ------------------------------------------------------------------ */
/* Layout selection                                                     */
/* ------------------------------------------------------------------ */

export interface LayoutSelection {
	layoutId: string | null;
	layoutName: string | null;
	reason: LayoutSelectionReason;
	/** Average confidence of the trial that decided, `0` otherwise. */
	averageConfidence: number;
}

/** Anchor date of a document: its period start, otherwise its date. */
function anchorOf(subject: RuleSubject): string | null {
	return subject.periodStart ?? subject.documentDate ?? null;
}

function coversDate(layout: DocumentTypeLayoutRow, date: string): boolean {
	if (layout.validFrom && date < layout.validFrom) return false;
	if (layout.validUntil && date > layout.validUntil) return false;
	return Boolean(layout.validFrom || layout.validUntil);
}

/** The default layout of a type: the fallback when nothing else decides. */
function defaultSelection(
	layouts: DocumentTypeLayoutRow[],
	averageConfidence = 0,
): LayoutSelection {
	const fallback = layouts.find((layout) => layout.isDefault);
	if (!fallback) {
		return {
			layoutId: null,
			layoutName: null,
			reason: "none",
			averageConfidence,
		};
	}
	return {
		layoutId: fallback.id,
		layoutName: fallback.name,
		reason: "default",
		averageConfidence,
	};
}

/**
 * Picks the layout of a type for a document (SPEC §9): a single layout is used
 * as-is, otherwise signature first, then date range, then a trial of every
 * layout keeping the best average confidence. When nothing decides, the
 * default layout of the type takes over.
 */
export async function selectLayout(
	db: Db,
	documentId: string,
	layouts: DocumentTypeLayoutRow[],
	subject: RuleSubject,
	forcedLayoutId?: string | null,
): Promise<LayoutSelection> {
	if (forcedLayoutId) {
		const forced = layouts.find((layout) => layout.id === forcedLayoutId);
		if (forced) {
			return {
				layoutId: forced.id,
				layoutName: forced.name,
				reason: "forced",
				averageConfidence: 0,
			};
		}
	}
	if (layouts.length === 0) {
		return {
			layoutId: null,
			layoutName: null,
			reason: "none",
			averageConfidence: 0,
		};
	}

	// A type always keeps at least one layout: alone, it is the one to use.
	const single = layouts[0];
	if (layouts.length === 1 && single) {
		return {
			layoutId: single.id,
			layoutName: single.name,
			reason: "only",
			averageConfidence: 0,
		};
	}

	for (const layout of layouts) {
		if (!layout.signature) continue;
		if (evaluateCondition(layout.signature, subject).matched) {
			return {
				layoutId: layout.id,
				layoutName: layout.name,
				reason: "signature",
				averageConfidence: 0,
			};
		}
	}

	const anchor = anchorOf(subject);
	if (anchor) {
		const dated = layouts.find((layout) => coversDate(layout, anchor));
		if (dated) {
			return {
				layoutId: dated.id,
				layoutName: dated.name,
				reason: "dateRange",
				averageConfidence: 0,
			};
		}
	}

	let best: LayoutSelection = {
		layoutId: null,
		layoutName: null,
		reason: "none",
		averageConfidence: 0,
	};
	for (const layout of layouts) {
		const rules = await layoutExtractionRules(db, layout.id);
		const results = await runExtractionRules(db, documentId, rules);
		const confidence = averageResultConfidence(results);
		if (confidence > best.averageConfidence) {
			best = {
				layoutId: layout.id,
				layoutName: layout.name,
				reason: "bestConfidence",
				averageConfidence: confidence,
			};
		}
	}
	if (best.averageConfidence < LAYOUT_TRIAL_THRESHOLD) {
		return defaultSelection(layouts, best.averageConfidence);
	}
	return best;
}

/* ------------------------------------------------------------------ */
/* Layout signatures                                                    */
/* ------------------------------------------------------------------ */

/** Words too common to identify anything. */
const SIGNATURE_STOP_WORDS = new Set([
	"avec",
	"dans",
	"des",
	"du",
	"est",
	"et",
	"la",
	"le",
	"les",
	"pour",
	"par",
	"sur",
	"une",
	"un",
	"vous",
	"votre",
	"the",
	"and",
	"for",
	"with",
	"your",
]);

/**
 * Seeds a layout signature from the OCR text: the first rare words of the
 * document, joined by an `and`. Deliberately simple — it is a starting point
 * the user edits afterwards.
 */
export function signatureFromText(text: string): RuleCondition | null {
	const seen = new Set<string>();
	const tokens: string[] = [];
	for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
		const token = raw.trim();
		if (token.length < 5 || token.length > 30) continue;
		// Numbers change from one document to the next: they identify nothing.
		if (/\d/.test(token)) continue;
		const key = token.toLowerCase();
		if (SIGNATURE_STOP_WORDS.has(key) || seen.has(key)) continue;
		seen.add(key);
		tokens.push(token);
		if (tokens.length >= LAYOUT_SIGNATURE_TOKENS) break;
	}
	if (tokens.length === 0) return null;
	return {
		op: "and",
		children: tokens.map((token) => ({
			field: "content" as const,
			cmp: "icontains" as const,
			value: token,
		})),
	};
}

/* ------------------------------------------------------------------ */
/* Detection                                                            */
/* ------------------------------------------------------------------ */

/**
 * Enabled types whose detection condition matches the document, best first.
 * Nothing is written: `analyze` decides between applying and proposing.
 */
export async function detectDocumentTypes(
	db: Db,
	documentId: string,
	prepared?: DocumentSubject,
): Promise<DocumentTypeCandidate[]> {
	const subject = prepared ?? (await buildSubject(db, documentId));
	if (!subject) return [];

	const rows = await db
		.select()
		.from(documentType)
		.where(
			and(eq(documentType.enabled, true), isNotNull(documentType.detection)),
		)
		.orderBy(asc(documentType.priority), asc(documentType.id));

	const candidates: DocumentTypeCandidate[] = [];
	for (const row of rows) {
		if (!row.detection) continue;
		if (!evaluateCondition(row.detection, subject.subject).matched) continue;
		const layouts = await loadLayouts(db, row.id);
		const selection = await selectLayout(
			db,
			documentId,
			layouts,
			subject.subject,
		);
		candidates.push({
			documentTypeId: row.id,
			name: row.name,
			confidence: row.detectionConfidence,
			layoutId: selection.layoutId,
			layoutReason: selection.reason,
		});
	}

	return candidates.sort((a, b) => b.confidence - a.confidence);
}

/* ------------------------------------------------------------------ */
/* Applying a type                                                      */
/* ------------------------------------------------------------------ */

export interface ApplyDocumentTypeOptions {
	/** Origin of the assignment: `manual`, `rule` or `mcp`. */
	source: AssignmentSource;
	/** `null` for a manual assignment. */
	confidence?: number | null;
	/** Forces a layout instead of running the selection. */
	layoutId?: string | null;
	/** Below this value, an automatic write raises a `lowConfidence` reason. */
	confidenceThreshold?: number;
	/** Required to re-key the files when the type raises `sensitive`. */
	ingestion?: IngestionContext;
}

export interface ApplyDocumentTypeOutcome {
	documentId: string;
	documentTypeId: string;
	layoutId: string | null;
	layoutReason: LayoutSelectionReason;
	/** Values written by the extraction rules. */
	fieldsWritten: number;
	extractions: LayoutFieldResult[];
	reviewReasons: ReviewReason[];
}

/** `true` when the title still is the one derived from the filename. */
async function titleIsDerived(
	db: Db,
	documentId: string,
	title: string,
): Promise<boolean> {
	const file = await primaryFile(db, documentId);
	if (!file) return false;
	return title === titleFromFilename(file.filename);
}

/**
 * Applies a document type to a document (SPEC §9).
 *
 * Category, parties, tags and the sensitive flag come from the type; the title
 * is only rewritten while it still is the one derived from the filename, and a
 * manual assignment is never overwritten by an automatic one.
 */
export async function applyDocumentType(
	db: Db,
	documentId: string,
	documentTypeId: string,
	options: ApplyDocumentTypeOptions,
): Promise<ApplyDocumentTypeOutcome> {
	const type = await loadDocumentType(db, documentTypeId);
	const prepared = await buildSubject(db, documentId);
	if (!prepared) {
		throw new Error(`Document "${documentId}" not found.`);
	}

	const source = options.source;
	const confidence = options.confidence ?? null;
	const automatic = source !== "manual";
	const reviewReasons: ReviewReason[] = [];

	if (type.categoryId) {
		// An automatic application never overrides a category set by hand. The
		// default `manual` source of a document without any category is not one.
		const overwrite =
			!automatic ||
			prepared.document.categoryId === null ||
			prepared.document.categorySource !== "manual";
		if (overwrite) {
			await db
				.update(document)
				.set({
					categoryId: type.categoryId,
					categorySource: source,
					categoryConfidence: confidence,
				})
				.where(eq(document.id, documentId));
		}
	}

	const links: { partyId: string; role: "issuer" | "subject" }[] = [];
	if (type.issuerPartyId) {
		links.push({ partyId: type.issuerPartyId, role: "issuer" });
	}
	if (type.subjectPartyId) {
		links.push({ partyId: type.subjectPartyId, role: "subject" });
	}
	for (const link of links) {
		await db
			.insert(documentParty)
			.values({ documentId, ...link, source, confidence })
			.onConflictDoNothing();
	}

	for (const tagId of type.tagIds) {
		await db
			.insert(documentTag)
			.values({ documentId, tagId, source, confidence })
			.onConflictDoNothing();
	}

	// The default only ever raises the flag: a document explicitly marked
	// sensitive is never brought back down by a type.
	if (type.sensitiveDefault && !prepared.document.sensitive) {
		if (options.ingestion) {
			await setSensitive(options.ingestion, documentId, true);
		} else {
			await db
				.update(document)
				.set({ sensitive: true })
				.where(eq(document.id, documentId));
			await revokeShareLinksForSensitive(db, documentId);
		}
	}

	// Rebuilt after the identity writes: the title template needs the issuer and
	// the category the type has just set.
	const refreshed = (await buildSubject(db, documentId)) ?? prepared;

	if (
		type.titleTemplate &&
		// A title someone typed is theirs, even when it happens to look like the
		// one derived from the filename.
		!isManualField(refreshed.document.manualFields, "title") &&
		(await titleIsDerived(db, documentId, refreshed.document.title))
	) {
		const title = renderTitleTemplate(
			type.titleTemplate,
			titleContextOf(refreshed.subject),
		);
		if (title.trim().length > 0) {
			await db
				.update(document)
				.set({ title })
				.where(eq(document.id, documentId));
			refreshed.subject.title = title;
		}
	}

	const layouts = await loadLayouts(db, documentTypeId);
	const selection = await selectLayout(
		db,
		documentId,
		layouts,
		refreshed.subject,
		options.layoutId,
	);

	const rules = await extractionRulesFor(db, {
		layoutId: selection.layoutId,
	});
	const extractions = await runExtractionRules(db, documentId, rules);
	const byId = new Map(rules.map((row) => [row.id, row]));
	const operations = extractions
		.map((result) => {
			const row = byId.get(result.extractionRuleId);
			return row
				? operationFromExtraction(toOutcome(row, result), refreshed.subject)
				: null;
		})
		.filter((operation) => operation !== null);

	const applied = await applyOperations(db, documentId, operations, {
		...(options.confidenceThreshold !== undefined
			? { confidenceThreshold: options.confidenceThreshold }
			: {}),
		...(options.ingestion ? { ingestion: options.ingestion } : {}),
	});
	reviewReasons.push(...applied.reasons);

	await db
		.update(document)
		.set({
			documentTypeId,
			documentTypeSource: source,
			documentTypeConfidence: confidence,
			layoutId: selection.layoutId,
		})
		.where(eq(document.id, documentId));

	// The rules of the default layout still ran: the reason only says that no
	// layout of the type recognised this document.
	const unknownLayout =
		layouts.length > 1 &&
		(selection.reason === "default" || selection.layoutId === null);
	if (unknownLayout) {
		reviewReasons.push({
			code: "unknownLayout",
			message: `No layout of "${type.name}" matches this document. Create a layout from it?`,
			field: "layout",
			ref: documentTypeId,
			meta: { documentTypeId },
		});
	}

	await dropLayoutReason(db, documentId, !unknownLayout);

	// The type may have just supplied a category or an issuer: the reasons that
	// used to block the document on their absence no longer apply (same
	// behaviour as `document.setCategory`).
	await computeReviewReasons(db, documentId);

	return {
		documentId,
		documentTypeId,
		layoutId: selection.layoutId,
		layoutReason: selection.reason,
		fieldsWritten: applied.applied.length,
		extractions,
		reviewReasons,
	};
}

/** Removes a stale `unknownLayout` reason once a layout has been selected. */
async function dropLayoutReason(
	db: Db,
	documentId: string,
	selected: boolean,
): Promise<void> {
	if (!selected) return;
	const rows = await db
		.select({ reviewReasons: document.reviewReasons })
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	const current = rows[0]?.reviewReasons ?? [];
	const kept = current.filter((reason) => reason.code !== "unknownLayout");
	if (kept.length === current.length) return;
	await db
		.update(document)
		.set({ reviewReasons: kept })
		.where(eq(document.id, documentId));
}

/** Clears the type of a document (and everything that describes the assignment). */
export async function clearDocumentType(
	db: Db,
	documentId: string,
): Promise<void> {
	await db
		.update(document)
		.set({
			documentTypeId: null,
			documentTypeSource: "manual",
			documentTypeConfidence: null,
			layoutId: null,
		})
		.where(eq(document.id, documentId));
}
