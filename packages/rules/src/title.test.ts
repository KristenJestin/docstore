import { describe, expect, test } from "bun:test";
import {
	renderTitleTemplate,
	TITLE_TEMPLATE_PLACEHOLDERS,
	unknownTemplatePlaceholders,
} from "./title";

const context = {
	date: "2025-12-05",
	issuer: "Nordwind Digital",
	subject: "Camille Moreau",
	category: "Bulletin de paie",
	title: "bulletin-2025-12",
	filename: "bulletin-2025-12.pdf",
	ext: "pdf",
	periodStart: "2025-12-01",
	periodEnd: "2025-12-31",
};

describe("renderTitleTemplate", () => {
	test("full template from SPEC §3", () => {
		expect(
			renderTitleTemplate("{date:YYYY-MM} - {issuer} - {category}", context),
		).toBe("2025-12 - Nordwind Digital - Bulletin de paie");
	});

	test("date formats", () => {
		expect(renderTitleTemplate("{date}", context)).toBe("2025-12-05");
		expect(renderTitleTemplate("{date:YYYY}", context)).toBe("2025");
		expect(renderTitleTemplate("{date:YYYY-MM-DD}", context)).toBe(
			"2025-12-05",
		);
	});

	test("subject, title and file name", () => {
		expect(
			renderTitleTemplate("{subject} / {title} / {filename}", context),
		).toBe("Camille Moreau / bulletin-2025-12 / bulletin-2025-12.pdf");
	});

	test("file extension, without its dot", () => {
		expect(renderTitleTemplate("{title}.{ext}", context)).toBe(
			"bulletin-2025-12.pdf",
		);
	});

	test("period within a single month", () => {
		expect(renderTitleTemplate("{period}", context)).toBe("2025-12");
	});

	test("period spanning two months", () => {
		expect(
			renderTitleTemplate("{period}", {
				periodStart: "2025-01-01",
				periodEnd: "2025-03-31",
			}),
		).toBe("2025-01-01 to 2025-03-31");
	});

	test("missing values disappear along with their separator", () => {
		expect(
			renderTitleTemplate("{date:YYYY-MM} - {issuer} - {category}", {
				date: "2025-12-05",
				category: "Facture",
			}),
		).toBe("2025-12 - Facture");
	});

	test("a fully empty template yields an empty string", () => {
		expect(renderTitleTemplate("{issuer} - {subject}", {})).toBe("");
	});

	test("an unknown placeholder is left as-is", () => {
		expect(renderTitleTemplate("{inconnu} {issuer}", context)).toBe(
			"{inconnu} Nordwind Digital",
		);
	});
});

describe("unknownTemplatePlaceholders", () => {
	test("a template made of known placeholders is clean", () => {
		expect(
			unknownTemplatePlaceholders("{date:YYYY-MM} - {issuer} - {title}"),
		).toEqual([]);
	});

	test("reports the unknown ones, once each, in order", () => {
		expect(
			unknownTemplatePlaceholders("{invoice} - {date} - {amount} - {invoice}"),
		).toEqual(["invoice", "amount"]);
	});

	test("every documented placeholder is accepted", () => {
		for (const name of TITLE_TEMPLATE_PLACEHOLDERS) {
			expect(unknownTemplatePlaceholders(`{${name}}`)).toEqual([]);
		}
	});
});
