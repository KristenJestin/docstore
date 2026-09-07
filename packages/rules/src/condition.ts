import type { DocumentSource } from "@docstore/shared/document";
import type {
	RuleComparator,
	RuleCondition,
	RuleConditionField,
	RuleConditionValue,
} from "@docstore/shared/rule";
import type { DateCandidate, PeriodCandidate } from "./dates";
import type { DetectedIdentifier } from "./identifiers";
import { safeMatchRegex } from "./regex";

/**
 * Evaluation of rule conditions (SPEC §3).
 *
 * Everything comes in through a `RuleSubject`: the engine never touches the
 * database. The values of a field are always seen as a list (a document has
 * several Party entries, several tags, several detected identifiers) and a
 * comparison succeeds as soon as one value satisfies it.
 */

export interface RuleSubjectParty {
	partyId: string;
	role: string;
	name: string;
}

export interface RuleSubject {
	content: string;
	filename: string;
	mime: string;
	pageCount: number | null;
	source: DocumentSource;
	/**
	 * Context of the originating message, filled in by the mail channel from
	 * `document.intake_meta`. `receivedAt` (ISO 8601) cannot be used in a
	 * condition: it is there for display and for actions.
	 */
	mail?: { from?: string; subject?: string; receivedAt?: string };
	detectedIdentifiers: DetectedIdentifier[];
	parties: RuleSubjectParty[];
	categoryId: string | null;
	/** Slugs from the root down to the category, to compare without knowing the id. */
	categorySlugPath: string[];
	categoryName?: string | null;
	/** Identifiers of the tags set on the document. */
	tags: string[];
	documentDate: string | null;
	title: string;
	periodStart?: string | null;
	periodEnd?: string | null;
	/** Dates spotted by the pre-pass, used by `set_document_date`. */
	detectedDates?: DateCandidate[];
	detectedPeriods?: PeriodCandidate[];
}

export interface ConditionTraceEntry {
	node: RuleCondition;
	result: boolean;
	/** Indexes of children from the root down to this node (`[]` = the root). */
	path: number[];
	kind: "group" | "leaf";
}

export interface ConditionResult {
	matched: boolean;
	trace: ConditionTraceEntry[];
}

type Scalar = string | number;

function isGroup(
	node: RuleCondition,
): node is Extract<RuleCondition, { op: string }> {
	return "op" in node;
}

/** Comparable values of a field, always as a list. */
export function fieldValues(
	field: RuleConditionField,
	subject: RuleSubject,
): Scalar[] {
	switch (field) {
		case "content":
			return [subject.content];
		case "filename":
			return [subject.filename];
		case "mime":
			return [subject.mime];
		case "page_count":
			return subject.pageCount === null ? [] : [subject.pageCount];
		case "source":
			return [subject.source];
		case "mail.from":
			return subject.mail?.from ? [subject.mail.from] : [];
		case "mail.subject":
			return subject.mail?.subject ? [subject.mail.subject] : [];
		case "party.id":
			return subject.parties.map((item) => item.partyId);
		case "party.name":
			return subject.parties.map((item) => item.name);
		case "category":
			// Both the id and the slugs are accepted: a rule can target
			// "payslip" without knowing the generated identifier.
			return subject.categoryId
				? [subject.categoryId, ...subject.categorySlugPath]
				: [];
		case "tags":
			return subject.tags;
		case "document_date":
			return subject.documentDate ? [subject.documentDate] : [];
		case "title":
			return [subject.title];
		default: {
			const kind = field.slice("detected_identifiers.".length);
			return subject.detectedIdentifiers
				.filter((identifier) => identifier.kind === kind)
				.map((identifier) => identifier.value);
		}
	}
}

function toText(value: Scalar): string {
	return typeof value === "string" ? value : String(value);
}

function numeric(value: Scalar | boolean): number | null {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "boolean") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Ordered comparison: numeric when possible, lexicographic otherwise. */
function compare(left: Scalar, right: Scalar | boolean): number | null {
	const leftNumber = numeric(left);
	const rightNumber = numeric(right);
	if (leftNumber !== null && rightNumber !== null) {
		return leftNumber - rightNumber;
	}
	if (typeof right === "boolean") return null;
	const leftText = toText(left);
	const rightText = toText(right);
	return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function equals(left: Scalar, right: RuleConditionValue): boolean {
	if (Array.isArray(right)) return right.some((item) => equals(left, item));
	if (typeof right === "boolean") return false;
	const leftNumber = numeric(left);
	const rightNumber = numeric(right);
	if (leftNumber !== null && rightNumber !== null) {
		return leftNumber === rightNumber;
	}
	return toText(left) === toText(right);
}

function toList(value: RuleConditionValue | undefined): Scalar[] {
	if (value === undefined) return [];
	if (Array.isArray(value)) return value;
	if (typeof value === "boolean") return [];
	return [value];
}

function matchesOne(
	cmp: RuleComparator,
	actual: Scalar,
	expected: RuleConditionValue | undefined,
	flags: string | undefined,
): boolean {
	const text = toText(actual);

	switch (cmp) {
		case "eq":
			return expected !== undefined && equals(actual, expected);
		case "neq":
			return expected === undefined || !equals(actual, expected);
		case "contains":
			return (
				expected !== undefined &&
				text.includes(toText(toList(expected)[0] ?? ""))
			);
		case "icontains": {
			const needle = toText(toList(expected)[0] ?? "");
			return (
				expected !== undefined &&
				text.toLowerCase().includes(needle.toLowerCase())
			);
		}
		case "startsWith":
			return (
				expected !== undefined &&
				text
					.toLowerCase()
					.startsWith(toText(toList(expected)[0] ?? "").toLowerCase())
			);
		case "endsWith":
			return (
				expected !== undefined &&
				text
					.toLowerCase()
					.endsWith(toText(toList(expected)[0] ?? "").toLowerCase())
			);
		case "regex": {
			const pattern = toText(toList(expected)[0] ?? "");
			const regex = safeMatchRegex(pattern, flags ?? "i");
			return regex ? regex.test(text) : false;
		}
		case "in":
			return toList(expected).some((item) => equals(actual, item));
		case "gt": {
			const first = toList(expected)[0];
			if (first === undefined) return false;
			const diff = compare(actual, first);
			return diff !== null && diff > 0;
		}
		case "lt": {
			const first = toList(expected)[0];
			if (first === undefined) return false;
			const diff = compare(actual, first);
			return diff !== null && diff < 0;
		}
		case "between": {
			const [low, high] = toList(expected);
			if (low === undefined || high === undefined) return false;
			const lower = compare(actual, low);
			const upper = compare(actual, high);
			return lower !== null && upper !== null && lower >= 0 && upper <= 0;
		}
		default:
			return true;
	}
}

function evaluateLeaf(
	leaf: Extract<RuleCondition, { field: RuleConditionField }>,
	subject: RuleSubject,
): boolean {
	const values = fieldValues(leaf.field, subject).filter(
		(value) => typeof value === "number" || value.length > 0,
	);

	if (leaf.cmp === "exists") {
		const present = values.length > 0;
		return leaf.value === false ? !present : present;
	}
	if (leaf.cmp === "neq") {
		// "not equal" over a list: no value may match.
		return values.every((value) =>
			matchesOne("neq", value, leaf.value, leaf.flags),
		);
	}
	return values.some((value) =>
		matchesOne(leaf.cmp, value, leaf.value, leaf.flags),
	);
}

/**
 * Evaluates the tree and returns the full trace (one record per node, children
 * before parents) for the rule test mode.
 */
export function evaluateCondition(
	condition: RuleCondition,
	subject: RuleSubject,
): ConditionResult {
	const trace: ConditionTraceEntry[] = [];

	const walk = (node: RuleCondition, path: number[]): boolean => {
		if (!isGroup(node)) {
			const result = evaluateLeaf(node, subject);
			trace.push({ node, result, path, kind: "leaf" });
			return result;
		}

		const children = node.children ?? [];
		const results = children.map((child, index) =>
			walk(child, [...path, index]),
		);
		let result: boolean;
		switch (node.op) {
			case "and":
				result = results.every(Boolean);
				break;
			case "or":
				result = results.some(Boolean);
				break;
			default:
				// `not`: true when no child matches.
				result = !results.some(Boolean);
				break;
		}
		trace.push({ node, result, path, kind: "group" });
		return result;
	};

	return { matched: walk(condition, []), trace };
}
