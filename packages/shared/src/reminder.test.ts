import { describe, expect, test } from "bun:test";
import type { ReminderMessageContext } from "./reminder";
import { reminderMessage } from "./reminder";

/**
 * A reminder stores facts; the sentence is derived from them. These tests pin
 * both dictionaries, because the wording is now the only thing a reader sees
 * and nothing else in the codebase composes it.
 */

const expiry: ReminderMessageContext = {
	kind: "expiry",
	documentTitle: "Passport",
	dueDate: "2027-06-23",
	daysBefore: 7,
};

const gap: ReminderMessageContext = {
	kind: "period_gap",
	documentTypeName: "EDF invoice",
	periodKey: "2026-03",
	dueDate: "2026-04-10",
};

describe("reminderMessage — expiry", () => {
	test("the expiry date is the due date pushed back by the lead time", () => {
		expect(reminderMessage(expiry, "en-GB")).toBe(
			'"Passport" expires on 30 Jun 2027 (reminder at D-7).',
		);
		expect(reminderMessage(expiry, "fr-FR")).toBe(
			"« Passport » expire le 30 juin 2027 (rappel à J-7).",
		);
	});

	test("a reminder due on the day itself drops the lead time", () => {
		const today = { ...expiry, dueDate: "2027-06-30", daysBefore: 0 };
		expect(reminderMessage(today, "en-GB")).toBe(
			'"Passport" expires on 30 Jun 2027.',
		);
		expect(reminderMessage(today, "fr-FR")).toBe(
			"« Passport » expire le 30 juin 2027.",
		);
	});

	test("every lead time of the default set reads correctly", () => {
		expect(
			[90, 30, 7].map((daysBefore) =>
				reminderMessage(
					{ ...expiry, dueDate: "2027-01-01", daysBefore },
					"en-GB",
				),
			),
		).toEqual([
			'"Passport" expires on 1 Apr 2027 (reminder at D-90).',
			'"Passport" expires on 31 Jan 2027 (reminder at D-30).',
			'"Passport" expires on 8 Jan 2027 (reminder at D-7).',
		]);
	});

	test("a document without a title still produces a sentence", () => {
		expect(
			reminderMessage({ ...expiry, documentTitle: null }, "en-GB"),
		).toContain("Untitled document");
		expect(
			reminderMessage({ ...expiry, documentTitle: null }, "fr-FR"),
		).toContain("Document sans titre");
	});
});

describe("reminderMessage — missing period", () => {
	test("names the type and the period", () => {
		expect(reminderMessage(gap, "en-GB")).toBe(
			'Document type "EDF invoice": no document for the period 2026-03.',
		);
		expect(reminderMessage(gap, "fr-FR")).toBe(
			"Type de document « EDF invoice » : aucun document pour la période 2026-03.",
		);
	});

	test("falls back on the raw period when no key was computed", () => {
		const raw = { ...gap, periodKey: null, period: "2026-03-01" };
		expect(reminderMessage(raw, "en-GB")).toContain("2026-03-01");
	});
});

describe("reminderMessage — review pending", () => {
	test("has a wording in both languages", () => {
		const pending: ReminderMessageContext = {
			kind: "review_pending",
			dueDate: "2026-03-01",
		};
		expect(reminderMessage(pending, "en-GB")).toBe(
			"A document is waiting for review.",
		);
		expect(reminderMessage(pending, "fr-FR")).toBe(
			"Un document attend d'être vérifié.",
		);
	});
});

describe("reminderMessage — purity", () => {
	test("the same facts always give the same sentence", () => {
		expect(reminderMessage(expiry, "en-GB")).toBe(
			reminderMessage({ ...expiry }, "en-GB"),
		);
	});
});
