/**
 * `@docstore/rules` — rule and extraction engine (SPEC §3 and §4).
 *
 * A **pure** package: no dependency on the database or on the file system.
 * All data comes in as input (`RuleSubject`, `ExtractionInput`), which makes
 * the engine testable without any infrastructure.
 */

export {
	AUTO_DATE_CONFIDENCE,
	type ExtractionOutcome,
	type ExtractionRuleLike,
	LITERAL_CONFIDENCE,
	operationFromExtraction,
	planActions,
	type RuleLike,
	referencedExtractionRuleIds,
	STRONG_IDENTIFIER_CONFIDENCE,
	titleContextOf,
	WEAK_IDENTIFIER_CONFIDENCE,
} from "./actions";
export {
	type ConditionResult,
	type ConditionTraceEntry,
	evaluateCondition,
	fieldValues,
	type RuleSubject,
	type RuleSubjectParty,
} from "./condition";
export {
	type DateCandidate,
	type DocumentDateInput,
	type DocumentDatePick,
	detectDates,
	detectExplicitPeriods,
	detectIssueDate,
	detectPeriods,
	detectReadingPeriod,
	detectYearPeriod,
	formatDate,
	INFERRED_DATE_CONFIDENCE,
	LABELLED_DATE_CONFIDENCE,
	monthFromName,
	type PeriodCandidate,
	parseFrenchDate,
	parseFrenchMonth,
	pickDocumentDate,
} from "./dates";
export {
	type ExtractionInput,
	REGEX_CONFIDENCE,
	runExtraction,
} from "./extraction";
export {
	DETECTED_IDENTIFIER_KINDS,
	type DetectedIdentifier,
	type DetectedIdentifierKind,
	detectIdentifiers,
	isValidIban,
	isValidSiren,
	isValidSiret,
	isValidVatFr,
	luhnValid,
	normalizePhoneFr,
} from "./identifiers";
export {
	averageConfidence,
	buildLines,
	buildPageLines,
	type LayoutLineDetail,
	type LayoutWord,
	toBox,
	toLayoutLines,
} from "./layout";
export {
	applyPostprocess,
	type PostprocessOutcome,
	parseFrenchNumber,
} from "./postprocess";
export { safeMatchRegex, safeRegex } from "./regex";
export {
	renderTitleTemplate,
	TITLE_TEMPLATE_PLACEHOLDERS,
	type TitleTemplateContext,
	unknownTemplatePlaceholders,
} from "./title";
