import type { Db } from "@docstore/db";
import {
	customField,
	documentFieldValue,
} from "@docstore/db/schema/custom-field";
import { document, documentParty } from "@docstore/db/schema/document";
import type { ExtractionRuleRow, RuleRow } from "@docstore/db/schema/rule";
import { extractionRule, rule, ruleRun } from "@docstore/db/schema/rule";
import { documentTag } from "@docstore/db/schema/tag";
import type {
	ConditionTraceEntry,
	ExtractionOutcome,
	RuleSubject,
} from "@docstore/rules";
import {
	evaluateCondition,
	planActions,
	referencedExtractionRuleIds,
	runExtraction,
} from "@docstore/rules";
import type {
	CustomField,
	CustomFieldValue,
} from "@docstore/shared/custom-field";
import {
	customFieldCategoryIssue,
	customFieldValueIssue,
	customFieldValueSchema,
} from "@docstore/shared/custom-field";
import type { ReviewReason } from "@docstore/shared/document";
import { isManualField } from "@docstore/shared/document";
import type { ExtractionResult } from "@docstore/shared/extraction";
import type {
	NamedExtractionResult,
	PlannedOperation,
	RuleTrigger,
} from "@docstore/shared/rule";
import { RULE_RUN_RETENTION_DAYS } from "@docstore/shared/rule";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import type { IngestionContext } from "./context";
import { applyDocumentType } from "./document-type";
import { DocumentTypeNotFoundError } from "./errors";
import { manualFieldsOf } from "./manual-fields";
import { revokeShareLinksForSensitive, setSensitive } from "./sensitive";
import { getContentLocale } from "./settings";
import type { DocumentSubject } from "./subject";
import { buildSubject, categoryChainIds, loadExtractionInput } from "./subject";
import { emitRuleWebhook } from "./webhook";

/**
 * Execution of the rules on a document (SPEC §3).
 *
 * `@docstore/rules` decides *what* to do; this module does the database round
 * trips and applies the operations. It does not depend on `@docstore/api`: the
 * API calls it, never the other way round.
 */

export interface ApplyRulesOptions {
	trigger: RuleTrigger;
	/** Restricts the execution to these rules (manual run, test mode). */
	ruleIds?: string[];
	/** Evaluates and plans without writing anything. */
	dryRun?: boolean;
	/** Also takes the disabled rules (test mode / explicit run). */
	includeDisabled?: boolean;
	/** Subject already built, to avoid a second load. */
	prepared?: DocumentSubject;
	/** Rules provided inline (non-persisted draft). */
	rules?: RuleRow[];
	/** Confidence threshold below which a value goes to Review. */
	confidenceThreshold?: number;
	/**
	 * Ingestion context, required by the `webhook` action: without it, the action
	 * is planned but no delivery is published.
	 */
	ingestion?: IngestionContext;
}

export interface AppliedRuleResult {
	ruleId: string;
	ruleName: string;
	matched: boolean;
	trace: ConditionTraceEntry[];
	operations: PlannedOperation[];
	extractions: NamedExtractionResult[];
	durationMs: number;
}

export interface ApplyRulesResult {
	documentId: string;
	subject: RuleSubject;
	rules: AppliedRuleResult[];
	matchedCount: number;
	/** Review reasons coming from the rules (extractions and confidences). */
	reviewReasons: ReviewReason[];
}

/* ------------------------------------------------------------------ */
/* Conversion of the extracted values to a custom field                 */
/* ------------------------------------------------------------------ */

function roundMoney(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Translates a raw value (number, ISO date, text) into the typed shape expected
 * by `document_field_value`. Returns `null` if the field cannot hold the value:
 * the caller turns it into a review reason.
 */
export function toCustomFieldValue(
	field: CustomField,
	value: unknown,
): CustomFieldValue | null {
	if (value === null || value === undefined) return null;

	let candidate: unknown;
	switch (field.type) {
		case "number":
			candidate = { kind: "number", number: Number(value) };
			break;
		case "money":
			candidate = {
				kind: "money",
				amount: roundMoney(Number(value)),
				currency: field.options.currency ?? "EUR",
			};
			break;
		case "boolean":
			candidate = { kind: "boolean", boolean: Boolean(value) };
			break;
		case "date":
			candidate = { kind: "date", date: String(value) };
			break;
		case "select":
			candidate = { kind: "select", choice: String(value) };
			break;
		case "url":
			candidate = { kind: "url", url: String(value) };
			break;
		case "party_ref":
			candidate = { kind: "party_ref", partyId: String(value) };
			break;
		default:
			candidate = { kind: "text", text: String(value) };
			break;
	}

	const parsed = customFieldValueSchema.safeParse(candidate);
	if (!parsed.success) return null;
	if (parsed.data.kind === "select") {
		const choices = field.options.choices ?? [];
		if (!choices.includes(parsed.data.choice)) return null;
	}
	return parsed.data;
}

/* ------------------------------------------------------------------ */
/* Application of the operations                                        */
/* ------------------------------------------------------------------ */

export interface AppliedOperations {
	applied: PlannedOperation[];
	reasons: ReviewReason[];
}

async function applySetField(
	db: Db,
	documentId: string,
	operation: Extract<PlannedOperation, { type: "set_field" }>,
	ruleId: string | undefined,
	threshold: number,
	result: AppliedOperations,
): Promise<void> {
	const fields = await db
		.select()
		.from(customField)
		.where(eq(customField.id, operation.fieldId))
		.limit(1);
	const field = fields[0];
	if (!field) {
		result.reasons.push({
			code: "extractionFailed",
			message: `Custom field "${operation.fieldId}" not found: value not stored.`,
			field: operation.fieldId,
			...(ruleId ? { ruleId } : {}),
		});
		return;
	}

	const value = toCustomFieldValue(field, operation.value);
	if (!value) {
		result.reasons.push({
			code: "extractionFailed",
			message: `The value extracted for "${field.name}" is not usable.`,
			field: field.id,
			...(ruleId ? { ruleId } : {}),
		});
		return;
	}

	// The constraints of the definition apply whoever writes the value: an
	// extraction that lands a negative amount, a foreign currency or a field
	// that does not belong to the document's category goes to Review instead of
	// being stored (SPEC §2 "CustomFieldDefinition").
	const [documentRow] = await db
		.select({ categoryId: document.categoryId })
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	const issue =
		customFieldCategoryIssue(
			field,
			await categoryChainIds(db, documentRow?.categoryId ?? null),
		) ?? customFieldValueIssue(field, value);
	if (issue) {
		result.reasons.push({
			code: "extractionFailed",
			message: issue,
			field: field.id,
			...(ruleId ? { ruleId } : {}),
		});
		return;
	}

	// A manual entry is never overwritten by a rule.
	const existing = await db
		.select({ source: documentFieldValue.source })
		.from(documentFieldValue)
		.where(
			and(
				eq(documentFieldValue.documentId, documentId),
				eq(documentFieldValue.fieldId, field.id),
			),
		)
		.limit(1);
	if (existing[0]?.source === "manual") return;

	await db
		.insert(documentFieldValue)
		.values({
			documentId,
			fieldId: field.id,
			value,
			source: "rule",
			confidence: operation.confidence,
		})
		.onConflictDoUpdate({
			target: [documentFieldValue.documentId, documentFieldValue.fieldId],
			set: {
				value,
				source: "rule",
				confidence: operation.confidence,
				updatedAt: new Date(),
			},
		});

	result.applied.push(operation);
	if (operation.confidence !== null && operation.confidence < threshold) {
		result.reasons.push({
			code: "lowConfidence",
			message: `"${field.name}" was filled automatically with a confidence of ${Math.round(operation.confidence * 100)}%.`,
			confidence: operation.confidence,
			field: field.id,
			...(ruleId ? { ruleId } : {}),
		});
	}
}

/** Applies the planned operations to a document. */
export async function applyOperations(
	db: Db,
	documentId: string,
	operations: PlannedOperation[],
	options: {
		ruleId?: string;
		confidenceThreshold?: number;
		ingestion?: IngestionContext;
	} = {},
): Promise<AppliedOperations> {
	const threshold = options.confidenceThreshold ?? 1;
	const ruleId = options.ruleId;
	const result: AppliedOperations = { applied: [], reasons: [] };
	// A rule writing over a date, a period, a validity or a title someone typed
	// would undo their work on every run: those fields are theirs (SPEC §5).
	const manual = await manualFieldsOf(db, documentId);

	for (const operation of operations) {
		switch (operation.type) {
			case "set_document_type": {
				try {
					const outcome = await applyDocumentType(
						db,
						documentId,
						operation.documentTypeId,
						{
							source: "rule",
							confidence: operation.confidence,
							confidenceThreshold: threshold,
							...(options.ingestion ? { ingestion: options.ingestion } : {}),
						},
					);
					result.applied.push(operation);
					result.reasons.push(...outcome.reviewReasons);
				} catch (error) {
					if (!(error instanceof DocumentTypeNotFoundError)) throw error;
					result.reasons.push({
						code: "extractionFailed",
						message: error.message,
						field: "documentType",
						...(ruleId ? { ruleId } : {}),
					});
				}
				break;
			}
			case "add_tag": {
				await db
					.insert(documentTag)
					.values({
						documentId,
						tagId: operation.tagId,
						source: "rule",
						confidence: null,
					})
					.onConflictDoNothing();
				result.applied.push(operation);
				break;
			}
			case "remove_tag": {
				await db
					.delete(documentTag)
					.where(
						and(
							eq(documentTag.documentId, documentId),
							eq(documentTag.tagId, operation.tagId),
						),
					);
				result.applied.push(operation);
				break;
			}
			case "link_party": {
				await db
					.insert(documentParty)
					.values({
						documentId,
						partyId: operation.partyId,
						role: operation.role,
						source: "rule",
						confidence: operation.confidence,
					})
					.onConflictDoNothing();
				result.applied.push(operation);
				if (operation.confidence !== null && operation.confidence < threshold) {
					result.reasons.push({
						code: "lowConfidence",
						message: `Party linked automatically (${operation.role}) with a confidence of ${Math.round(operation.confidence * 100)}%.`,
						confidence: operation.confidence,
						field: "party",
						...(ruleId ? { ruleId } : {}),
					});
				}
				break;
			}
			case "set_field":
				await applySetField(
					db,
					documentId,
					operation,
					ruleId,
					threshold,
					result,
				);
				break;
			case "set_document_date": {
				if (
					isManualField(manual, "documentDate") ||
					isManualField(manual, "datePrecision")
				) {
					break;
				}
				await db
					.update(document)
					.set({
						documentDate: operation.date,
						datePrecision: operation.precision,
						// A rule (or the extraction rule of a layout) read the date off a
						// place someone pointed at: it is a labelled date, not a guess.
						dateSource: "labelled",
						dateConfidence: operation.confidence,
					})
					.where(eq(document.id, documentId));
				result.applied.push(operation);
				if (operation.confidence !== null && operation.confidence < threshold) {
					result.reasons.push({
						code: "lowConfidence",
						message: `Document date inferred from the text (confidence ${Math.round(operation.confidence * 100)}%).`,
						confidence: operation.confidence,
						field: "documentDate",
						...(ruleId ? { ruleId } : {}),
					});
				}
				break;
			}
			case "set_period": {
				if (
					isManualField(manual, "periodStart") ||
					isManualField(manual, "periodEnd")
				) {
					break;
				}
				await db
					.update(document)
					.set({ periodStart: operation.start, periodEnd: operation.end })
					.where(eq(document.id, documentId));
				result.applied.push(operation);
				break;
			}
			case "set_valid_until": {
				if (isManualField(manual, "validUntil")) break;
				await db
					.update(document)
					.set({ validUntil: operation.date })
					.where(eq(document.id, documentId));
				result.applied.push(operation);
				break;
			}
			case "set_title": {
				if (operation.title.trim().length === 0) break;
				if (isManualField(manual, "title")) break;
				await db
					.update(document)
					.set({ title: operation.title })
					.where(eq(document.id, documentId));
				result.applied.push(operation);
				break;
			}
			case "set_sensitive": {
				// With an ingestion context, raising the flag also re-keys the files
				// (SPEC §8 iteration 7). Without one (dry run, unit test), only the
				// column moves.
				if (options.ingestion) {
					await setSensitive(
						options.ingestion,
						documentId,
						operation.sensitive,
					);
				} else {
					await db
						.update(document)
						.set({ sensitive: operation.sensitive })
						.where(eq(document.id, documentId));
					if (operation.sensitive) {
						await revokeShareLinksForSensitive(db, documentId);
					}
				}
				result.applied.push(operation);
				break;
			}
			case "extraction_failed": {
				result.reasons.push({
					code: "extractionFailed",
					message: `The extraction rule "${operation.extractionRuleName}" found nothing.`,
					...(operation.fieldId ? { field: operation.fieldId } : {}),
					...(ruleId ? { ruleId } : {}),
				});
				break;
			}
			case "webhook": {
				// Ad hoc delivery to the rule URL (iteration 6). Without an ingestion
				// context (test mode, call outside the server), the action stays
				// planned without being executed.
				if (!options.ingestion) break;
				const queued = await emitRuleWebhook(
					options.ingestion,
					operation.url,
					documentId,
					ruleId,
				);
				if (queued) result.applied.push(operation);
				break;
			}
			default:
				break;
		}
	}

	return result;
}

/* ------------------------------------------------------------------ */
/* Loading and execution of the rules                                   */
/* ------------------------------------------------------------------ */

/** Enabled rules for a trigger, in increasing priority order. */
export async function loadRules(
	db: Db,
	options: Pick<ApplyRulesOptions, "trigger" | "ruleIds" | "includeDisabled">,
): Promise<RuleRow[]> {
	const conditions = [
		sql`${rule.triggers} @> ARRAY[${options.trigger}]::text[]`,
	];
	if (!options.includeDisabled) conditions.push(eq(rule.enabled, true));
	if (options.ruleIds) {
		if (options.ruleIds.length === 0) return [];
		conditions.push(inArray(rule.id, options.ruleIds));
	}

	return db
		.select()
		.from(rule)
		.where(and(...conditions))
		.orderBy(asc(rule.priority), asc(rule.createdAt), asc(rule.id));
}

function toExtractionRuleLike(row: ExtractionRuleRow) {
	return {
		id: row.id,
		name: row.name,
		target: row.target,
		strategy: row.strategy,
		postprocess: row.postprocess,
	};
}

/** Runs an extraction rule on the text and the layer of a document. */
export async function runExtractionRuleOn(
	db: Db,
	documentId: string,
	extraction: ReturnType<typeof toExtractionRuleLike>,
	fileId?: string,
): Promise<ExtractionResult> {
	const input = await loadExtractionInput(db, documentId, fileId);
	if (!input) return { raw: null, value: null, confidence: 0 };
	return runExtraction(extraction.strategy, extraction.postprocess, {
		text: input.text,
		layout: input.layout,
	});
}

/**
 * Evaluates the rules of a trigger on a document and applies their actions.
 *
 * `dryRun` returns exactly the same operations without writing anything: this is
 * the test mode of `rule.test`.
 */
export async function applyRules(
	db: Db,
	documentId: string,
	options: ApplyRulesOptions,
): Promise<ApplyRulesResult | null> {
	const prepared = options.prepared ?? (await buildSubject(db, documentId));
	if (!prepared) return null;

	const rules = options.rules ?? (await loadRules(db, options));
	const threshold = options.confidenceThreshold ?? 1;
	// A `set_title` action writes into the document: content, so it follows
	// `content.locale` and not the English interface.
	const locale = await getContentLocale(db);
	const results: AppliedRuleResult[] = [];
	const reviewReasons: ReviewReason[] = [];
	let matchedCount = 0;

	// The extractions are cached: several rules may target the same one, and the
	// OCR layer is bulky.
	const extractionCache = new Map<string, ExtractionOutcome>();

	for (const row of rules) {
		const startedAt = Date.now();
		const evaluation = evaluateCondition(row.condition, prepared.subject);

		if (!evaluation.matched) {
			results.push({
				ruleId: row.id,
				ruleName: row.name,
				matched: false,
				trace: evaluation.trace,
				operations: [],
				extractions: [],
				durationMs: Date.now() - startedAt,
			});
			if (!options.dryRun && options.trigger === "manual") {
				await logRuleTrace(
					db,
					row.id,
					documentId,
					false,
					[],
					Date.now() - startedAt,
				);
			}
			continue;
		}

		matchedCount += 1;

		const ruleLike = {
			id: row.id,
			name: row.name,
			actions: row.actions,
		};
		const ids = referencedExtractionRuleIds(ruleLike);
		const missing = ids.filter((id) => !extractionCache.has(id));
		if (missing.length > 0) {
			const definitions = await db
				.select()
				.from(extractionRule)
				.where(inArray(extractionRule.id, missing));
			for (const definition of definitions) {
				const like = toExtractionRuleLike(definition);
				extractionCache.set(definition.id, {
					rule: like,
					result: await runExtractionRuleOn(db, documentId, like),
				});
			}
		}

		const operations = planActions(
			ruleLike,
			prepared.subject,
			extractionCache,
			locale,
		);

		const outcome = options.dryRun
			? { applied: operations, reasons: [] as ReviewReason[] }
			: await applyOperations(db, documentId, operations, {
					ruleId: row.id,
					confidenceThreshold: threshold,
					...(options.ingestion ? { ingestion: options.ingestion } : {}),
				});

		const durationMs = Date.now() - startedAt;
		reviewReasons.push(...outcome.reasons);
		results.push({
			ruleId: row.id,
			ruleName: row.name,
			matched: true,
			trace: evaluation.trace,
			operations,
			extractions: ids
				.map((id) => extractionCache.get(id))
				.filter((item): item is ExtractionOutcome => item !== undefined)
				.map((item) => ({
					...item.result,
					extractionRuleId: item.rule.id,
					extractionRuleName: item.rule.name,
				})),
			durationMs,
		});

		if (!options.dryRun) {
			await logRuleTrace(
				db,
				row.id,
				documentId,
				true,
				outcome.applied,
				durationMs,
			);
			await db
				.update(rule)
				.set({
					matchCount: sql`${rule.matchCount} + 1`,
					lastMatchedAt: new Date(),
				})
				.where(eq(rule.id, row.id));
		}

		if (row.stopOnMatch) break;
	}

	return {
		documentId,
		subject: prepared.subject,
		rules: results,
		matchedCount,
		reviewReasons,
	};
}

async function logRuleTrace(
	db: Db,
	ruleId: string,
	documentId: string,
	matched: boolean,
	actionsApplied: PlannedOperation[],
	durationMs: number,
): Promise<void> {
	await db
		.insert(ruleRun)
		.values({ ruleId, documentId, matched, actionsApplied, durationMs });
}

/**
 * Purges the run log beyond the retention window (90 days).
 * Called at server startup.
 */
export async function purgeRuleRuns(
	db: Db,
	retentionDays: number = RULE_RUN_RETENTION_DAYS,
): Promise<number> {
	const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
	const deleted = await db
		.delete(ruleRun)
		.where(lt(ruleRun.createdAt, cutoff))
		.returning({ id: ruleRun.id });
	return deleted.length;
}
