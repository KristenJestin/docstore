import type { DatePrecision } from "@docstore/shared/document";
import type {
	ExtractionResult,
	ExtractionStrategy,
	ExtractionTarget,
	PostprocessStep,
} from "@docstore/shared/extraction";
import type { PlannedOperation, RuleAction } from "@docstore/shared/rule";
import type { RuleSubject } from "./condition";
import { renderTitleTemplate } from "./title";

/**
 * Translation of a rule's actions into operations to apply (SPEC §3).
 *
 * `planActions` is pure: it does not decide *how* to write, only *what* to
 * write. Execution (services, transactions) lives in `@docstore/ingestion`.
 */

/** Confidence of a Party matched by a strong identifier (SIREN/SIRET/VAT/IBAN). */
export const STRONG_IDENTIFIER_CONFIDENCE = 0.9;
/** Confidence of a match by email or domain. */
export const WEAK_IDENTIFIER_CONFIDENCE = 0.7;
/** Confidence of a date suggested by plain detection in the text. */
export const AUTO_DATE_CONFIDENCE = 0.6;
/** Confidence of a literal value set explicitly by a rule. */
export const LITERAL_CONFIDENCE = 1;

export interface RuleLike {
	id: string;
	name: string;
	actions: RuleAction[];
}

export interface ExtractionRuleLike {
	id: string;
	name: string;
	target: ExtractionTarget;
	strategy: ExtractionStrategy;
	postprocess: PostprocessStep[];
}

export interface ExtractionOutcome {
	rule: ExtractionRuleLike;
	result: ExtractionResult;
}

function lastDayOfMonth(date: string): string {
	const year = Number(date.slice(0, 4));
	const month = Number(date.slice(5, 7));
	const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** Rendering context for a title template, built from the evaluated subject. */
export function titleContextOf(subject: RuleSubject) {
	const issuer = subject.parties.find((party) => party.role === "issuer");
	const person = subject.parties.find((party) => party.role === "subject");
	return {
		date: subject.documentDate,
		issuer: issuer?.name ?? null,
		subject: person?.name ?? null,
		category:
			subject.categoryName ??
			subject.categorySlugPath[subject.categorySlugPath.length - 1] ??
			null,
		title: subject.title,
		filename: subject.filename,
		periodStart: subject.periodStart ?? null,
		periodEnd: subject.periodEnd ?? null,
	};
}

/**
 * Converts an extraction result into an operation, according to its target.
 *
 * Exported because applying a document type (SPEC §9) runs the extraction rules
 * of a layout outside of any rule, and turns their results into exactly the
 * same operations.
 */
export function operationFromExtraction(
	outcome: ExtractionOutcome,
	subject: RuleSubject,
): PlannedOperation {
	const { rule, result } = outcome;
	const failed: PlannedOperation = {
		type: "extraction_failed",
		extractionRuleId: rule.id,
		extractionRuleName: rule.name,
		...(rule.target.kind === "field" ? { fieldId: rule.target.fieldId } : {}),
	};
	if (result.value === null || result.value === undefined) return failed;

	switch (rule.target.kind) {
		case "field":
			return {
				type: "set_field",
				fieldId: rule.target.fieldId,
				value: result.value,
				confidence: result.confidence,
				extractionRuleId: rule.id,
			};
		case "document_date":
			return {
				type: "set_document_date",
				date: String(result.value),
				precision: result.precision ?? "day",
				confidence: result.confidence,
			};
		case "period": {
			const date = String(result.value);
			const isMonth = result.precision === "month";
			return {
				type: "set_period",
				start: date,
				end: isMonth ? lastDayOfMonth(date) : date,
				confidence: result.confidence,
			};
		}
		case "valid_until":
			return {
				type: "set_valid_until",
				date: String(result.value),
				confidence: result.confidence,
			};
		default:
			return {
				type: "set_title",
				title: renderTitleTemplate(
					String(result.value),
					titleContextOf(subject),
				),
			};
	}
}

function autoDate(
	subject: RuleSubject,
): { date: string; precision: DatePrecision } | null {
	const candidate = subject.detectedDates?.[0];
	return candidate
		? { date: candidate.date, precision: candidate.precision }
		: null;
}

/**
 * Unrolls the actions of a rule (assumed already matched) into operations.
 * `extractions` holds the result of every referenced extraction rule.
 */
export function planActions(
	rule: RuleLike,
	subject: RuleSubject,
	extractions: ReadonlyMap<string, ExtractionOutcome>,
): PlannedOperation[] {
	const operations: PlannedOperation[] = [];

	const fromExtraction = (id: string): PlannedOperation | null => {
		const outcome = extractions.get(id);
		return outcome ? operationFromExtraction(outcome, subject) : null;
	};

	for (const action of rule.actions) {
		switch (action.type) {
			case "set_document_type":
				operations.push({
					type: "set_document_type",
					documentTypeId: action.documentTypeId,
					confidence: LITERAL_CONFIDENCE,
				});
				break;
			case "add_tag":
				operations.push({ type: "add_tag", tagId: action.tagId });
				break;
			case "remove_tag":
				operations.push({ type: "remove_tag", tagId: action.tagId });
				break;
			case "link_party":
				operations.push({
					type: "link_party",
					partyId: action.partyId,
					role: action.role,
					confidence: LITERAL_CONFIDENCE,
				});
				break;
			case "set_sensitive":
				operations.push({
					type: "set_sensitive",
					sensitive: action.sensitive,
				});
				break;
			case "set_title":
				operations.push({
					type: "set_title",
					title: renderTitleTemplate(action.template, titleContextOf(subject)),
				});
				break;
			case "webhook":
				operations.push({ type: "webhook", url: action.url });
				break;
			case "set_field":
				operations.push({
					type: "set_field",
					fieldId: action.fieldId,
					value: action.value,
					confidence: LITERAL_CONFIDENCE,
				});
				break;
			case "set_document_date": {
				if (action.extractionRuleId) {
					const operation = fromExtraction(action.extractionRuleId);
					if (operation) operations.push(operation);
					break;
				}
				const detected = autoDate(subject);
				if (detected) {
					operations.push({
						type: "set_document_date",
						date: detected.date,
						precision: detected.precision,
						confidence: AUTO_DATE_CONFIDENCE,
					});
				}
				break;
			}
			case "set_period": {
				if (action.extractionRuleId) {
					const operation = fromExtraction(action.extractionRuleId);
					if (operation) operations.push(operation);
					break;
				}
				const period = subject.detectedPeriods?.[0];
				if (period) {
					operations.push({
						type: "set_period",
						start: period.start,
						end: period.end,
						confidence: AUTO_DATE_CONFIDENCE,
					});
				}
				break;
			}
			case "set_valid_until": {
				if (action.extractionRuleId) {
					const operation = fromExtraction(action.extractionRuleId);
					if (operation) operations.push(operation);
				}
				break;
			}
			// Unknown action (a `run_extraction` left over in an old row, say):
			// ignored rather than guessed.
			default:
				break;
		}
	}

	return operations;
}

/** Identifiers of the extraction rules referenced by a rule. */
export function referencedExtractionRuleIds(rule: RuleLike): string[] {
	const ids = new Set<string>();
	for (const action of rule.actions) {
		if (
			(action.type === "set_document_date" ||
				action.type === "set_period" ||
				action.type === "set_valid_until") &&
			action.extractionRuleId
		) {
			ids.add(action.extractionRuleId);
		}
	}
	return [...ids];
}
