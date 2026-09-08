import { describe, expect, test } from "bun:test";
import type { ExtractionResult } from "@docstore/shared/extraction";
import type { RuleAction } from "@docstore/shared/rule";
import type {
	ExtractionOutcome,
	ExtractionRuleLike,
	RuleLike,
} from "./actions";
import {
	AUTO_DATE_CONFIDENCE,
	LITERAL_CONFIDENCE,
	operationFromExtraction,
	planActions,
	referencedExtractionRuleIds,
} from "./actions";
import type { RuleSubject } from "./condition";

function subject(overrides: Partial<RuleSubject> = {}): RuleSubject {
	return {
		content: "Bulletin de paie",
		filename: "bulletin.pdf",
		mime: "application/pdf",
		pageCount: 1,
		source: "upload",
		detectedIdentifiers: [],
		parties: [
			{ partyId: "prt_1", role: "issuer", name: "Nordwind Digital" },
			{ partyId: "prt_2", role: "subject", name: "Camille Moreau" },
		],
		categoryId: "cat_1",
		categorySlugPath: ["payslip"],
		categoryName: "Bulletin de paie",
		tags: [],
		documentDate: "2025-12-05",
		title: "bulletin",
		detectedDates: [
			{ date: "2025-12-05", precision: "day", raw: "05/12/2025", index: 0 },
		],
		detectedPeriods: [
			{
				start: "2025-12-01",
				end: "2025-12-31",
				raw: "du 01/12/2025 au 31/12/2025",
				index: 0,
			},
		],
		...overrides,
	};
}

function rule(actions: RuleAction[]): RuleLike {
	return { id: "rul_1", name: "Règle", actions };
}

function outcome(
	target: ExtractionRuleLike["target"],
	result: ExtractionResult,
	options: { id?: string; required?: boolean } = {},
): Map<string, ExtractionOutcome> {
	const id = options.id ?? "ext_1";
	return new Map([
		[
			id,
			{
				rule: {
					id,
					name: "Net à payer",
					target,
					strategy: { kind: "regex", pattern: "x", group: 1 },
					postprocess: [],
					...(options.required === undefined
						? {}
						: { required: options.required }),
				},
				result,
			},
		],
	]);
}

const empty = new Map<string, ExtractionOutcome>();

describe("planActions", () => {
	test("translates the simple actions", () => {
		const operations = planActions(
			rule([
				{ type: "add_tag", tagId: "tag_1" },
				{ type: "remove_tag", tagId: "tag_2" },
				{ type: "set_sensitive", sensitive: true },
			]),
			subject(),
			empty,
		);
		expect(operations).toEqual([
			{ type: "add_tag", tagId: "tag_1" },
			{ type: "remove_tag", tagId: "tag_2" },
			{ type: "set_sensitive", sensitive: true },
		]);
	});

	test("plans `set_document_type` with a literal confidence", () => {
		const operations = planActions(
			rule([{ type: "set_document_type", documentTypeId: "dty_1" }]),
			subject(),
			empty,
		);
		expect(operations).toEqual([
			{
				type: "set_document_type",
				documentTypeId: "dty_1",
				confidence: LITERAL_CONFIDENCE,
			},
		]);
	});

	test("plans `set_category` with a literal confidence", () => {
		const operations = planActions(
			rule([{ type: "set_category", categoryId: "cat_9" }]),
			subject(),
			empty,
		);
		expect(operations).toEqual([
			{
				type: "set_category",
				categoryId: "cat_9",
				confidence: LITERAL_CONFIDENCE,
			},
		]);
	});

	test("plans `add_to_dossier`", () => {
		const operations = planActions(
			rule([{ type: "add_to_dossier", dossierId: "dos_1" }]),
			subject(),
			empty,
		);
		expect(operations).toEqual([
			{ type: "add_to_dossier", dossierId: "dos_1" },
		]);
	});

	test("link_party carries maximum confidence", () => {
		const operations = planActions(
			rule([{ type: "link_party", partyId: "prt_9", role: "issuer" }]),
			subject(),
			empty,
		);
		expect(operations[0]).toEqual({
			type: "link_party",
			partyId: "prt_9",
			role: "issuer",
			confidence: LITERAL_CONFIDENCE,
		});
	});

	test("set_title renders the template with the subject context", () => {
		const operations = planActions(
			rule([
				{
					type: "set_title",
					template: "{date:YYYY-MM} - {issuer} - {category}",
				},
			]),
			subject(),
			empty,
		);
		expect(operations[0]).toEqual({
			type: "set_title",
			title: "2025-12 - Nordwind Digital - Bulletin de paie",
		});
	});

	test("an extraction into a field becomes a set_field operation", () => {
		const outcomes = outcome(
			{ kind: "field", fieldId: "cf_net" },
			{ raw: "1 234,56", value: 1234.56, confidence: 0.95 },
		);
		const only = outcomes.get("ext_1");
		if (!only) throw new Error("missing outcome");
		expect(operationFromExtraction(only, subject())).toEqual({
			type: "set_field",
			fieldId: "cf_net",
			value: 1234.56,
			confidence: 0.95,
			extractionRuleId: "ext_1",
		});
	});

	test("an extraction into a month period covers the whole month", () => {
		const outcomes = outcome(
			{ kind: "period" },
			{
				raw: "Décembre 2025",
				value: "2025-12-01",
				confidence: 1,
				precision: "month",
			},
		);
		const only = outcomes.get("ext_1");
		if (!only) throw new Error("missing outcome");
		expect(operationFromExtraction(only, subject())).toEqual({
			type: "set_period",
			start: "2025-12-01",
			end: "2025-12-31",
			confidence: 1,
		});
	});

	test("an extraction into a period reads a bare year as that whole year", () => {
		const outcomes = outcome(
			{ kind: "period" },
			{ raw: "2025", value: "2025", confidence: 0.8 },
		);
		const only = outcomes.get("ext_1");
		if (!only) throw new Error("missing outcome");
		expect(operationFromExtraction(only, subject())).toEqual({
			type: "set_period",
			start: "2025-01-01",
			end: "2025-12-31",
			confidence: 0.8,
		});
	});

	test("a year-precision date covers its whole year too", () => {
		const outcomes = outcome(
			{ kind: "period" },
			{
				raw: "année 2025",
				value: "2025-01-01",
				confidence: 1,
				precision: "year",
			},
		);
		const only = outcomes.get("ext_1");
		if (!only) throw new Error("missing outcome");
		expect(operationFromExtraction(only, subject())).toEqual({
			type: "set_period",
			start: "2025-01-01",
			end: "2025-12-31",
			confidence: 1,
		});
	});

	test("set_valid_until and set_document_date run their extraction", () => {
		expect(
			planActions(
				rule([{ type: "set_valid_until", extractionRuleId: "ext_1" }]),
				subject(),
				outcome(
					{ kind: "valid_until" },
					{ raw: "31/12/2026", value: "2026-12-31", confidence: 1 },
				),
			)[0],
		).toEqual({ type: "set_valid_until", date: "2026-12-31", confidence: 1 });

		expect(
			planActions(
				rule([{ type: "set_document_date", extractionRuleId: "ext_1" }]),
				subject(),
				outcome(
					{ kind: "document_date" },
					{
						raw: "12 octobre 2025",
						value: "2025-10-12",
						confidence: 0.9,
						precision: "day",
					},
				),
			)[0],
		).toEqual({
			type: "set_document_date",
			date: "2025-10-12",
			precision: "day",
			confidence: 0.9,
		});
	});

	test("an extraction without a value produces extraction_failed", () => {
		const operations = planActions(
			rule([{ type: "set_document_date", extractionRuleId: "ext_1" }]),
			subject(),
			outcome(
				{ kind: "field", fieldId: "cf_net" },
				{ raw: null, value: null, confidence: 0 },
			),
		);
		expect(operations[0]).toEqual({
			type: "extraction_failed",
			extractionRuleId: "ext_1",
			extractionRuleName: "Net à payer",
			fieldId: "cf_net",
			// The rule says nothing: a miss is optional, and never blocking.
			required: false,
		});
	});

	test("a required extraction carries the flag into the failure", () => {
		const operations = planActions(
			rule([{ type: "set_document_date", extractionRuleId: "ext_1" }]),
			subject(),
			outcome(
				{ kind: "field", fieldId: "cf_net" },
				{ raw: null, value: null, confidence: 0 },
				{ required: true },
			),
		);
		expect(operations[0]).toMatchObject({
			type: "extraction_failed",
			required: true,
		});
	});

	test("the removed `run_extraction` action is ignored", () => {
		const operations = planActions(
			// A row written before extraction rules moved into the layouts.
			rule([
				{
					type: "run_extraction",
					extractionRuleId: "ext_1",
				} as unknown as RuleAction,
			]),
			subject(),
			outcome(
				{ kind: "field", fieldId: "cf_net" },
				{ raw: "1 234,56", value: 1234.56, confidence: 0.95 },
			),
		);
		expect(operations).toEqual([]);
	});

	test("literal set_field", () => {
		const operations = planActions(
			rule([{ type: "set_field", fieldId: "cf_1", value: "ABC" }]),
			subject(),
			empty,
		);
		expect(operations[0]).toEqual({
			type: "set_field",
			fieldId: "cf_1",
			value: "ABC",
			confidence: LITERAL_CONFIDENCE,
		});
	});

	test("set_document_date without an extraction uses the detected date", () => {
		const operations = planActions(
			rule([{ type: "set_document_date" }]),
			subject(),
			empty,
		);
		expect(operations[0]).toEqual({
			type: "set_document_date",
			date: "2025-12-05",
			precision: "day",
			confidence: AUTO_DATE_CONFIDENCE,
		});
	});

	test("set_period writes the literal bounds it was given", () => {
		const operations = planActions(
			rule([
				{
					type: "set_period",
					periodStart: "2025-01-01",
					periodEnd: "2025-12-31",
				},
			]),
			subject(),
			empty,
		);
		expect(operations[0]).toEqual({
			type: "set_period",
			start: "2025-01-01",
			end: "2025-12-31",
			confidence: LITERAL_CONFIDENCE,
		});
	});

	test("set_period with a year covers the whole year", () => {
		const operations = planActions(
			rule([{ type: "set_period", year: 2025 }]),
			subject(),
			empty,
		);
		expect(operations[0]).toEqual({
			type: "set_period",
			start: "2025-01-01",
			end: "2025-12-31",
			confidence: LITERAL_CONFIDENCE,
		});
	});

	test("the literal bounds win over the year and over the detection", () => {
		const operations = planActions(
			rule([
				{
					type: "set_period",
					periodStart: "2024-04-01",
					periodEnd: "2025-03-31",
					year: 2025,
					extractionRuleId: "ext_1",
				},
			]),
			subject(),
			empty,
		);
		expect(operations[0]).toMatchObject({
			start: "2024-04-01",
			end: "2025-03-31",
		});
	});

	test("set_period without an extraction uses the detected period", () => {
		const operations = planActions(
			rule([{ type: "set_period" }]),
			subject(),
			empty,
		);
		expect(operations[0]).toEqual({
			type: "set_period",
			start: "2025-12-01",
			end: "2025-12-31",
			confidence: AUTO_DATE_CONFIDENCE,
		});
	});

	test("no detected date: no operation", () => {
		const operations = planActions(
			rule([{ type: "set_document_date" }, { type: "set_period" }]),
			subject({ detectedDates: [], detectedPeriods: [] }),
			empty,
		);
		expect(operations).toEqual([]);
	});

	test("the webhook is planned but never executed here", () => {
		const operations = planActions(
			rule([{ type: "webhook", url: "https://example.test/hook" }]),
			subject(),
			empty,
		);
		expect(operations[0]).toEqual({
			type: "webhook",
			url: "https://example.test/hook",
		});
	});

	test("a referenced but missing extraction is ignored", () => {
		const operations = planActions(
			rule([{ type: "set_document_date", extractionRuleId: "ext_absent" }]),
			subject(),
			empty,
		);
		expect(operations).toEqual([]);
	});
});

describe("referencedExtractionRuleIds", () => {
	test("collects every reference, without duplicates", () => {
		const ids = referencedExtractionRuleIds(
			rule([
				{ type: "set_document_date", extractionRuleId: "ext_2" },
				{ type: "set_period", extractionRuleId: "ext_3" },
				{ type: "set_period", extractionRuleId: "ext_3" },
				{ type: "set_valid_until", extractionRuleId: "ext_4" },
				{ type: "set_field", fieldId: "cf_1", value: "ABC" },
				{ type: "add_tag", tagId: "tag_1" },
			]),
		);
		expect(ids).toEqual(["ext_2", "ext_3", "ext_4"]);
	});
});
