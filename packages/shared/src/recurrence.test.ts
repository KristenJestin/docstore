import { describe, expect, test } from "bun:test";
import {
	addMonths,
	dayGapsBetween,
	dueDateOf,
	enumeratePeriods,
	expectedDateOf,
	learnExpectedMonth,
	nextPeriodStart,
	periodEndOf,
	periodicityFromDayGaps,
	periodKeyOf,
	periodLengthInMonths,
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

describe("expected month (#32)", () => {
	test("a yearly type expected on 15 July is due on 15 July plus the grace days", () => {
		expect(expectedDateOf("yearly", "2026-01-01", 15, 7)).toBe("2026-07-15");
		expect(dueDateOf("yearly", "2026-01-01", 15, 15, 7)).toBe("2026-07-30");
	});

	test("without an expected day, the expected month ends the wait", () => {
		expect(expectedDateOf("yearly", "2026-01-01", null, 2)).toBe("2026-02-28");
		expect(expectedDateOf("yearly", "2024-01-01", 31, 2)).toBe("2024-02-29");
	});

	test("without an expected month, the last month of the period is used", () => {
		expect(expectedDateOf("yearly", "2026-01-01", 15)).toBe("2026-12-15");
		expect(expectedDateOf("yearly", "2026-01-01", 15, null)).toBe("2026-12-15");
	});

	test("a semiannual or quarterly month counts from the start of the period", () => {
		expect(expectedDateOf("semiannual", "2026-01-01", 10, 2)).toBe(
			"2026-02-10",
		);
		expect(expectedDateOf("semiannual", "2026-07-01", 10, 2)).toBe(
			"2026-08-10",
		);
		expect(expectedDateOf("quarterly", "2026-04-01", 5, 1)).toBe("2026-04-05");
		// Past the length of the period, the month is clamped to its last one.
		expect(expectedDateOf("quarterly", "2026-04-01", 5, 9)).toBe("2026-06-05");
	});

	test("weekly and monthly types ignore the expected month", () => {
		expect(expectedDateOf("monthly", "2026-03-01", 5, 7)).toBe("2026-03-05");
		expect(expectedDateOf("weekly", "2026-09-28", 2, 7)).toBe("2026-09-29");
	});

	test("the month is learned from the documents arriving inside their period", () => {
		expect(
			learnExpectedMonth("yearly", [
				{ anchor: "2024-07-10", arrival: "2024-07-10" },
				{ anchor: "2025-07-12", arrival: "2025-07-12" },
				{ anchor: "2023-08-02", arrival: "2023-08-02" },
			]),
		).toBe(7);
		expect(
			learnExpectedMonth("semiannual", [
				{ anchor: "2025-08-20", arrival: "2025-08-20" },
				{ anchor: "2026-02-18", arrival: "2026-02-18" },
			]),
		).toBe(2);
	});

	test("a document filed for another period teaches nothing", () => {
		// Tax notice for 2025, received in July 2026: its period is 2025.
		expect(
			learnExpectedMonth("yearly", [
				{ anchor: "2025-01-01", arrival: "2026-07-10" },
				{ anchor: "2024-01-01", arrival: null },
			]),
		).toBeNull();
		expect(
			learnExpectedMonth("monthly", [
				{ anchor: "2026-03-05", arrival: "2026-03-05" },
			]),
		).toBeNull();
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

describe("semiannual", () => {
	test("splits the year on 1 January and 1 July", () => {
		expect(periodStartOf("semiannual", "2026-01-01")).toBe("2026-01-01");
		expect(periodStartOf("semiannual", "2026-06-30")).toBe("2026-01-01");
		expect(periodStartOf("semiannual", "2026-07-01")).toBe("2026-07-01");
		expect(periodStartOf("semiannual", "2026-12-31")).toBe("2026-07-01");
	});

	test("closes each half on its last day", () => {
		expect(periodEndOf("semiannual", "2026-01-01")).toBe("2026-06-30");
		expect(periodEndOf("semiannual", "2026-07-01")).toBe("2026-12-31");
	});

	test("keys read as YYYY-H1 and YYYY-H2", () => {
		expect(periodKeyOf("semiannual", "2026-03-05")).toBe("2026-H1");
		expect(periodKeyOf("semiannual", "2026-06-30")).toBe("2026-H1");
		expect(periodKeyOf("semiannual", "2026-07-01")).toBe("2026-H2");
		expect(periodKeyOf("semiannual", "2026-11-20")).toBe("2026-H2");
	});

	test("walks from one half to the next, and back", () => {
		expect(enumeratePeriods("semiannual", "2025-02-10", "2026-08-01")).toEqual([
			"2025-01-01",
			"2025-07-01",
			"2026-01-01",
			"2026-07-01",
		]);
		expect(nextPeriodStart("semiannual", "2026-07-01")).toBe("2027-01-01");
		// Previous half: one period backwards is six months backwards.
		expect(addMonths("2026-01-01", -6)).toBe("2025-07-01");
		expect(periodLengthInMonths("semiannual")).toBe(6);
	});

	test("the expected day lands in the last month of the half", () => {
		expect(expectedDateOf("semiannual", "2026-01-01", null)).toBe("2026-06-30");
		expect(expectedDateOf("semiannual", "2026-01-01", 10)).toBe("2026-06-10");
		expect(expectedDateOf("semiannual", "2026-07-01", 31)).toBe("2026-12-31");
		expect(dueDateOf("semiannual", "2026-07-01", 15, 15)).toBe("2026-12-30");
	});

	test("a median gap of 150 to 220 days infers a half-yearly rhythm", () => {
		expect(periodicityFromDayGaps([181, 184])).toBe("semiannual");
		expect(periodicityFromDayGaps([150])).toBe("semiannual");
		expect(periodicityFromDayGaps([220])).toBe("semiannual");
		// Outside the window the neighbours keep their say.
		expect(periodicityFromDayGaps([91])).toBe("quarterly");
		expect(periodicityFromDayGaps([221])).toBe("yearly");
	});
});
