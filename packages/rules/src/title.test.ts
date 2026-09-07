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

describe("document type placeholders", () => {
	const recurring = {
		...context,
		type: "EDF electricity bill",
		periodStart: "2026-03-01",
		periodEnd: "2026-03-31",
		periodKey: "2026-03",
	};

	test("{type} carries the name of the document type", () => {
		expect(renderTitleTemplate("{type}", recurring)).toBe(
			"EDF electricity bill",
		);
		// Outside a document type there is no name to fill in.
		expect(renderTitleTemplate("{type} {issuer}", context)).toBe(
			"Nordwind Digital",
		);
	});

	test("{period} is the period key as soon as the caller knows it", () => {
		expect(renderTitleTemplate("{period}", recurring)).toBe("2026-03");
		expect(
			renderTitleTemplate("{period}", {
				...recurring,
				periodStart: "2026-01-01",
				periodEnd: "2026-06-30",
				periodKey: "2026-H1",
			}),
		).toBe("2026-H1");
	});

	test("the period formats read in en-GB", () => {
		expect(renderTitleTemplate("{period:MMMM yyyy}", recurring)).toBe(
			"March 2026",
		);
		expect(renderTitleTemplate("{period:yyyy-MM}", recurring)).toBe("2026-03");
		expect(renderTitleTemplate("{period:yyyy}", recurring)).toBe("2026");
	});

	test("the default template of a recurring type", () => {
		expect(renderTitleTemplate("{type} {period:MMMM yyyy}", recurring)).toBe(
			"EDF electricity bill March 2026",
		);
	});

	test("a formatted period without a period start renders nothing", () => {
		expect(
			renderTitleTemplate("{type} {period:MMMM yyyy}", { type: "Payslip" }),
		).toBe("Payslip");
	});
});

describe("content language", () => {
	const recurring = {
		type: "Payslip",
		periodStart: "2026-01-01",
		periodEnd: "2026-01-31",
		periodKey: "2026-01",
	};

	test("month names follow the content language", () => {
		expect(renderTitleTemplate("{period:MMMM yyyy}", recurring, "en-GB")).toBe(
			"January 2026",
		);
		expect(renderTitleTemplate("{period:MMMM yyyy}", recurring, "fr-FR")).toBe(
			"janvier 2026",
		);
		expect(renderTitleTemplate("{period:MMMM}", recurring, "fr-FR")).toBe(
			"janvier",
		);
	});

	test("{period:MMM} is the short month, in both languages", () => {
		expect(renderTitleTemplate("{period:MMM}", recurring, "en-GB")).toBe("Jan");
		expect(renderTitleTemplate("{period:MMM}", recurring, "fr-FR")).toBe(
			"janv",
		);
		expect(renderTitleTemplate("{period:MMM yyyy}", recurring, "fr-FR")).toBe(
			"janv 2026",
		);
	});

	test("the numeric formats say the same thing in every language", () => {
		for (const locale of ["en-GB", "fr-FR"] as const) {
			expect(renderTitleTemplate("{period:yyyy-MM}", recurring, locale)).toBe(
				"2026-01",
			);
			expect(renderTitleTemplate("{period:yyyy}", recurring, locale)).toBe(
				"2026",
			);
			expect(
				renderTitleTemplate(
					"{date:YYYY-MM-DD}",
					{ date: "2026-01-15" },
					locale,
				),
			).toBe("2026-01-15");
		}
	});

	test("the whole template of a French recurring type", () => {
		expect(
			renderTitleTemplate("{type} {period:MMMM yyyy}", recurring, "fr-FR"),
		).toBe("Payslip janvier 2026");
	});

	test("without a locale the interface language is used", () => {
		expect(renderTitleTemplate("{period:MMMM yyyy}", recurring)).toBe(
			"January 2026",
		);
	});
});

describe("per-token language", () => {
	const recurring = {
		type: "Payslip",
		date: "2026-01-15",
		periodStart: "2026-01-01",
		periodEnd: "2026-01-31",
		periodKey: "2026-01",
	};

	test("a token can pin its own language, whatever the setting says", () => {
		expect(
			renderTitleTemplate("{period:MMMM yyyy|fr-FR}", recurring, "en-GB"),
		).toBe("janvier 2026");
		expect(
			renderTitleTemplate("{period:MMMM yyyy|en-GB}", recurring, "fr-FR"),
		).toBe("January 2026");
		expect(renderTitleTemplate("{period:MMM|fr-FR}", recurring, "en-GB")).toBe(
			"janv",
		);
	});

	test("{date} takes a spelled-out month and a language too", () => {
		expect(renderTitleTemplate("{date:MMMM yyyy}", recurring, "fr-FR")).toBe(
			"janvier 2026",
		);
		expect(
			renderTitleTemplate("{date:MMMM yyyy|fr-FR}", recurring, "en-GB"),
		).toBe("janvier 2026");
		// The numeric formats keep saying exactly what they always said.
		expect(
			renderTitleTemplate("{date:YYYY-MM|fr-FR}", recurring, "en-GB"),
		).toBe("2026-01");
		expect(renderTitleTemplate("{date:YYYY-MM-DD}", recurring, "fr-FR")).toBe(
			"2026-01-15",
		);
	});

	test("only the pinned token changes language", () => {
		expect(
			renderTitleTemplate(
				"{period:MMMM yyyy} - {period:MMMM yyyy|fr-FR}",
				recurring,
				"en-GB",
			),
		).toBe("January 2026 - janvier 2026");
	});

	test("the language is matched whatever its casing", () => {
		expect(
			renderTitleTemplate("{period:MMMM yyyy|FR-fr}", recurring, "en-GB"),
		).toBe("janvier 2026");
		expect(
			renderTitleTemplate("{period:MMMM yyyy | fr-FR}", recurring, "en-GB"),
		).toBe("janvier 2026");
	});

	test("a language nobody speaks is not a language: the format falls back", () => {
		// `MMMM yyyy|de-DE` is read as one unknown format, so `{period}` renders
		// the period key rather than inventing German.
		expect(
			renderTitleTemplate("{period:MMMM yyyy|de-DE}", recurring, "en-GB"),
		).toBe("2026-01");
		expect(
			renderTitleTemplate("{date:MMMM yyyy|de-DE}", recurring, "en-GB"),
		).toBe("2026-01-15");
	});

	test("a numeric format ignores the language it was given", () => {
		for (const locale of ["en-GB", "fr-FR"] as const) {
			expect(
				renderTitleTemplate("{period:yyyy-MM|fr-FR}", recurring, locale),
			).toBe("2026-01");
		}
	});

	test("a pinned language still counts as a known placeholder", () => {
		expect(
			unknownTemplatePlaceholders("{period:MMMM yyyy|fr-FR} {nope}"),
		).toEqual(["nope"]);
	});
});
