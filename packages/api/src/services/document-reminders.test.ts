import { describe, expect, test } from "bun:test";
import { fieldDateLeadDays } from "./document-reminders";

/** D33-03: which lead days a date field value gets, as a pure rule. */
describe("fieldDateLeadDays", () => {
	const today = "2026-10-01";
	const none = () => false;

	test("a date 60 days away keeps D-30 and D-7, not a D-90 already late", () => {
		expect(fieldDateLeadDays("2026-11-30", [90, 30, 7], today, none)).toEqual([
			30, 7,
		]);
	});

	test("a date far ahead keeps every lead", () => {
		expect(fieldDateLeadDays("2027-06-30", [90, 30, 7], today, none)).toEqual([
			90, 30, 7,
		]);
	});

	test("a lead already created keeps its place once its due date passes", () => {
		const exists = (due: string) => due === "2026-09-01";
		expect(
			fieldDateLeadDays("2026-10-01", [30, 7], "2026-09-20", exists),
		).toEqual([30, 7]);
	});

	test("a date still ahead whose every lead is past gets the shortest one", () => {
		expect(fieldDateLeadDays("2026-10-04", [90, 30, 7], today, none)).toEqual([
			7,
		]);
	});

	test("a date already past gets nothing new", () => {
		expect(fieldDateLeadDays("2026-09-30", [90, 30, 7], today, none)).toEqual(
			[],
		);
	});
});
