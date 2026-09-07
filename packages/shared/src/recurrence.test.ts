import { describe, expect, test } from "bun:test";
import {
	dayGapsBetween,
	dueDateOf,
	enumeratePeriods,
	expectedDateOf,
	periodEndOf,
	periodicityFromDayGaps,
	periodKeyOf,
	periodStartOf,
} from "./recurrence";

/**
 * Period arithmetic shared by the timelines, the stats and the reminders
 * (SPEC §9). `weekly` follows ISO 8601: weeks start on Monday.
 */

describe("periodStartOf", () => {
	test("snaps to the start of the period", () => {
		expect(periodStartOf("weekly", "2024-01-04")).toBe("2024-01-01");
		expect(periodStartOf("weekly", "2024-01-01")).toBe("2024-01-01");
		expect(periodStartOf("weekly", "2024-01-07")).toBe("2024-01-01");
		expect(periodStartOf("monthly", "2024-03-17")).toBe("2024-03-01");
		expect(periodStartOf("quarterly", "2024-05-17")).toBe("2024-04-01");
		expect(periodStartOf("yearly", "2024-05-17")).toBe("2024-01-01");
	});
});

describe("periodEndOf", () => {
	test("closes the period on its last day", () => {
		expect(periodEndOf("weekly", "2024-01-01")).toBe("2024-01-07");
		expect(periodEndOf("monthly", "2024-02-01")).toBe("2024-02-29");
		expect(periodEndOf("quarterly", "2024-04-01")).toBe("2024-06-30");
		expect(periodEndOf("yearly", "2024-01-01")).toBe("2024-12-31");
	});
});

describe("periodKeyOf", () => {
	test("reads as YYYY-Www, YYYY-MM, YYYY-Qn or YYYY", () => {
		expect(periodKeyOf("weekly", "2024-01-04")).toBe("2024-W01");
		expect(periodKeyOf("weekly", "2024-12-30")).toBe("2025-W01");
		expect(periodKeyOf("weekly", "2026-03-05")).toBe("2026-W10");
		expect(periodKeyOf("monthly", "2026-03-05")).toBe("2026-03");
		expect(periodKeyOf("quarterly", "2026-03-05")).toBe("2026-Q1");
		expect(periodKeyOf("yearly", "2026-03-05")).toBe("2026");
	});
});

describe("enumeratePeriods", () => {
	test("walks from one period start to the next", () => {
		expect(enumeratePeriods("weekly", "2024-01-03", "2024-01-20")).toEqual([
			"2024-01-01",
			"2024-01-08",
			"2024-01-15",
		]);
		expect(enumeratePeriods("quarterly", "2024-02-01", "2024-08-01")).toEqual([
			"2024-01-01",
			"2024-04-01",
			"2024-07-01",
		]);
	});

	test("returns nothing when the bounds are inverted", () => {
		expect(enumeratePeriods("monthly", "2024-06-01", "2024-01-01")).toEqual([]);
	});
});

describe("expectedDateOf / dueDateOf", () => {
	test("without an expected day, the period ends the wait", () => {
		expect(expectedDateOf("monthly", "2024-02-01", null)).toBe("2024-02-29");
		expect(dueDateOf("monthly", "2024-02-01", null, 15)).toBe("2024-03-15");
	});

	test("a day of the month is clamped to the length of the month", () => {
		expect(expectedDateOf("monthly", "2024-02-01", 31)).toBe("2024-02-29");
		expect(expectedDateOf("quarterly", "2024-01-01", 5)).toBe("2024-03-05");
	});

	test("for a week, the expected day is an ISO weekday", () => {
		expect(expectedDateOf("weekly", "2024-01-01", 1)).toBe("2024-01-01");
		expect(expectedDateOf("weekly", "2024-01-01", 5)).toBe("2024-01-05");
		expect(expectedDateOf("weekly", "2024-01-01", 9)).toBe("2024-01-07");
	});
});

describe("periodicityFromDayGaps", () => {
	test("infers the periodicity from the median gap", () => {
		expect(periodicityFromDayGaps([7, 7, 7])).toBe("weekly");
		expect(periodicityFromDayGaps([30, 31, 28])).toBe("monthly");
		expect(periodicityFromDayGaps([91, 92])).toBe("quarterly");
		expect(periodicityFromDayGaps([365, 366])).toBe("yearly");
		// A single observation gives no gap at all: monthly is the safe default.
		expect(periodicityFromDayGaps([])).toBe("monthly");
	});
});

describe("dayGapsBetween", () => {
	test("measures the distance between successive period starts", () => {
		expect(dayGapsBetween(["2024-01-01", "2024-02-01", "2024-03-01"])).toEqual([
			31, 29,
		]);
		expect(dayGapsBetween(["2024-01-01"])).toEqual([]);
	});
});
